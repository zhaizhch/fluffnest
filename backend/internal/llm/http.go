package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

const (
	// Transient LLM failures (timeouts, 429, 5xx) get a couple quick retries.
	llmMaxAttempts = 2
	llmRetryBase   = 200 * time.Millisecond
)

const (
	MaxBubbleChars  = 36
	MaxWeatherChars = 120
	MaxChatChars    = 120
	MaxFortuneChars = 720
)

// Client is a process-wide OpenAI-compatible caller with connection reuse.
type Client struct {
	http *http.Client
}

func NewClient() *Client {
	resolver := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			d := net.Dialer{Timeout: 2 * time.Second}
			var last error
			// Prefer CN-reachable resolvers first; fall back if one is flaky.
			for _, dns := range []string{"223.5.5.5:53", "114.114.114.114:53", "8.8.8.8:53"} {
				c, err := d.DialContext(ctx, "udp", dns)
				if err == nil {
					return c, nil
				}
				last = err
			}
			if last != nil {
				return nil, last
			}
			return d.DialContext(ctx, network, address)
		},
	}
	dialer := &net.Dialer{
		Timeout:   6 * time.Second,
		KeepAlive: 30 * time.Second,
		Resolver:  resolver,
	}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     false, // HTTP/1.1 is more reliable behind flaky CN networks / MITM
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 14 * time.Second,
	}
	return &Client{
		http: &http.Client{
			Transport: transport,
			Timeout:   45 * time.Second,
		},
	}
}

type CompletionOpts struct {
	MaxTokens   int
	Timeout     time.Duration
	Temperature float64
}

func BubbleOpts() CompletionOpts {
	// Thinking models often burn the budget on reasoning; leave headroom for the line.
	return CompletionOpts{MaxTokens: 160, Timeout: 14 * time.Second, Temperature: 0.7}
}
func WeatherOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 220, Timeout: 14 * time.Second, Temperature: 0.7}
}
func ChatOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 220, Timeout: 28 * time.Second, Temperature: 0.75}
}
func CareVoiceOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 320, Timeout: 18 * time.Second, Temperature: 0.85}
}
func FortuneOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 520, Timeout: 28 * time.Second, Temperature: 0.85}
}

func EnsureConfigured(llm types.LlmSettings) error {
	if !llm.Enabled {
		return fmt.Errorf("请先在设置中开启 AI 对话")
	}
	if strings.TrimSpace(llm.APIKey) == "" {
		return fmt.Errorf("请先填写 LLM API Key")
	}
	if strings.TrimSpace(llm.APIBase) == "" || strings.TrimSpace(llm.Model) == "" {
		return fmt.Errorf("请填写 API Base 与模型名")
	}
	return nil
}

func NormalizeAPIBase(raw string) string {
	b := strings.TrimRight(strings.TrimSpace(raw), "/")
	if b == "" {
		return "https://api.openai.com/v1"
	}
	if strings.HasSuffix(b, "/v1") {
		return b
	}
	host := strings.ToLower(b)
	for _, needle := range []string{
		"api.deepseek.com", "api.openai.com", "openai.com",
		"dashscope.aliyuncs.com", "api.moonshot.cn", "api.siliconflow.cn",
	} {
		if strings.Contains(host, needle) {
			return b + "/v1"
		}
	}
	return b
}

// ToolSpec is an OpenAI-compatible function tool.
type ToolSpec struct {
	Type     string         `json:"type"`
	Function ToolFunction   `json:"function"`
}

type ToolFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type ChatMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	Name       string     `json:"name,omitempty"`
}

type CompletionResult struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
	Raw          chatCompletionResponse
}

type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content   *string    `json:"content"`
			ToolCalls []ToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

func extractMessageContent(content *string) string {
	if content == nil {
		return ""
	}
	raw := strings.TrimSpace(*content)
	if raw == "" {
		return ""
	}
	cleaned := strings.TrimSpace(StripThinking(raw))
	if cleaned != "" {
		return cleaned
	}
	return strings.TrimSpace(RecoverSpeakable(raw))
}

func (c *Client) ChatCompletion(ctx context.Context, llm types.LlmSettings, messages []map[string]string, opts CompletionOpts) (string, error) {
	msgs := make([]ChatMessage, 0, len(messages))
	for _, m := range messages {
		msgs = append(msgs, ChatMessage{Role: m["role"], Content: m["content"]})
	}
	res, err := c.ChatCompletionEx(ctx, llm, msgs, nil, "", opts)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(res.Content) == "" {
		return "", fmt.Errorf("LLM 返回空内容")
	}
	return res.Content, nil
}

func isRetryableHTTPStatus(code int) bool {
	switch code {
	case 408, 409, 425, 429, 500, 502, 503, 504:
		return true
	default:
		return false
	}
}

func isRetryableNetErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}
	// Deadline from the overall call budget — don't burn another attempt.
	if errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, needle := range []string{
		"timeout", "timed out", "connection reset", "connection refused",
		"temporary failure", "tls handshake", "eof", "broken pipe",
		"i/o timeout", "no such host", "server closed idle connection",
		"lookup ", "dns", "network is unreachable", "connection aborted",
		"http2", "stream error", "use of closed network connection",
	} {
		if strings.Contains(msg, needle) {
			return true
		}
	}
	return false
}

func retryAfterDelay(resp *http.Response, attempt int) time.Duration {
	base := llmRetryBase * time.Duration(1<<attempt) // 280ms, 560ms, …
	if resp == nil {
		return base
	}
	if ra := strings.TrimSpace(resp.Header.Get("Retry-After")); ra != "" {
		if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
			d := time.Duration(secs) * time.Second
			if d > 3*time.Second {
				d = 3 * time.Second
			}
			return d
		}
	}
	return base
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ChatCompletionEx supports optional tools / tool_choice (string or object).
func (c *Client) ChatCompletionEx(
	ctx context.Context,
	llm types.LlmSettings,
	messages []ChatMessage,
	tools []ToolSpec,
	toolChoice any,
	opts CompletionOpts,
) (CompletionResult, error) {
	var zero CompletionResult
	if err := EnsureConfigured(llm); err != nil {
		return zero, err
	}
	url := NormalizeAPIBase(llm.APIBase) + "/chat/completions"
	ctx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	var lastErr error
	nextDelay := time.Duration(0)
	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 160
	}
	for attempt := 0; attempt < llmMaxAttempts; attempt++ {
		if attempt > 0 {
			if err := sleepCtx(ctx, nextDelay); err != nil {
				if lastErr != nil {
					return zero, lastErr
				}
				return zero, err
			}
		}

		// Clean body first — thinking-disable flags often 400 on some gateways and
		// used to waste a full RTT before the real request.
		retryTransient := false
		for _, withFlags := range []bool{false, true} {
			body := map[string]any{
				"model":       llm.Model,
				"messages":    messages,
				"temperature": opts.Temperature,
				"max_tokens":  maxTokens,
				"stream":      false,
			}
			if len(tools) > 0 {
				body["tools"] = tools
				if toolChoice == nil || toolChoice == "" {
					body["tool_choice"] = "auto"
				} else {
					body["tool_choice"] = toolChoice
				}
			}
			if withFlags {
				body["enable_thinking"] = false
				body["thinking"] = map[string]any{"type": "disabled"}
				body["reasoning"] = map[string]any{"effort": "none", "exclude": true}
				body["reasoning_effort"] = "minimal"
				body["chat_template_kwargs"] = map[string]any{"enable_thinking": false}
			}
			payload, err := json.Marshal(body)
			if err != nil {
				return zero, err
			}
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
			if err != nil {
				return zero, err
			}
			req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(llm.APIKey))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json")

			resp, err := c.http.Do(req)
			if err != nil {
				lastErr = fmt.Errorf("网络错误(%s): %w", hostOf(url), err)
				if isRetryableNetErr(err) && attempt+1 < llmMaxAttempts {
					nextDelay = retryAfterDelay(nil, attempt)
					retryTransient = true
					break
				}
				return zero, lastErr
			}
			raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			_ = resp.Body.Close()
			if readErr != nil {
				lastErr = readErr
				if isRetryableNetErr(readErr) && attempt+1 < llmMaxAttempts {
					nextDelay = retryAfterDelay(nil, attempt)
					retryTransient = true
					break
				}
				return zero, readErr
			}
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				var parsed chatCompletionResponse
				if err := json.Unmarshal(raw, &parsed); err != nil {
					return zero, fmt.Errorf("解析 LLM 响应失败: %w", err)
				}
				if len(parsed.Choices) == 0 {
					lastErr = fmt.Errorf("LLM 返回空内容")
					if attempt+1 < llmMaxAttempts {
						nextDelay = retryAfterDelay(nil, attempt)
						retryTransient = true
						break
					}
					return zero, lastErr
				}
				msg := parsed.Choices[0].Message
				content := extractMessageContent(msg.Content)
				// Empty text with no tool calls — bump token budget (thinking ate it) and retry.
				if content == "" && len(msg.ToolCalls) == 0 && attempt+1 < llmMaxAttempts {
					lastErr = fmt.Errorf("LLM 返回空内容")
					if maxTokens < 1600 {
						maxTokens = maxTokens * 2
						if maxTokens > 1600 {
							maxTokens = 1600
						}
					}
					nextDelay = retryAfterDelay(nil, attempt)
					retryTransient = true
					break
				}
				finish := parsed.Choices[0].FinishReason
				// Hard length cut mid-thought: regenerate once with a larger budget.
				if strings.EqualFold(finish, "length") && content != "" && len(msg.ToolCalls) == 0 &&
					LooksIncompleteReply(content) && attempt+1 < llmMaxAttempts && maxTokens < 1600 {
					maxTokens = maxTokens + 500
					if maxTokens > 1600 {
						maxTokens = 1600
					}
					lastErr = fmt.Errorf("LLM 输出被长度截断")
					nextDelay = retryAfterDelay(nil, attempt)
					retryTransient = true
					break
				}
				return CompletionResult{
					Content:      content,
					ToolCalls:    msg.ToolCalls,
					FinishReason: finish,
					Raw:          parsed,
				}, nil
			}
			lastErr = fmt.Errorf("LLM 请求失败 (%d): %s", resp.StatusCode, TruncateChars(string(raw), 180))
			if resp.StatusCode == 400 || resp.StatusCode == 422 {
				// Try thinking-disable flags on next inner iteration.
				continue
			}
			if isRetryableHTTPStatus(resp.StatusCode) && attempt+1 < llmMaxAttempts {
				nextDelay = retryAfterDelay(resp, attempt)
				retryTransient = true
				break
			}
			return zero, lastErr
		}
		if !retryTransient {
			break
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("LLM 请求失败")
	}
	return zero, lastErr
}

// HTTP returns the shared client for weather/news reuse.
func (c *Client) HTTP() *http.Client { return c.http }

func hostOf(rawURL string) string {
	s := strings.TrimSpace(rawURL)
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?"); i >= 0 {
		s = s[:i]
	}
	if s == "" {
		return "llm"
	}
	return s
}

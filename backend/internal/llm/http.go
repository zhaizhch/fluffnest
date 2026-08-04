package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/types"
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
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   8 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   8 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &Client{
		http: &http.Client{
			Transport: transport,
			Timeout:   30 * time.Second,
		},
	}
}

type CompletionOpts struct {
	MaxTokens   int
	Timeout     time.Duration
	Temperature float64
}

func BubbleOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 64, Timeout: 12 * time.Second, Temperature: 0.7}
}
func WeatherOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 160, Timeout: 12 * time.Second, Temperature: 0.7}
}
func ChatOpts() CompletionOpts {
	return CompletionOpts{MaxTokens: 120, Timeout: 15 * time.Second, Temperature: 0.75}
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
	Content   string
	ToolCalls []ToolCall
	Raw       chatCompletionResponse
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
	// Clean body first — thinking-disable flags often 400 on some gateways and
	// used to waste a full RTT before the real request.
	for _, withFlags := range []bool{false, true} {
		body := map[string]any{
			"model":       llm.Model,
			"messages":    messages,
			"temperature": opts.Temperature,
			"max_tokens":  opts.MaxTokens,
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
			return zero, fmt.Errorf("网络错误: %w", err)
		}
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			return zero, readErr
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			var parsed chatCompletionResponse
			if err := json.Unmarshal(raw, &parsed); err != nil {
				return zero, fmt.Errorf("解析 LLM 响应失败: %w", err)
			}
			if len(parsed.Choices) == 0 {
				return zero, fmt.Errorf("LLM 返回空内容")
			}
			msg := parsed.Choices[0].Message
			content := ""
			if msg.Content != nil {
				content = strings.TrimSpace(StripThinking(*msg.Content))
			}
			return CompletionResult{
				Content:   content,
				ToolCalls: msg.ToolCalls,
				Raw:       parsed,
			}, nil
		}
		lastErr = fmt.Errorf("LLM 请求失败 (%d): %s", resp.StatusCode, TruncateChars(string(raw), 180))
		// Tool schema rejected by some gateways → retry without thinking flags only helps 400/422.
		if resp.StatusCode != 400 && resp.StatusCode != 422 {
			return zero, lastErr
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("LLM 请求失败")
	}
	return zero, lastErr
}

// HTTP returns the shared client for weather/news reuse.
func (c *Client) HTTP() *http.Client { return c.http }

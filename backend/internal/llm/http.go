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

type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content *string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

func (c *Client) ChatCompletion(ctx context.Context, llm types.LlmSettings, messages []map[string]string, opts CompletionOpts) (string, error) {
	if err := EnsureConfigured(llm); err != nil {
		return "", err
	}
	url := NormalizeAPIBase(llm.APIBase) + "/chat/completions"
	ctx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	var lastErr error
	for _, withFlags := range []bool{true, false} {
		body := map[string]any{
			"model":       llm.Model,
			"messages":    messages,
			"temperature": opts.Temperature,
			"max_tokens":  opts.MaxTokens,
			"stream":      false,
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
			return "", err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(llm.APIKey))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")

		resp, err := c.http.Do(req)
		if err != nil {
			return "", fmt.Errorf("网络错误: %w", err)
		}
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if readErr != nil {
			return "", readErr
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			var parsed chatCompletionResponse
			if err := json.Unmarshal(raw, &parsed); err != nil {
				return "", fmt.Errorf("解析 LLM 响应失败: %w", err)
			}
			if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == nil {
				return "", fmt.Errorf("LLM 返回空内容")
			}
			content := strings.TrimSpace(StripThinking(*parsed.Choices[0].Message.Content))
			if content == "" {
				return "", fmt.Errorf("LLM 返回空内容")
			}
			return content, nil
		}
		lastErr = fmt.Errorf("LLM 请求失败 (%d): %s", resp.StatusCode, TruncateChars(string(raw), 180))
		if resp.StatusCode != 400 && resp.StatusCode != 422 {
			return "", lastErr
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("LLM 请求失败")
	}
	return "", lastErr
}

// HTTP returns the shared client for weather/news reuse.
func (c *Client) HTTP() *http.Client { return c.http }

package llm

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

var (
	// DeepSeek / DSML-style tool dumps often leak into content when tool_choice=none.
	dsmlInvokeRe = regexp.MustCompile(`(?is)invoke\s+name\s*=\s*"([a-zA-Z0-9_]+)"`)
	dsmlParamRe  = regexp.MustCompile(`(?is)parameter\s+name\s*=\s*"([a-zA-Z0-9_]+)"[^>]*>([^<]*)<`)
	xmlToolRe    = regexp.MustCompile(`(?is)<tool_call>\s*<function\s*=\s*([a-zA-Z0-9_]+)>([\s\S]*?)</tool_call>`)
	xmlArgRe     = regexp.MustCompile(`(?is)<parameter\s*=\s*([a-zA-Z0-9_]+)>\s*([^<]*)\s*</parameter>`)
	jsonToolRe   = regexp.MustCompile(`(?is)\{\s*"name"\s*:\s*"([a-zA-Z0-9_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}`)
	toolLeakHintRe = regexp.MustCompile(`(?is)(?:DSML|tool_calls|</?tool_call>|invoke\s+name\s*=|parameter\s+name\s*=|<function\s*=|web_search|"tool_calls")`)
)

// LooksLikeToolLeak reports model content that is a fake/embedded tool call, not a user reply.
func LooksLikeToolLeak(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}
	if toolLeakHintRe.MatchString(s) {
		return true
	}
	// Near-entire message is markup / function soup.
	if strings.Contains(s, "web_search") && (strings.Contains(s, "query") || strings.Contains(s, "invoke")) {
		return true
	}
	return false
}

// ParseEmbeddedToolCalls recovers tool calls when the model wrote them as text
// instead of structured tool_calls (common with some CN gateways / tool_choice=none).
func ParseEmbeddedToolCalls(raw string) []ToolCall {
	s := strings.TrimSpace(raw)
	if s == "" || !LooksLikeToolLeak(s) {
		return nil
	}
	var out []ToolCall
	seen := map[string]bool{}
	add := func(name string, args map[string]any) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if args == nil {
			args = map[string]any{}
		}
		blob, _ := json.Marshal(args)
		key := name + string(blob)
		if seen[key] {
			return
		}
		seen[key] = true
		tc := ToolCall{ID: fmt.Sprintf("embed_%d", len(out)+1), Type: "function"}
		tc.Function.Name = name
		tc.Function.Arguments = string(blob)
		out = append(out, tc)
	}

	// DSML: invoke name="web_search" … parameter name="query">…</parameter>
	if m := dsmlInvokeRe.FindStringSubmatch(s); len(m) == 2 {
		args := map[string]any{}
		for _, pm := range dsmlParamRe.FindAllStringSubmatch(s, 8) {
			if len(pm) == 3 {
				args[strings.TrimSpace(pm[1])] = strings.TrimSpace(pm[2])
			}
		}
		add(m[1], args)
	}

	// XML tool_call blocks
	for _, xm := range xmlToolRe.FindAllStringSubmatch(s, 4) {
		if len(xm) < 3 {
			continue
		}
		args := map[string]any{}
		for _, am := range xmlArgRe.FindAllStringSubmatch(xm[2], 8) {
			if len(am) == 3 {
				args[strings.TrimSpace(am[1])] = strings.TrimSpace(am[2])
			}
		}
		add(xm[1], args)
	}

	// JSON {"name":"web_search","arguments":{...}}
	for _, jm := range jsonToolRe.FindAllStringSubmatch(s, 4) {
		if len(jm) < 3 {
			continue
		}
		args := map[string]any{}
		_ = json.Unmarshal([]byte(jm[2]), &args)
		add(jm[1], args)
	}

	return out
}

// StripToolLeak removes embedded tool-call markup so it never reaches WeChat.
func StripToolLeak(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if !LooksLikeToolLeak(s) {
		return s
	}
	// If the whole blob is a tool dump, drop it.
	if ParseEmbeddedToolCalls(s) != nil {
		// Keep any prose before the first leak marker.
		idx := strings.Index(strings.ToLower(s), "invoke")
		if idx < 0 {
			idx = strings.Index(strings.ToLower(s), "tool_call")
		}
		if idx < 0 {
			idx = strings.Index(strings.ToLower(s), "dsml")
		}
		if idx > 0 {
			s = strings.TrimSpace(s[:idx])
		} else {
			return ""
		}
	}
	s = toolLeakHintRe.ReplaceAllString(s, "")
	s = strings.Join(strings.Fields(s), " ")
	return strings.TrimSpace(s)
}

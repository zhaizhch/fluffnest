package llm

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	// DeepSeek / DSML-style tool dumps often leak into content when tool_choice=none.
	dsmlInvokeRe   = regexp.MustCompile(`(?is)invoke\s+name\s*=\s*"([a-zA-Z0-9_]+)"`)
	dsmlParamRe    = regexp.MustCompile(`(?is)parameter\s+name\s*=\s*"([a-zA-Z0-9_]+)"[^>]*>([^<]*)<`)
	xmlToolRe      = regexp.MustCompile(`(?is)<tool_call>\s*<function\s*=\s*([a-zA-Z0-9_]+)>([\s\S]*?)</tool_call>`)
	xmlArgRe       = regexp.MustCompile(`(?is)<parameter\s*=\s*([a-zA-Z0-9_]+)>\s*([^<]*)\s*</parameter>`)
	jsonToolRe     = regexp.MustCompile(`(?is)\{\s*"name"\s*:\s*"([a-zA-Z0-9_]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}`)
	toolLeakHintRe = regexp.MustCompile(`(?is)(?:DSML|tool_calls|</?tool_call>|invoke\s+name\s*=|parameter\s+name\s*=|<function\s*=|web_search|"tool_calls")`)
	// Fullwidth-pipe special tokens: <｜｜DSML｜｜…> or truncated <｜｜｜｜>
	dsmlSpecialTokRe = regexp.MustCompile(`(?s)<\s*｜[^>]*>|｜{2,}`)
)

// LooksLikeToolLeak reports model content that is a fake/embedded tool call, not a user reply.
func LooksLikeToolLeak(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}
	if strings.Contains(s, "｜｜") || strings.Contains(s, "<｜") || strings.Contains(s, "｜>") {
		return true
	}
	if dsmlSpecialTokRe.MatchString(s) {
		return true
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
	// Always strip DeepSeek special tokens even when the rest looks like prose.
	s = dsmlSpecialTokRe.ReplaceAllString(s, " ")
	if !LooksLikeToolLeak(s) && !toolLeakHintRe.MatchString(s) {
		return strings.Join(strings.Fields(s), " ")
	}
	// If recoverable tool dump, keep only prose before the first leak marker.
	if ParseEmbeddedToolCalls(raw) != nil || toolLeakHintRe.MatchString(s) {
		low := strings.ToLower(s)
		idx := -1
		for _, marker := range []string{"invoke", "tool_call", "dsml", "tool_calls", "<function"} {
			if i := strings.Index(low, marker); i >= 0 && (idx < 0 || i < idx) {
				idx = i
			}
		}
		if idx > 0 {
			s = strings.TrimSpace(s[:idx])
		} else if idx == 0 || strings.Contains(low, "invoke") || strings.Contains(low, "dsml") {
			return ""
		}
	}
	s = toolLeakHintRe.ReplaceAllString(s, "")
	s = dsmlSpecialTokRe.ReplaceAllString(s, " ")
	s = strings.Join(strings.Fields(s), " ")
	if LooksLikeToolLeak(s) {
		return ""
	}
	return strings.TrimSpace(s)
}

// LooksIncompleteReply catches mid-thought stalls that should not be sent to WeChat
// (e.g. "主人别急，卡卡这就" — predicate never finished; or cut mid-quote).
func LooksIncompleteReply(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return true
	}
	if LooksLikeToolLeak(s) {
		return true
	}
	n := utf8.RuneCountInString(s)
	r := []rune(s)
	last := r[len(r)-1]
	switch last {
	case '，', '、', ',', ';', '；', '：', ':',
		'"', '\'', '“', '‘', '「', '『', '(', '（', '[', '【',
		'—', '–', '-', '/', '\\':
		return true
	}

	// Trailing connectors / stall phrases — model was about to act, not answering.
	for _, suf := range []string{
		"这就", "这就去", "这就来", "正在", "马上", "稍等", "别急",
		"我去", "让我", "我来", "先去", "先查", "去查", "去搜",
		"卡卡这就", "主人别急", "就是他的", "就是她的", "就是它的",
	} {
		if strings.HasSuffix(s, suf) {
			return true
		}
	}

	if unbalancedQuotes(s) {
		return true
	}

	// Complete sentence(s) then an unfinished trailing clause (common max_tokens cut).
	if i := lastStrongSentenceIndex(r); i >= 0 && i < len(r)-1 {
		tail := strings.TrimSpace(string(r[i+1:]))
		if utf8.RuneCountInString(tail) >= 4 && !hasStrongSentenceEnd(tail) {
			return true
		}
	}

	// Short "wait" fluff without a finished sentence.
	stallHints := []string{"别急", "稍等", "等一下", "马上回", "这就办", "我查查"}
	hasStall := false
	for _, h := range stallHints {
		if strings.Contains(s, h) {
			hasStall = true
			break
		}
	}
	if hasStall && n < 36 && !hasStrongSentenceEnd(s) {
		return true
	}
	return false
}

func unbalancedQuotes(s string) bool {
	// ASCII double quotes: odd count → cut mid-string.
	if strings.Count(s, `"`)%2 == 1 {
		return true
	}
	opens := strings.Count(s, "“") + strings.Count(s, "「") + strings.Count(s, "『")
	closes := strings.Count(s, "”") + strings.Count(s, "」") + strings.Count(s, "』")
	return opens > closes
}

func lastStrongSentenceIndex(r []rune) int {
	last := -1
	for i := 0; i < len(r); i++ {
		if isStrongSentenceEnd(r, i) {
			last = i
		}
	}
	return last
}

// TrimToLastSentence drops an unfinished trailing clause after the last 。！？～.
// Returns "" if nothing complete remains.
func TrimToLastSentence(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	r := []rune(s)
	i := lastStrongSentenceIndex(r)
	if i < 0 {
		return ""
	}
	out := strings.TrimSpace(string(r[:i+1]))
	if out == "" || LooksLikeToolLeak(out) {
		return ""
	}
	return out
}

func hasStrongSentenceEnd(s string) bool {
	for _, r := range s {
		switch r {
		case '。', '！', '？', '!', '?', '…', '～':
			return true
		}
	}
	return false
}

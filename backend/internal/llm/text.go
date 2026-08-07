package llm

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	thinkTagRe = regexp.MustCompile(`(?is)<(?:think|thinking|reasoning|thought|redacted_reasoning)>.*?</(?:think|thinking|reasoning|thought|redacted_reasoning)>`)
	// Unclosed think blocks (common when max_tokens cuts mid-reasoning).
	thinkOpenRe = regexp.MustCompile(`(?is)<(?:think|thinking|reasoning|thought|redacted_reasoning)>[\s\S]*$`)
)

func TruncateChars(s string, max int) string {
	r := []rune(s)
	if max <= 0 || len(r) <= max {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(string(r[:max]))
}

// TruncateAtSentence cuts near max but prefers ending on 。！？… or .!?
// so WeChat replies don't look like they stopped mid-thought.
func TruncateAtSentence(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if max <= 0 || len(r) <= max {
		return strings.TrimSpace(s)
	}
	cut := r[:max]

	// 1) Last strong sentence end that still keeps a meaningful prefix (~1/3+).
	strongMin := max / 3
	if strongMin < 8 {
		strongMin = 8
	}
	lastStrong := -1
	for i := 0; i < len(cut); i++ {
		if isStrongSentenceEnd(cut, i) {
			lastStrong = i
		}
	}
	if lastStrong+1 >= strongMin {
		return strings.TrimSpace(string(cut[:lastStrong+1]))
	}

	// 2) Last soft break in the latter half (drop a short incomplete tail).
	softMin := max / 2
	lastSoft := -1
	for i := softMin; i < len(cut); i++ {
		switch cut[i] {
		case '，', '、', '；', ',', ';':
			lastSoft = i
		}
	}
	if lastSoft >= softMin {
		return strings.TrimSpace(string(cut[:lastSoft+1]))
	}

	return strings.TrimSpace(string(cut))
}

func isStrongSentenceEnd(r []rune, i int) bool {
	switch r[i] {
	case '。', '！', '？', '…', '!', '?', '～':
		return true
	case '.':
		// Avoid decimals like 3.14
		if i+1 < len(r) && unicode.IsDigit(r[i+1]) {
			return false
		}
		if i > 0 && unicode.IsDigit(r[i-1]) {
			return false
		}
		return true
	default:
		return false
	}
}

func StripThinking(raw string) string {
	cleaned := thinkTagRe.ReplaceAllString(raw, "")
	cleaned = thinkOpenRe.ReplaceAllString(cleaned, "")
	var lines []string
	for _, line := range strings.Split(cleaned, "\n") {
		t := strings.ToLower(strings.TrimSpace(line))
		if strings.HasPrefix(t, "thinking:") ||
			strings.HasPrefix(t, "reasoning:") ||
			strings.HasPrefix(line, "分析：") ||
			strings.HasPrefix(line, "思考：") {
			continue
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// RecoverSpeakable pulls a short speakable line when StripThinking wiped everything
// (e.g. reply sits after a closed think block that the model truncated oddly).
func RecoverSpeakable(raw string) string {
	t := strings.TrimSpace(StripThinking(raw))
	if t == "" {
		// Closed tags removed mid-string; keep text after the last close tag.
		lower := strings.ToLower(raw)
		for _, close := range []string{
			"</think>", "</thinking>", "</reasoning>", "</thought>", "</redacted_reasoning>",
		} {
			if i := strings.LastIndex(lower, close); i >= 0 {
				t = strings.TrimSpace(raw[i+len(close):])
				break
			}
		}
	}
	t = strings.TrimSpace(StripThinking(t))
	if t == "" {
		return ""
	}
	// Prefer the last non-empty line — replies often trail after reasoning prose.
	parts := strings.Split(t, "\n")
	for i := len(parts) - 1; i >= 0; i-- {
		line := strings.TrimSpace(parts[i])
		if line == "" {
			continue
		}
		low := strings.ToLower(line)
		if strings.HasPrefix(low, "thinking") || strings.HasPrefix(low, "reasoning") {
			continue
		}
		return line
	}
	return t
}

func CleanLine(raw string, max int) string {
	t := strings.TrimSpace(StripThinking(raw))
	if t == "" {
		t = RecoverSpeakable(raw)
	}
	for _, wrap := range []string{`"`, `'`, "「", "」", "“", "”"} {
		t = strings.Trim(t, wrap)
	}
	if i := strings.IndexByte(t, '\n'); i >= 0 {
		t = t[:i]
	}
	t = strings.TrimSpace(t)
	t = strings.TrimLeft(t, "-*•1.) ")
	return TruncateChars(t, max)
}

// CleanWechatReply keeps multi-sentence WeChat replies (newlines → spaces).
func CleanWechatReply(raw string, max int) string {
	t := strings.TrimSpace(StripThinking(raw))
	t = StripToolLeak(t)
	t = strings.ReplaceAll(t, "\r\n", "\n")
	t = strings.Join(strings.Fields(strings.ReplaceAll(t, "\n", " ")), " ")
	for _, wrap := range []string{`"`, `'`, "「", "」", "“", "”"} {
		t = strings.Trim(t, wrap)
	}
	// Never ship tool markup to WeChat even after light cleanup.
	if LooksLikeToolLeak(t) {
		return ""
	}
	t = TruncateAtSentence(t, max)
	if LooksIncompleteReply(t) {
		return ""
	}
	return t
}

// CleanWeatherLine keeps short multi-sentence weather advice (allows newlines → spaces).
func CleanWeatherLine(raw string, max int) string {
	t := strings.TrimSpace(StripThinking(raw))
	if t == "" {
		t = RecoverSpeakable(raw)
	}
	t = strings.ReplaceAll(t, "\r\n", "\n")
	t = strings.Join(strings.Fields(strings.ReplaceAll(t, "\n", " ")), " ")
	for _, wrap := range []string{`"`, `'`, "「", "」", "“", "”"} {
		t = strings.Trim(t, wrap)
	}
	return TruncateChars(t, max)
}

func CleanFortune(raw string) string {
	t := strings.TrimSpace(StripThinking(raw))
	if strings.HasPrefix(t, "```") {
		t = strings.TrimPrefix(t, "```")
		t = strings.TrimPrefix(t, "markdown")
		t = strings.TrimPrefix(t, "text")
		t = strings.TrimSpace(t)
		t = strings.Trim(t, "`")
		t = strings.TrimSpace(t)
	}
	r := []rune(t)
	if len(r) > MaxFortuneChars {
		return string(r[:MaxFortuneChars]) + "…"
	}
	return t
}

func NormalizeSpeechKey(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsSpace(r) {
			continue
		}
		switch r {
		case '，', ',', '。', '.', '!', '！', '？', '?', '～', '~', '…', '、', '；', ';', '：', ':', '"', '\'', '「', '」', '『', '』':
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

package llm

import (
	"regexp"
	"strings"
	"unicode"
)

var thinkTagRe = regexp.MustCompile(`(?is)<(?:think|thinking|reasoning|thought|redacted_reasoning)>.*?</(?:think|thinking|reasoning|thought|redacted_reasoning)>`)

func TruncateChars(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(string(r[:max]))
}

func StripThinking(raw string) string {
	cleaned := thinkTagRe.ReplaceAllString(raw, "")
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

func CleanLine(raw string, max int) string {
	t := strings.TrimSpace(raw)
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

// CleanWeatherLine keeps short multi-sentence weather advice (allows newlines → spaces).
func CleanWeatherLine(raw string, max int) string {
	t := strings.TrimSpace(StripThinking(raw))
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

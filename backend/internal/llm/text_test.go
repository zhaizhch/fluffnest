package llm

import (
	"strings"
	"testing"
)

func TestStripThinkingUnclosed(t *testing.T) {
	raw := "<think>一堆推理还没说完"
	if got := strings.TrimSpace(StripThinking(raw)); got != "" {
		t.Fatalf("expected empty after unclosed think, got %q", got)
	}
}

func TestCleanLineAfterThink(t *testing.T) {
	raw := "<think>先分析一下主人心情</think>\n摸摸头好舒服～"
	got := CleanLine(raw, 36)
	if got != "摸摸头好舒服～" {
		t.Fatalf("got %q", got)
	}
}

func TestRecoverSpeakableLastLine(t *testing.T) {
	raw := "分析：很长一段\n思考：还在想\n主人快喝口水呀"
	got := CleanLine(raw, 36)
	if got != "主人快喝口水呀" {
		t.Fatalf("got %q", got)
	}
}

func TestTruncateAtSentence(t *testing.T) {
	s := "青山学院赢了。区间赏方面一区是某某，二区还没说完就被切"
	got := TruncateAtSentence(s, 20)
	if !strings.HasSuffix(got, "，") && !strings.HasSuffix(got, "。") {
		t.Fatalf("expected punct end, got %q", got)
	}
	if strings.HasSuffix(got, "二区") || strings.Contains(got, "还没说完") {
		t.Fatalf("should not keep incomplete tail: %q", got)
	}
}

func TestCleanWechatReplySentenceTrim(t *testing.T) {
	raw := "结论是青山赢了。后面这句很长很长很长很长很长很长会被裁掉到半截"
	got := CleanWechatReply(raw, 24)
	if got != "结论是青山赢了。" {
		t.Fatalf("got %q", got)
	}
}

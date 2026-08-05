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

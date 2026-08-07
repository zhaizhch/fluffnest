package llm

import (
	"strings"
	"testing"
)

func TestParseEmbeddedDSMLToolCall(t *testing.T) {
	raw := ` <｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="web_search"> <｜｜DSML｜｜parameter name="query" string="true">第102回箱根驿传 冠军 综合成绩</｜｜DSML｜｜parameter> <｜｜DSML｜｜parameter name="type" string="true">news</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls> `
	if !LooksLikeToolLeak(raw) {
		t.Fatal("expected leak detect")
	}
	calls := ParseEmbeddedToolCalls(raw)
	if len(calls) != 1 {
		t.Fatalf("want 1 call, got %#v", calls)
	}
	if calls[0].Function.Name != "web_search" {
		t.Fatalf("name=%s", calls[0].Function.Name)
	}
	if !strings.Contains(calls[0].Function.Arguments, "箱根驿传") {
		t.Fatalf("args=%s", calls[0].Function.Arguments)
	}
	if !strings.Contains(calls[0].Function.Arguments, "news") {
		t.Fatalf("missing type news: %s", calls[0].Function.Arguments)
	}
}

func TestCleanWechatReplyDropsToolLeak(t *testing.T) {
	raw := `invoke name="web_search" parameter name="query">foo</parameter>`
	out := CleanWechatReply(raw, 200)
	if out != "" {
		t.Fatalf("expected empty, got %q", out)
	}
}

func TestCleanWechatReplyDropsEmptyDSMLTokens(t *testing.T) {
	raw := `<｜｜｜｜> <｜｜｜｜>`
	if !LooksLikeToolLeak(raw) {
		t.Fatal("expected leak detect for empty DSML tokens")
	}
	out := CleanWechatReply(raw, 200)
	if out != "" {
		t.Fatalf("expected empty, got %q", out)
	}
}

func TestLooksIncompleteStall(t *testing.T) {
	if !LooksIncompleteReply("主人别急，卡卡这就") {
		t.Fatal("expected incomplete stall")
	}
	if !LooksIncompleteReply("稍等，我这边") {
		t.Fatal("expected incomplete trailing comma/connector")
	}
	if LooksIncompleteReply("青山学院赢了，区间赏稍后再细说。") {
		t.Fatal("complete reply should pass")
	}
	if CleanWechatReply("主人别急，卡卡这就", 200) != "" {
		t.Fatal("CleanWechatReply should drop stall")
	}
}

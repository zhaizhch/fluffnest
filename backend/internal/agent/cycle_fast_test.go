package agent

import (
	"testing"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

func TestNeedsToolsLikelyFastPath(t *testing.T) {
	if needsToolsLikely(nil, "哈哈你好呀", nil) {
		t.Fatal("chitchat should be fast-path")
	}
	if needsToolsLikely([]Skill{{Name: "companion"}}, "摸摸", nil) {
		t.Fatal("short companion should be fast-path")
	}
	if needsToolsLikely(nil, "嗯嗯", nil) {
		t.Fatal("very short ack should be fast-path")
	}
	// Mood questions longer / ambiguous → prefer search+tools (mandatory prefetch).
	if !needsToolsLikely([]Skill{{Name: "weather-care"}}, "明天天气", nil) {
		t.Fatal("weather skill needs tools")
	}
	if !needsToolsLikely(nil, "帮我查一下最新新闻", nil) {
		t.Fatal("lookup cue needs tools")
	}
	if !needsToolsLikely(nil, "第102回箱根驿传冠军是谁", nil) {
		t.Fatal("edition + question needs tools")
	}
	if !needsToolsLikely(nil, "随便聊聊", []types.ImAttachment{{Path: "/tmp/a.pdf"}}) {
		t.Fatal("attachments need tools")
	}
}

func TestNeedsToolsLikelyDefaultOpen(t *testing.T) {
	// No proper-noun whitelist required — default open tools for non-chitchat.
	cases := []string{
		"哈兰德踢世界杯了吗",
		"黑田朝日是不是第102回山神",
		"挪威国家队入选名单",
		"星露谷最近有更新吗",
		"那个球员转会了没有",
	}
	for _, msg := range cases {
		if !needsToolsLikely(nil, msg, nil) {
			t.Fatalf("expected tools (default-open) for %q", msg)
		}
	}
	if !needsToolsLikely([]Skill{{Name: "research"}}, "随便问问", nil) {
		t.Fatal("research skill forces tools")
	}
}

func TestShouldPrefetchWeb(t *testing.T) {
	if shouldPrefetchWeb(nil, "哈哈", nil) {
		t.Fatal("chitchat should not prefetch")
	}
	if shouldPrefetchWeb([]Skill{{Name: "weather-care"}}, "明天北京天气", nil) {
		t.Fatal("weather should not prefetch web")
	}
	if shouldPrefetchWeb(nil, "算一下 12*8", nil) {
		t.Fatal("math should not prefetch")
	}
	if shouldPrefetchWeb(nil, "翻译成英文：你好", nil) {
		t.Fatal("translate should not prefetch")
	}
	if !shouldPrefetchWeb(nil, "哈兰德踢世界杯了吗", nil) {
		t.Fatal("current events should prefetch")
	}
	if !shouldPrefetchWeb(nil, "黑田朝日是不是山神", nil) {
		t.Fatal("ekiden fact should prefetch")
	}
}

package agent

import (
	"strings"
	"testing"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

func TestNeedsToolsLikelyFastPath(t *testing.T) {
	if needsToolsLikely(nil, "哈哈你好呀", nil) {
		t.Fatal("chitchat should be fast-path")
	}
	if needsToolsLikely([]Skill{{Name: "companion"}}, "今天心情怎么样", nil) {
		t.Fatal("companion skill should be fast-path")
	}
	if !needsToolsLikely([]Skill{{Name: "weather-care"}}, "明天天气", nil) {
		t.Fatal("weather skill needs tools")
	}
	if !needsToolsLikely(nil, "帮我查一下最新新闻", nil) {
		t.Fatal("news keyword needs tools")
	}
	if !needsToolsLikely(nil, "第102回箱根驿传冠军是谁", nil) {
		t.Fatal("race result should need tools")
	}
	if !needsToolsLikely(nil, "随便聊聊", []types.ImAttachment{{Path: "/tmp/a.pdf"}}) {
		t.Fatal("attachments need tools")
	}
}

func TestNeedsToolsLikelyResearch(t *testing.T) {
	msg := "星露谷最近有更新吗"
	if !needsToolsLikely([]Skill{{Name: "research"}}, msg, nil) {
		t.Fatal("research should need tools")
	}
	if !strings.Contains(msg, "更新") {
		t.Fatal("sanity")
	}
}

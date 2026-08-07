package agent

import (
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

func TestEssentialsForPromptExcludesFullMemoryDump(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mem.json")
	m, err := OpenMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	peer := "p1"
	_ = m.OwnerUpdateField(peer, "identity", "nickname", "志成")
	_ = m.Write(peer, "hobby", "星露谷", "test", false)
	_ = m.RememberTurn(peer, "很久以前的闲聊", "很长的回复内容不应该进 essentials")

	ess := m.EssentialsForPrompt(peer)
	if !strings.Contains(ess, "志成") {
		t.Fatalf("missing nickname: %s", ess)
	}
	if strings.Contains(ess, "hobby") || strings.Contains(ess, "星露谷") {
		t.Fatalf("KV memory leaked into essentials: %s", ess)
	}
	if strings.Contains(ess, "很久以前") || strings.Contains(ess, "很长的回复") {
		t.Fatalf("session notes leaked into essentials: %s", ess)
	}
	if !strings.Contains(ess, "owner_dossier_get") {
		t.Fatalf("missing on-demand hint: %s", ess)
	}
}

func TestWorkingMemoryCarriesContinuity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mem.json")
	m, err := OpenMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	peer := "p-wm"
	if err := m.RememberTurn(peer, "我们明天一起去看星露谷直播", "好呀，明天晚上提醒你"); err != nil {
		t.Fatal(err)
	}
	_ = m.Write(peer, "hobby", "星露谷", "test", false)

	wm := m.WorkingMemoryForPrompt(peer, "那个直播几点开始？")
	if wm == "" {
		t.Fatal("expected working memory")
	}
	if !strings.Contains(wm, "Working Memory") {
		t.Fatalf("missing header: %s", wm)
	}
	if !strings.Contains(wm, "星露谷") {
		t.Fatalf("expected hobby/thread continuity, got: %s", wm)
	}
	if !strings.Contains(wm, "Open thread") && !strings.Contains(wm, "Recent session notes") {
		t.Fatalf("expected thread or notes: %s", wm)
	}
}

func TestCompressHistoryKeepsRecentReadable(t *testing.T) {
	longUser := "关于星露谷联机存档冲突，我这边是 " + strings.Repeat("细节说明", 120)
	var hist []types.ChatMessage
	for i := 0; i < 10; i++ {
		hist = append(hist,
			types.ChatMessage{Role: "user", Content: "旧问题" + strings.Repeat("啊", i+1)},
			types.ChatMessage{Role: "assistant", Content: "旧回答" + strings.Repeat("嗯", i+1)},
		)
	}
	hist = append(hist,
		types.ChatMessage{Role: "user", Content: longUser},
		types.ChatMessage{Role: "assistant", Content: "先备份再覆盖，别直接合档。"},
	)

	out := CompressHistory(hist)
	if len(out) < 2 {
		t.Fatalf("too short: %+v", out)
	}
	hasDigest := false
	for _, m := range out {
		if m.Role == "system" && strings.Contains(m.Content, "episodic summary") {
			hasDigest = true
		}
	}
	if !hasDigest {
		t.Fatal("expected episodic summary system message")
	}

	var recentUser string
	for _, m := range out {
		if m.Role == "user" && strings.Contains(m.Content, "星露谷联机") {
			recentUser = m.Content
		}
	}
	if recentUser == "" {
		t.Fatalf("missing recent user turn: %+v", out)
	}
	// Must keep far more than the old 180-rune hard clip.
	if utf8.RuneCountInString(recentUser) < 300 {
		t.Fatalf("recent user over-compressed (%d runes): %s", utf8.RuneCountInString(recentUser), recentUser[:60])
	}
}

func TestRememberTurnAndRefinePeerKnowledge(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mem.json")
	m, err := OpenMemory(path)
	if err != nil {
		t.Fatal(err)
	}
	peer := "p2"
	for i := 0; i < 10; i++ {
		if err := m.RememberTurn(peer, "话题"+strings.Repeat("x", i+1), "回复"+strings.Repeat("y", i+1)); err != nil {
			t.Fatal(err)
		}
	}
	sess := m.Sessions[peer]
	if strings.TrimSpace(sess.Thread) == "" {
		t.Fatal("expected open thread")
	}
	if len(sess.Notes) == 0 {
		t.Fatal("expected hot notes")
	}
	if len(sess.Notes) > sessionNotesKeep {
		t.Fatalf("notes not capped: %d", len(sess.Notes))
	}
	// 10 turns = 20 notes → should fold into digest and leave hot window.
	if strings.TrimSpace(sess.Digest) == "" {
		t.Fatal("expected episodic digest after folding")
	}
	// Hot window may grow until foldAt (hot+4); just ensure we stayed bounded.
	if len(sess.Notes) > sessionNotesHot+4 {
		t.Fatalf("hot notes not folded down: %d", len(sess.Notes))
	}
}

func TestTruncateToolResult(t *testing.T) {
	long := strings.Repeat("文", 5000)
	out := TruncateToolResult("read_document", long)
	if !strings.Contains(out, "已压缩") {
		t.Fatalf("expected truncation marker: %s", out[:80])
	}
}

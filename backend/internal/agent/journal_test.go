package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDetectJournalIntent(t *testing.T) {
	kind, body, ok := DetectJournalIntent("日记：今天加班到很晚，有点累")
	if !ok || kind != "diary" || !strings.Contains(body, "加班") {
		t.Fatalf("diary: kind=%s body=%q ok=%v", kind, body, ok)
	}
	kind, body, ok = DetectJournalIntent("想法：要不要换工作呢")
	if !ok || kind != "thought" {
		t.Fatalf("thought: kind=%s body=%q ok=%v", kind, body, ok)
	}
	kind, _, ok = DetectJournalIntent("帮我记到日记 今天很开心见到了老朋友")
	if !ok || kind != "diary" {
		t.Fatalf("soft diary: kind=%s ok=%v", kind, ok)
	}
	if _, _, ok := DetectJournalIntent("今天天气不错"); ok {
		t.Fatal("expected no journal intent")
	}
}

func TestJournalAppendListSearch(t *testing.T) {
	dir := t.TempDir()
	m, err := OpenMemory(filepath.Join(dir, "mem.json"))
	if err != nil {
		t.Fatal(err)
	}
	peer := "peer-j1"
	today := time.Now().Local().Format("2006-01-02")
	month := time.Now().Local().Format("2006-01")

	e, err := m.JournalAppend(peer, "diary", "今天想早点睡", today, "test", []string{"作息"})
	if err != nil {
		t.Fatal(err)
	}
	if e.Date != today || e.Month != month || e.Kind != "diary" {
		t.Fatalf("entry=%+v", e)
	}
	_, err = m.JournalAppend(peer, "thought", "在考虑换城市发展", "", "test", nil)
	if err != nil {
		t.Fatal(err)
	}

	list := m.JournalList(peer, month, "", "", 0, 10)
	if len(list) < 2 {
		t.Fatalf("list len=%d", len(list))
	}
	byDate := m.JournalList(peer, "", today, "diary", 0, 5)
	if len(byDate) == 0 {
		t.Fatal("expected date filter hit")
	}
	hits := m.JournalSearch(peer, "换城市", 5)
	if len(hits) == 0 {
		t.Fatal("expected search hit")
	}
	tl := FormatJournalTimeline(list)
	if !strings.Contains(tl, month) || !strings.Contains(tl, "diary") {
		t.Fatalf("timeline=%s", tl)
	}
	brief := m.JournalBriefForPrompt(peer)
	if brief == "" {
		t.Fatal("expected brief")
	}

	// Reload persistence
	m2, err := OpenMemory(filepath.Join(dir, "mem.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(m2.JournalList(peer, "", "", "", 30, 10)) < 2 {
		t.Fatal("persisted journals missing")
	}
	_ = os.RemoveAll(dir)
}

func TestJournalRejectsSecrets(t *testing.T) {
	dir := t.TempDir()
	m, err := OpenMemory(filepath.Join(dir, "mem.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.JournalAppend("p", "diary", "我的密码是 secret123456", "", "test", nil)
	if err == nil {
		t.Fatal("expected secret rejection")
	}
}

package agent

import (
	"strings"
	"sync"
	"testing"
)

func TestPersistentAgentInboxAndMemory(t *testing.T) {
	ag := NewPersistentAgent("alice", "researcher", "find facts")
	if ag.MemoryLen() != 1 {
		t.Fatalf("want system msg only, got %d", ag.MemoryLen())
	}
	ag.Receive("bob", "请看这点")
	ag.mu.Lock()
	if len(ag.inbox) != 1 {
		t.Fatalf("inbox=%d", len(ag.inbox))
	}
	ag.mu.Unlock()
}

func TestCrewHireSendBroadcastDisband(t *testing.T) {
	board := NewAgentBoard("换工作吗")
	crew := NewCrew(board)
	a, err := crew.Hire("alice", "researcher", "")
	if err != nil {
		t.Fatal(err)
	}
	b, err := crew.Hire("bob", "critic", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := crew.Send("alice", "bob", "初稿好了"); err != nil {
		t.Fatal(err)
	}
	b.mu.Lock()
	if len(b.inbox) != 1 {
		t.Fatalf("bob inbox=%d", len(b.inbox))
	}
	b.mu.Unlock()

	crew.Broadcast("alice", "全员同步")
	a.mu.Lock()
	ain := len(a.inbox)
	a.mu.Unlock()
	b.mu.Lock()
	bin := len(b.inbox)
	b.mu.Unlock()
	if ain != 0 {
		t.Fatalf("alice should not receive own broadcast, inbox=%d", ain)
	}
	if bin != 2 {
		t.Fatalf("bob inbox want 2 got %d", bin)
	}

	names := crew.Disband()
	if len(names) != 2 {
		t.Fatalf("disbanded=%v", names)
	}
	if len(crew.Names()) != 0 {
		t.Fatal("crew should be empty")
	}
	if _, err := a.Chat(nil, ToolDeps{}, "hi", false); err == nil {
		t.Fatal("expected dead agent error")
	}
}

func TestCrewConcurrentHireCap(t *testing.T) {
	crew := NewCrew(NewAgentBoard("t"))
	for i := 0; i < maxCrewSize; i++ {
		if _, err := crew.Hire(string(rune('a'+i)), "r", ""); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := crew.Hire("overflow", "r", ""); err == nil {
		t.Fatal("expected full crew error")
	}
}

func TestAgentBoardConcurrentPost(t *testing.T) {
	b := NewAgentBoard("要不要换工作")
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b.Post("a", "all", "opinion", "msg")
		}()
	}
	wg.Wait()
	if len(b.Snapshot()) != 10 {
		t.Fatalf("msgs=%d", len(b.Snapshot()))
	}
	text := b.Format(5)
	if !strings.Contains(text, "白板") || !strings.Contains(text, "议题") {
		t.Fatalf("bad format: %s", text)
	}
}

func TestMembersFromAgentArgs(t *testing.T) {
	ms := MembersFromAgentArgs([]string{"researcher", "risk:看法律风险", "researcher"}, "要不要创业")
	if len(ms) != 2 {
		t.Fatalf("got %#v", ms)
	}
	if ms[0].Name != "researcher" || ms[1].Name != "risk" {
		t.Fatalf("names %#v", ms)
	}
	if !strings.Contains(ms[1].Task, "法律") {
		t.Fatalf("task=%s", ms[1].Task)
	}
}

func TestNormalizeHandoffPlan(t *testing.T) {
	ms := planCrewMembers(nil, ToolDeps{}, "选题", "handoff", false)
	if len(ms) != 2 || ms[0].Name != "specialist" || ms[1].Name != "reviewer" {
		t.Fatalf("%#v", ms)
	}
}

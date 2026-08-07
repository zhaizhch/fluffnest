package search

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestHitSinkSignalsEnough(t *testing.T) {
	sink := newHitSink(3)
	for i := 0; i < 3; i++ {
		sink.add(Hit{Title: "t", Snippet: "s"})
	}
	select {
	case <-sink.enough:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected enough signal")
	}
	if sink.len() != 3 {
		t.Fatalf("len=%d", sink.len())
	}
}

func TestRunSearchAgentsEarlyCancel(t *testing.T) {
	s := &Service{}
	ctx := context.Background()
	start := time.Now()
	// Empty queries → agents no-op, returns quickly with nil hits.
	hits := s.runSearchAgents(ctx, "q", "web", nil, nil, nil, 4, 2*time.Second)
	if len(hits) != 0 {
		t.Fatalf("want 0 hits, got %d", len(hits))
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatalf("empty agents too slow: %s", time.Since(start))
	}
}

func TestHitSinkConcurrentAdd(t *testing.T) {
	sink := newHitSink(8)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sink.add(Hit{Title: "t", Snippet: "s"})
		}(i)
	}
	wg.Wait()
	select {
	case <-sink.enough:
	default:
		t.Fatal("expected enough after concurrent adds")
	}
	if sink.len() != 20 {
		t.Fatalf("len=%d", sink.len())
	}
}

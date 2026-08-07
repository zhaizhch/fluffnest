package search

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// Parallel search "agents": DomesticSearcher ∥ InternationalSearcher.
// Each lane fans out engines concurrently; when enoughHits is reached the
// shared context is cancelled so stragglers abort early.

const defaultEnoughHits = 4

type hitSink struct {
	mu     sync.Mutex
	hits   []Hit
	enough chan struct{}
	nWant  int
	closed atomic.Bool
}

func newHitSink(want int) *hitSink {
	if want <= 0 {
		want = defaultEnoughHits
	}
	return &hitSink{enough: make(chan struct{}, 1), nWant: want}
}

func (s *hitSink) add(h Hit) {
	s.mu.Lock()
	s.hits = append(s.hits, h)
	n := len(s.hits)
	s.mu.Unlock()
	if n >= s.nWant && s.closed.CompareAndSwap(false, true) {
		select {
		case s.enough <- struct{}{}:
		default:
		}
	}
}

func (s *hitSink) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.hits)
}

func (s *hitSink) snapshot() []Hit {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Hit, len(s.hits))
	copy(out, s.hits)
	return out
}

// runSearchAgents executes scoped lanes in parallel and returns as soon as
// enoughHits are collected (or all agents finish / timeout).
func (s *Service) runSearchAgents(
	parent context.Context,
	q string,
	kind string,
	cnQs, intlQs []string,
	allQs []string,
	enoughHits int,
	wall time.Duration,
) []Hit {
	ctx, cancel := context.WithTimeout(parent, wall)
	defer cancel()

	sink := newHitSink(enoughHits)
	relevant := func(h Hit) bool {
		if looksRelevant(q, h) {
			return true
		}
		for _, qq := range allQs {
			if looksRelevant(qq, h) {
				return true
			}
		}
		return false
	}
	accept := func(region, source string, in []Hit) {
		for _, h := range in {
			h.Region = region
			if source != "" {
				h.Source = source
			}
			h.Title = cleanText(h.Title, 120)
			h.Snippet = cleanText(h.Snippet, 360)
			if h.Title == "" && h.Snippet == "" {
				continue
			}
			if isJunkHit(h) || isTourismNoise(q, h) || !relevant(h) {
				continue
			}
			sink.add(h)
		}
	}
	thin := func() bool { return sink.len() < 2 }

	var wg sync.WaitGroup
	if len(cnQs) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.domesticAgent(ctx, cnQs, accept, thin)
		}()
	}
	if len(intlQs) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.internationalAgent(ctx, intlQs, kind, q, accept, thin)
		}()
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-sink.enough:
		cancel() // stop stragglers once we have enough evidence
		select {
		case <-done:
		case <-time.After(120 * time.Millisecond):
		}
	case <-done:
	case <-ctx.Done():
		<-done
	}

	return sink.snapshot()
}

func (s *Service) domesticAgent(ctx context.Context, queries []string, accept func(region, source string, in []Hit), thin func() bool) {
	var wg sync.WaitGroup
	for _, qq := range queries {
		qq := qq
		wg.Add(2)
		go func() {
			defer wg.Done()
			accept("cn", "WeChat", s.sogouWeixin(ctx, qq))
		}()
		go func() {
			defer wg.Done()
			accept("cn", "Bing·国内", s.bingRSSPref(ctx, qq, true))
		}()
	}
	wg.Wait()
	if ctx.Err() != nil || !thin() {
		return
	}
	var fb sync.WaitGroup
	for _, qq := range queries {
		qq := qq
		fb.Add(1)
		go func() {
			defer fb.Done()
			accept("cn", "Sogou", s.sogouHTML(ctx, qq))
		}()
	}
	fb.Wait()
}

func (s *Service) internationalAgent(ctx context.Context, queries []string, kind, rawQ string, accept func(region, source string, in []Hit), thin func() bool) {
	news := kind == "news" || looksFreshIntent(rawQ)
	var wg sync.WaitGroup
	for _, qq := range queries {
		qq := qq
		wg.Add(2)
		go func() {
			defer wg.Done()
			accept("intl", "Bing·国际", s.bingRSSPref(ctx, qq, false))
		}()
		go func() {
			defer wg.Done()
			if news {
				accept("intl", "Google News", s.googleNews(ctx, qq))
			} else {
				accept("intl", "", s.wikipedia(ctx, qq))
			}
		}()
	}
	wg.Wait()
	if ctx.Err() != nil || !thin() {
		return
	}
	var fb sync.WaitGroup
	for _, qq := range queries {
		qq := qq
		fb.Add(1)
		go func() {
			defer fb.Done()
			accept("intl", "DuckDuckGo", s.duckDuckGo(ctx, qq))
			accept("intl", "", s.wikipedia(ctx, qq))
		}()
	}
	fb.Wait()
}

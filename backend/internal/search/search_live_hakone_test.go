package search

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/cache"
)

func TestLiveHakoneAfterFix(t *testing.T) {
	s := New(&http.Client{Timeout: 25 * time.Second}, cache.New())
	for _, q := range []string{"第102回箱根驿传 区间赏", "第102回箱根駅伝 区間賞 名单"} {
		t0 := time.Now()
		hits, err := s.SearchOpt(context.Background(), q, Options{Limit: 6, Type: "news"})
		t.Logf("%s t=%v err=%v n=%d", q, time.Since(t0).Round(time.Millisecond), err, len(hits))
		for i, h := range hits {
			snip := h.Snippet
			r := []rune(snip)
			if len(r) > 140 {
				snip = string(r[:140]) + "…"
			}
			t.Logf("  %d [%s] %s | %s", i+1, h.Source, h.Title, snip)
		}
		if err != nil || len(hits) == 0 {
			t.Errorf("expected hits for %q", q)
		}
	}
}

package search

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/cache"
)

func TestLiveStardewNews(t *testing.T) {
	if testing.Short() {
		t.Skip("live")
	}
	s := New(&http.Client{Timeout: 20 * time.Second}, cache.New())
	hits, err := s.SearchOpt(context.Background(), "星露谷最近新料", Options{Limit: 8, Type: "news"})
	if err != nil {
		t.Fatal(err)
	}
	blob := FormatHits(hits)
	t.Log(blob)
	if !strings.Contains(strings.ToLower(blob), "stardew") && !strings.Contains(blob, "星露") {
		t.Fatalf("expected stardew-related hits, got:\n%s", blob)
	}
}

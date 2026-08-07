package search

import (
	"strings"
	"testing"
)

func TestOptimizeQueryHakone(t *testing.T) {
	o := OptimizeQuery("帮我查一下第102回箱根驿传区间赏是谁", "web")
	joinedCN := strings.Join(o.CN, " | ")
	joinedIntl := strings.Join(o.Intl, " | ")
	if !strings.Contains(joinedCN, "箱根") {
		t.Fatalf("expected CN hakone terms, got %v", o.CN)
	}
	if !strings.Contains(joinedIntl, "Hakone") && !strings.Contains(joinedIntl, "駅伝") {
		t.Fatalf("expected intl hakone terms, got %v", o.Intl)
	}
	if strings.Contains(joinedCN, "帮我") || strings.Contains(joinedCN, "查一下") {
		t.Fatalf("filler should be stripped, got %v", o.CN)
	}
}

func TestOptimizeQueryStardew(t *testing.T) {
	o := OptimizeQuery("星露谷最近有什么新料", "")
	if o.Kind != "news" {
		t.Fatalf("expected news kind, got %s", o.Kind)
	}
	if !strings.Contains(strings.Join(o.Intl, " "), "Stardew") {
		t.Fatalf("expected Stardew intl, got %v", o.Intl)
	}
	if len(o.CN) == 0 || len(o.Intl) == 0 {
		t.Fatalf("both lanes required: %#v", o)
	}
}

func TestExpandQueriesStardew(t *testing.T) {
	qs := ExpandQueries("星露谷最近有什么新料", "news")
	joined := strings.Join(qs, " | ")
	if !strings.Contains(joined, "Stardew") {
		t.Fatalf("expected English alias, got %v", qs)
	}
	if len(qs) < 2 {
		t.Fatalf("expected multiple variants, got %v", qs)
	}
}

func TestExpandQueriesHakone(t *testing.T) {
	qs := ExpandQueries("第102回箱根驿传 区间赏", "news")
	joined := strings.Join(qs, " | ")
	if !strings.Contains(joined, "駅伝") && !strings.Contains(joined, "Hakone") {
		t.Fatalf("expected JP/EN hakone variants, got %v", qs)
	}
}

func TestMergePreferBothRegions(t *testing.T) {
	in := []Hit{
		{Title: "CN1", Region: "cn"},
		{Title: "CN2", Region: "cn"},
		{Title: "EN1", Region: "intl"},
		{Title: "EN2", Region: "intl"},
	}
	out := mergePreferBothRegions(in)
	if len(out) != 4 {
		t.Fatalf("len %d", len(out))
	}
	if out[0].Region != "cn" || out[1].Region != "intl" {
		t.Fatalf("expected interleaved, got %#v", out)
	}
}

func TestLooksRelevantHakoneOrthography(t *testing.T) {
	q := "箱根驿传 区间赏"
	ok := Hit{Title: "第102回箱根駅伝 区間賞一覧", Snippet: "青山学院", URL: "https://example.jp/ekiden"}
	if !looksRelevant(q, ok) {
		t.Fatal("CN query should match JP ekiden page")
	}
	tourism := Hit{Title: "Hakone Travel Guide", Snippet: "hot springs and sightseeing", URL: "https://travel.example/hakone"}
	if !isTourismNoise(q, tourism) {
		t.Fatal("tourism page should be filtered for ekiden query")
	}
}

func TestLooksRelevant(t *testing.T) {
	q := "星露谷 更新"
	ok := Hit{Title: "Stardew Valley on Steam", Snippet: "farming RPG", URL: "https://store.steampowered.com"}
	bad := Hit{Title: "Municipal Utilities Billing", Snippet: "pay your utility bill", URL: "https://cityofnewalbany.com"}
	if !looksRelevant(q, ok) {
		t.Fatal("expected stardew hit relevant")
	}
	if looksRelevant(q, bad) {
		t.Fatal("expected utility bill irrelevant")
	}
}

func TestDedupeHits(t *testing.T) {
	in := []Hit{
		{Title: "A", URL: "https://a.example"},
		{Title: "A dup", URL: "https://a.example"},
		{Title: "B", URL: "https://b.example"},
	}
	out := dedupeHits(in)
	if len(out) != 2 {
		t.Fatalf("got %d", len(out))
	}
}

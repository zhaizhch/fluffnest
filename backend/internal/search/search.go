// Package search provides lightweight web lookup for the WeChat agent
// (DuckDuckGo Instant Answer + Wikipedia + Google News RSS). No API keys.
package search

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/fluffnest/deskpet/backend/internal/cache"
)

type Service struct {
	http  *http.Client
	cache *cache.TTL
}

func New(httpClient *http.Client, c *cache.TTL) *Service {
	return &Service{http: httpClient, cache: c}
}

type Hit struct {
	Title   string `json:"title"`
	Snippet string `json:"snippet"`
	Source  string `json:"source"`
	URL     string `json:"url,omitempty"`
}

var (
	itemTitleRe = regexp.MustCompile(`(?is)<item\b[^>]*>.*?<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
	itemDescRe  = regexp.MustCompile(`(?is)<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>`)
	itemLinkRe  = regexp.MustCompile(`(?is)<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</link>`)
	tagRe       = regexp.MustCompile(`(?is)<[^>]+>`)
)

// Search gathers brief facts for a query from free public sources.
func (s *Service) Search(ctx context.Context, query string, limit int) ([]Hit, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, fmt.Errorf("搜索词为空")
	}
	if limit <= 0 {
		limit = 6
	}
	if limit > 10 {
		limit = 10
	}
	cacheKey := "search:v1:" + strings.ToLower(q)
	if v, ok := s.cache.Get(cacheKey); ok {
		var hits []Hit
		if json.Unmarshal([]byte(v), &hits) == nil && len(hits) > 0 {
			if len(hits) > limit {
				hits = hits[:limit]
			}
			return hits, nil
		}
	}

	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()

	var (
		mu   sync.Mutex
		hits []Hit
	)
	add := func(h Hit) {
		h.Title = cleanText(h.Title, 80)
		h.Snippet = cleanText(h.Snippet, 220)
		if h.Title == "" && h.Snippet == "" {
			return
		}
		mu.Lock()
		hits = append(hits, h)
		mu.Unlock()
	}

	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		for _, h := range s.duckDuckGo(ctx, q) {
			add(h)
		}
	}()
	go func() {
		defer wg.Done()
		for _, h := range s.wikipedia(ctx, q) {
			add(h)
		}
	}()
	go func() {
		defer wg.Done()
		for _, h := range s.googleNews(ctx, q) {
			add(h)
		}
	}()
	wg.Wait()

	if len(hits) == 0 {
		return nil, fmt.Errorf("没有搜到「%s」的可靠结果", q)
	}
	if len(hits) > limit {
		hits = hits[:limit]
	}
	if raw, err := json.Marshal(hits); err == nil {
		s.cache.Set(cacheKey, string(raw), 8*time.Minute)
	}
	return hits, nil
}

// FormatHits turns hits into a compact briefing for the LLM.
func FormatHits(hits []Hit) string {
	if len(hits) == 0 {
		return "（无搜索结果）"
	}
	var b strings.Builder
	for i, h := range hits {
		fmt.Fprintf(&b, "%d. [%s] %s", i+1, h.Source, h.Title)
		if h.Snippet != "" && h.Snippet != h.Title {
			fmt.Fprintf(&b, " — %s", h.Snippet)
		}
		if h.URL != "" {
			fmt.Fprintf(&b, " <%s>", h.URL)
		}
		b.WriteByte('\n')
	}
	return strings.TrimSpace(b.String())
}

func (s *Service) duckDuckGo(ctx context.Context, q string) []Hit {
	u := "https://api.duckduckgo.com/?q=" + url.QueryEscape(q) + "&format=json&no_html=1&skip_disambig=1"
	raw, err := s.get(ctx, u)
	if err != nil {
		return nil
	}
	var parsed struct {
		AbstractText   string `json:"AbstractText"`
		AbstractSource string `json:"AbstractSource"`
		AbstractURL    string `json:"AbstractURL"`
		Heading        string `json:"Heading"`
		Answer         string `json:"Answer"`
		Definition     string `json:"Definition"`
		RelatedTopics  []struct {
			Text     string `json:"Text"`
			FirstURL string `json:"FirstURL"`
		} `json:"RelatedTopics"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return nil
	}
	var out []Hit
	if t := strings.TrimSpace(parsed.AbstractText); t != "" {
		out = append(out, Hit{
			Title:   firstNonEmpty(parsed.Heading, "摘要"),
			Snippet: t,
			Source:  firstNonEmpty(parsed.AbstractSource, "DuckDuckGo"),
			URL:     parsed.AbstractURL,
		})
	}
	if a := strings.TrimSpace(stripTags(parsed.Answer)); a != "" {
		out = append(out, Hit{Title: "速答", Snippet: a, Source: "DuckDuckGo"})
	}
	if d := strings.TrimSpace(parsed.Definition); d != "" {
		out = append(out, Hit{Title: "定义", Snippet: d, Source: "DuckDuckGo"})
	}
	for _, t := range parsed.RelatedTopics {
		text := strings.TrimSpace(t.Text)
		if text == "" {
			continue
		}
		title, snip := splitDash(text)
		out = append(out, Hit{Title: title, Snippet: snip, Source: "DuckDuckGo", URL: t.FirstURL})
		if len(out) >= 4 {
			break
		}
	}
	return out
}

func (s *Service) wikipedia(ctx context.Context, q string) []Hit {
	// Prefer Chinese wiki; fall back to English.
	for _, lang := range []string{"zh", "en"} {
		u := fmt.Sprintf(
			"https://%s.wikipedia.org/w/api.php?action=opensearch&search=%s&limit=3&namespace=0&format=json",
			lang, url.QueryEscape(q),
		)
		raw, err := s.get(ctx, u)
		if err != nil {
			continue
		}
		var parsed []json.RawMessage
		if json.Unmarshal(raw, &parsed) != nil || len(parsed) < 4 {
			continue
		}
		var titles, descs, links []string
		_ = json.Unmarshal(parsed[1], &titles)
		_ = json.Unmarshal(parsed[2], &descs)
		_ = json.Unmarshal(parsed[3], &links)
		var out []Hit
		for i := range titles {
			title := titles[i]
			snip := ""
			if i < len(descs) {
				snip = descs[i]
			}
			link := ""
			if i < len(links) {
				link = links[i]
			}
			if snip == "" && link != "" {
				// Fetch page extract for empty opensearch descriptions.
				snip = s.wikiExtract(ctx, lang, title)
			}
			out = append(out, Hit{
				Title:   title,
				Snippet: snip,
				Source:  "Wikipedia/" + lang,
				URL:     link,
			})
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

func (s *Service) wikiExtract(ctx context.Context, lang, title string) string {
	u := fmt.Sprintf(
		"https://%s.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=%s&format=json",
		lang, url.QueryEscape(title),
	)
	raw, err := s.get(ctx, u)
	if err != nil {
		return ""
	}
	var parsed struct {
		Query struct {
			Pages map[string]struct {
				Extract string `json:"extract"`
			} `json:"pages"`
		} `json:"query"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return ""
	}
	for _, p := range parsed.Query.Pages {
		return cleanText(p.Extract, 280)
	}
	return ""
}

func (s *Service) googleNews(ctx context.Context, q string) []Hit {
	u := "https://news.google.com/rss/search?q=" + url.QueryEscape(q) + "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
	raw, err := s.get(ctx, u)
	if err != nil {
		return nil
	}
	body := string(raw)
	titles := itemTitleRe.FindAllStringSubmatch(body, 5)
	if len(titles) == 0 {
		return nil
	}
	descs := itemDescRe.FindAllStringSubmatch(body, 5)
	links := itemLinkRe.FindAllStringSubmatch(body, 5)
	var out []Hit
	for i, m := range titles {
		title := cleanText(html.UnescapeString(m[1]), 100)
		snip := ""
		if i < len(descs) {
			snip = cleanText(html.UnescapeString(stripTags(descs[i][1])), 180)
		}
		link := ""
		if i < len(links) {
			link = strings.TrimSpace(links[i][1])
		}
		out = append(out, Hit{Title: title, Snippet: snip, Source: "Google News", URL: link})
	}
	return out
}

func (s *Service) get(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "FluffNestDeskPet/0.2 (+https://github.com/fluffnest)")
	req.Header.Set("Accept", "application/json, application/xml, text/xml, */*")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

func cleanText(s string, max int) string {
	s = strings.TrimSpace(stripTags(html.UnescapeString(s)))
	s = strings.Join(strings.Fields(s), " ")
	if max > 0 && utf8.RuneCountInString(s) > max {
		r := []rune(s)
		s = string(r[:max]) + "…"
	}
	return s
}

func stripTags(s string) string {
	return tagRe.ReplaceAllString(s, " ")
}

func splitDash(s string) (string, string) {
	for _, sep := range []string{" - ", " — ", " – ", "：", ": "} {
		if i := strings.Index(s, sep); i > 0 {
			return strings.TrimSpace(s[:i]), strings.TrimSpace(s[i+len(sep):])
		}
	}
	return s, ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

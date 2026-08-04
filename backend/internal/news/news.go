package news

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/fluffnest/deskpet/backend/internal/cache"
	"github.com/fluffnest/deskpet/backend/internal/geo"
)

type Service struct {
	http  *http.Client
	cache *cache.TTL
}

func New(httpClient *http.Client, c *cache.TTL) *Service {
	return &Service{http: httpClient, cache: c}
}

// Headline is one realtime tech/entertainment item.
type Headline struct {
	Category string `json:"category"`
	Title    string `json:"title"`
	Source   string `json:"source,omitempty"`
	Local    bool   `json:"local,omitempty"`
}

type feed struct {
	Category string
	Name     string
	URL      string
	Region   string // cn | global | ""
	Local    bool   // true = location-biased (e.g. Google News for user locale)
}

var baseFeeds = []feed{
	{"科技", "IT之家", "https://www.ithome.com/rss/", "cn", false},
	{"科技", "Solidot", "https://www.solidot.org/index.rss", "cn", false},
	{"科技", "BBC Tech", "https://feeds.bbci.co.uk/news/technology/rss.xml", "global", false},
	{"科技", "The Verge", "https://www.theverge.com/rss/index.xml", "global", false},
	{"科技", "TechCrunch", "https://techcrunch.com/feed/", "global", false},
	{"娱乐", "中新网娱乐", "https://www.chinanews.com.cn/rss/entertainment.xml", "cn", false},
	{"娱乐", "BBC Entertainment", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", "global", false},
	{"娱乐", "Variety", "https://variety.com/feed/", "global", false},
	{"娱乐", "Billboard", "https://www.billboard.com/feed/", "global", false},
}

var (
	itemRe  = regexp.MustCompile(`(?is)<item\b[^>]*>\s*<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
	entryRe = regexp.MustCompile(`(?is)<entry\b[^>]*>\s*<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
)

// HotHeadline returns one cached headline string for legacy callers.
func (s *Service) HotHeadline(ctx context.Context) (string, error) {
	if v, ok := s.cache.Get("news:headline"); ok {
		return v, nil
	}
	items, err := s.FetchHeadlines(ctx, "both", 8, false, geo.Location{City: "北京", CountryCode: "CN", Source: "default"})
	if err != nil {
		return "", err
	}
	idx := int((uint64(time.Now().Unix()) * 2654435761) % uint64(len(items)))
	out := FormatHeadline(items[idx])
	s.cache.Set("news:headline", out, 10*time.Minute)
	return out, nil
}

// FetchHeadlines pulls realtime tech/entertainment headlines, preferring the user's location.
// category: "tech" | "entertainment" | "both"
func (s *Service) FetchHeadlines(ctx context.Context, category string, limit int, bypassCache bool, loc geo.Location) ([]Headline, error) {
	if limit <= 0 {
		limit = 6
	}
	if limit > 12 {
		limit = 12
	}
	cat := normalizeCategory(category)
	locKey := strings.ToLower(loc.CountryCode) + ":" + loc.City
	cacheKey := fmt.Sprintf("news:list:%s:%d:%s", cat, limit, locKey)
	if !bypassCache {
		if v, ok := s.cache.Get(cacheKey); ok {
			return parseCachedList(v), nil
		}
	}

	ctx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
	defer cancel()

	feeds := feedsForLocation(loc)

	var (
		mu    sync.Mutex
		pool  []Headline
		wg    sync.WaitGroup
		enough = make(chan struct{})
		once  sync.Once
	)
	sem := make(chan struct{}, 5)
	signalEnough := func() {
		once.Do(func() { close(enough) })
	}

	for _, f := range feeds {
		if !categoryMatch(cat, f.Category) {
			continue
		}
		f := f
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-enough:
				return
			case <-ctx.Done():
				return
			case sem <- struct{}{}:
				defer func() { <-sem }()
			}
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.URL, nil)
			if err != nil {
				return
			}
			req.Header.Set("User-Agent", "FluffNest/0.2 (deskpet; +https://github.com/fluffnest)")
			resp, err := s.http.Do(req)
			if err != nil {
				return
			}
			body, err := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
			_ = resp.Body.Close()
			if err != nil || resp.StatusCode >= 400 {
				return
			}
			text := string(body)
			local := make([]Headline, 0, 6)
			for _, re := range []*regexp.Regexp{itemRe, entryRe} {
				matches := re.FindAllStringSubmatch(text, 4)
				for _, m := range matches {
					if len(m) < 2 {
						continue
					}
					title := decodeXMLTitle(m[1])
					if utf8.RuneCountInString(title) >= 6 && !looksLikeFeedMeta(title) {
						local = append(local, Headline{
							Category: f.Category,
							Title:    title,
							Source:   f.Name,
							Local:    f.Local,
						})
					}
				}
			}
			if len(local) == 0 {
				return
			}
			mu.Lock()
			pool = append(pool, local...)
			n := len(pool)
			mu.Unlock()
			// Enough for a snappy reply — don't wait on slow feeds.
			if n >= limit {
				signalEnough()
				cancel()
			}
		}()
	}

	waitDone := make(chan struct{})
	go func() {
		wg.Wait()
		close(waitDone)
	}()
	select {
	case <-enough:
	case <-waitDone:
	case <-ctx.Done():
	}
	// Give in-flight parsers a moment after early cancel.
	select {
	case <-waitDone:
	case <-time.After(200 * time.Millisecond):
	}

	mu.Lock()
	snapshot := append([]Headline(nil), pool...)
	mu.Unlock()

	if len(snapshot) == 0 {
		return nil, fmt.Errorf("暂时拉不到科技/娱乐新闻")
	}

	preferLocal := make([]Headline, 0, len(snapshot))
	rest := make([]Headline, 0, len(snapshot))
	for _, h := range snapshot {
		if h.Local {
			preferLocal = append(preferLocal, h)
		} else {
			rest = append(rest, h)
		}
	}
	ordered := append(preferLocal, rest...)
	start := 0
	if len(preferLocal) == 0 && len(ordered) > 0 {
		start = int((uint64(time.Now().UnixNano()) * 2654435761) % uint64(len(ordered)))
	}

	out := make([]Headline, 0, limit)
	seen := make(map[string]struct{}, limit)
	for i := 0; len(out) < limit && i < len(ordered); i++ {
		h := ordered[(start+i)%len(ordered)]
		key := h.Category + "|" + h.Title
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, h)
	}

	s.cache.Set(cacheKey, serializeList(out), 3*time.Minute)
	if len(out) > 0 {
		s.cache.Set("news:headline", FormatHeadline(out[0]), 10*time.Minute)
	}
	return out, nil
}

func feedsForLocation(loc geo.Location) []feed {
	cc := strings.ToUpper(strings.TrimSpace(loc.CountryCode))
	region := "global"
	if cc == "CN" || cc == "HK" || cc == "TW" || cc == "MO" || looksChineseLocale(loc) {
		region = "cn"
	}

	// Ultra-short list for sub-second replies.
	if region == "cn" {
		return []feed{
			{"科技", "IT之家", "https://www.ithome.com/rss/", "cn", true},
			{"科技", "Solidot", "https://www.solidot.org/index.rss", "cn", true},
			{"娱乐", "中新网娱乐", "https://www.chinanews.com.cn/rss/entertainment.xml", "cn", true},
			{"科技", "The Verge", "https://www.theverge.com/rss/index.xml", "global", false},
		}
	}
	out := make([]feed, 0, 5)
	if cc != "" {
		hl, gl, ceid := googleNewsLocale(cc, false)
		out = append(out,
			feed{"科技", "本地科技", googleTopicURL("TECHNOLOGY", hl, gl, ceid), region, true},
			feed{"娱乐", "本地娱乐", googleTopicURL("ENTERTAINMENT", hl, gl, ceid), region, true},
		)
	}
	out = append(out,
		feed{"科技", "The Verge", "https://www.theverge.com/rss/index.xml", "global", false},
		feed{"娱乐", "Variety", "https://variety.com/feed/", "global", false},
	)
	return out
}

func looksChineseLocale(loc geo.Location) bool {
	blob := loc.Country + loc.Region + loc.City
	for _, r := range blob {
		if r >= 0x4e00 && r <= 0x9fff {
			return true
		}
	}
	return false
}

func googleNewsLocale(cc string, zh bool) (hl, gl, ceid string) {
	gl = cc
	if zh {
		return "zh-CN", cc, cc + ":zh-Hans"
	}
	switch cc {
	case "JP":
		return "ja", "JP", "JP:ja"
	case "KR":
		return "ko", "KR", "KR:ko"
	case "GB", "UK":
		return "en-GB", "GB", "GB:en"
	default:
		return "en-US", cc, cc + ":en"
	}
}

func googleTopicURL(topic, hl, gl, ceid string) string {
	return fmt.Sprintf(
		"https://news.google.com/rss/headlines/section/topic/%s?hl=%s&gl=%s&ceid=%s",
		url.PathEscape(topic), url.QueryEscape(hl), url.QueryEscape(gl), url.QueryEscape(ceid),
	)
}

func FormatHeadline(h Headline) string {
	tag := h.Category
	if h.Local {
		tag = "本地·" + h.Category
	}
	if h.Source != "" {
		return fmt.Sprintf("【%s·%s】%s", tag, h.Source, h.Title)
	}
	return fmt.Sprintf("【%s】%s", tag, h.Title)
}

func FormatHeadlines(items []Headline) string {
	var b strings.Builder
	for i, h := range items {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(fmt.Sprintf("%d. %s", i+1, FormatHeadline(h)))
	}
	return b.String()
}

func normalizeCategory(category string) string {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "tech", "technology", "科技", "数码":
		return "tech"
	case "entertainment", "娱乐", "文娱":
		return "entertainment"
	default:
		return "both"
	}
}

func categoryMatch(want, feedCategory string) bool {
	switch want {
	case "tech":
		return feedCategory == "科技"
	case "entertainment":
		return feedCategory == "娱乐"
	default:
		return true
	}
}

func serializeList(items []Headline) string {
	parts := make([]string, 0, len(items))
	for _, h := range items {
		local := "0"
		if h.Local {
			local = "1"
		}
		parts = append(parts, h.Category+"\t"+h.Source+"\t"+local+"\t"+h.Title)
	}
	return strings.Join(parts, "\n")
}

func parseCachedList(raw string) []Headline {
	lines := strings.Split(raw, "\n")
	out := make([]Headline, 0, len(lines))
	for _, line := range lines {
		// New format: cat \t source \t local \t title
		if parts := strings.SplitN(line, "\t", 4); len(parts) == 4 {
			out = append(out, Headline{
				Category: parts[0],
				Source:   parts[1],
				Local:    parts[2] == "1",
				Title:    parts[3],
			})
			continue
		}
		// Legacy: cat \t source \t title
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 || parts[2] == "" {
			continue
		}
		out = append(out, Headline{Category: parts[0], Source: parts[1], Title: parts[2]})
	}
	return out
}

func decodeXMLTitle(raw string) string {
	r := strings.NewReplacer(
		"&amp;", "&", "&lt;", "<", "&gt;", ">",
		"&quot;", `"`, "&#39;", "'", "&apos;", "'",
		"\n", " ", "\r", " ",
	)
	return strings.Join(strings.Fields(r.Replace(raw)), " ")
}

func looksLikeFeedMeta(title string) bool {
	t := strings.ToLower(title)
	return strings.Contains(t, "rss") ||
		strings.Contains(t, "subscribe") ||
		t == "technology" ||
		t == "entertainment" ||
		utf8.RuneCountInString(title) > 80
}

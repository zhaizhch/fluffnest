package news

import (
	"context"
	"fmt"
	"io"
	"net/http"
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

var (
	itemRe  = regexp.MustCompile(`(?is)<item\b[^>]*>\s*<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
	entryRe = regexp.MustCompile(`(?is)<entry\b[^>]*>\s*<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
)

var feeds = []struct {
	Category string
	URL      string
}{
	{"科技", "https://www.ithome.com/rss/"},
	{"科技", "https://www.solidot.org/index.rss"},
	{"科技", "https://feeds.bbci.co.uk/news/technology/rss.xml"},
	{"科技", "https://www.theverge.com/rss/index.xml"},
	{"科技", "https://techcrunch.com/feed/"},
	{"娱乐", "https://www.chinanews.com.cn/rss/entertainment.xml"},
	{"娱乐", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"},
	{"娱乐", "https://variety.com/feed/"},
	{"娱乐", "https://www.billboard.com/feed/"},
}

func (s *Service) HotHeadline(ctx context.Context) (string, error) {
	if v, ok := s.cache.Get("news:headline"); ok {
		return v, nil
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	type hit struct {
		Category string
		Title    string
	}
	var (
		mu   sync.Mutex
		pool []hit
		wg   sync.WaitGroup
	)
	// Cap concurrency so we don't stampede remote feeds.
	sem := make(chan struct{}, 6)

	for _, f := range feeds {
		f := f
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
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
			body, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
			_ = resp.Body.Close()
			if err != nil || resp.StatusCode >= 400 {
				return
			}
			text := string(body)
			local := make([]hit, 0, 8)
			for _, re := range []*regexp.Regexp{itemRe, entryRe} {
				matches := re.FindAllStringSubmatch(text, 6)
				for _, m := range matches {
					if len(m) < 2 {
						continue
					}
					title := decodeXMLTitle(m[1])
					if utf8.RuneCountInString(title) >= 6 && !looksLikeFeedMeta(title) {
						local = append(local, hit{Category: f.Category, Title: title})
					}
				}
			}
			if len(local) == 0 {
				return
			}
			mu.Lock()
			pool = append(pool, local...)
			mu.Unlock()
		}()
	}
	wg.Wait()

	if len(pool) == 0 {
		return "", fmt.Errorf("暂时拉不到科技/娱乐新闻")
	}
	idx := int((uint64(time.Now().Unix()) * 2654435761) % uint64(len(pool)))
	out := fmt.Sprintf("【%s】%s", pool[idx].Category, pool[idx].Title)
	s.cache.Set("news:headline", out, 10*time.Minute)
	return out, nil
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

// Package search provides federated no-key web lookup for the WeChat agent.
// Inspired by OpenClaw web-search-pro: multi-provider fanout, bilingual queries,
// news vs web shaping, and visible recovery when primary sources fail.
//
// Always dual-lane: domestic (CN Bing / Weixin / Sogou) ∥ international
// (EN Bing / DuckDuckGo / Wikipedia / Google News), then merge+rank.
// Queries are optimized (CN+intl) before each search.
// Detail enrich: jina.ai reader on deep-read queries (名单/区间赏/成绩…)
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
	"unicode"
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
	// Region: "cn" | "intl" — which engine lane produced the hit.
	Region string `json:"region,omitempty"`
}

// Options tunes a search turn.
type Options struct {
	Limit int
	// Type: ""|"web"|"news" — news appends freshness keywords / prefers news sources.
	Type string
	// Scope: cn|intl|both|"" — empty means ClassifyScope(query).
	Scope Scope
	// Optional pre-optimized lanes (from agent LLM rewrite). Empty → OptimizeQuery.
	CNQueries   []string
	IntlQueries []string
}

var (
	itemBlockRe = regexp.MustCompile(`(?is)<item\b[^>]*>(.*?)</item>`)
	itemTitleRe = regexp.MustCompile(`(?is)<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>`)
	itemDescRe  = regexp.MustCompile(`(?is)<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>`)
	itemLinkRe  = regexp.MustCompile(`(?is)<link[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</link>`)
	tagRe       = regexp.MustCompile(`(?is)<[^>]+>`)
	sogouTitleRe = regexp.MustCompile(`(?is)<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>`)
	sogouSnipRe  = regexp.MustCompile(`(?is)class="[^"]*space-txt[^"]*"[^>]*>(.*?)</(?:p|div)>`)
	weixinTitleRe = regexp.MustCompile(`(?is)<a[^>]+href="([^"]+)"[^>]*id="sogou_vr_11002601_title_(\d+)"[^>]*>(.*?)</a>`)
	weixinSumRe   = regexp.MustCompile(`(?is)<p class="txt-info"[^>]*id="sogou_vr_11002601_summary_(\d+)"[^>]*>([\s\S]*?)</p>`)
)

// Common CN ↔ EN aliases so game/product news searches don't die on Instant Answer APIs.
var queryAliases = []struct {
	zh string
	en string
}{
	{"星露谷物语", "Stardew Valley"},
	{"星露谷", "Stardew Valley"},
	{"艾尔登法环", "Elden Ring"},
	{"原神", "Genshin Impact"},
	{"崩坏星穹铁道", "Honkai Star Rail"},
	{"绝区零", "Zenless Zone Zero"},
	{"塞尔达", "Zelda Tears of the Kingdom"},
	{"我的世界", "Minecraft"},
	{"英雄联盟", "League of Legends"},
	{"王者荣耀", "Honor of Kings"},
	{"黑神话悟空", "Black Myth Wukong"},
	{"博德之门", "Baldur's Gate 3"},
	{"赛博朋克", "Cyberpunk 2077"},
	{"最终幻想", "Final Fantasy"},
	{"宝可梦", "Pokemon"},
	{"任天堂", "Nintendo"},
	{"蒸汽平台", "Steam"},
	{"箱根驿传", "Hakone Ekiden"},
	{"箱根駅伝", "Hakone Ekiden"},
	{"箱根接力", "Hakone Ekiden"},
	{"哈兰德", "Haaland"},
	{"黑田朝日", "Kuroda Asahi"},
}

// SearchOpt is the federated entry point: optimize query → scoped fanout → merge.
func (s *Service) SearchOpt(ctx context.Context, query string, opt Options) ([]Hit, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, fmt.Errorf("搜索词为空")
	}
	limit := opt.Limit
	if limit <= 0 {
		limit = 8
	}
	if limit > 12 {
		limit = 12
	}
	kind := strings.ToLower(strings.TrimSpace(opt.Type))
	if kind != "news" {
		kind = "web"
	}

	optimized := OptimizeQuery(q, kind)
	kind = optimized.Kind
	cnQs := optimized.CN
	intlQs := optimized.Intl
	if len(opt.CNQueries) > 0 {
		cnQs = capStrings(opt.CNQueries, 4)
	}
	if len(opt.IntlQueries) > 0 {
		intlQs = capStrings(opt.IntlQueries, 4)
	}

	scope := opt.Scope
	if scope != ScopeCN && scope != ScopeIntl && scope != ScopeBoth {
		scope = ClassifyScope(q)
	}
	// Cap variants per lane for latency.
	qCap := 2
	if scope == ScopeBoth {
		qCap = 2
	}
	cnQs = capStrings(cnQs, qCap)
	intlQs = capStrings(intlQs, qCap)
	if scope == ScopeCN {
		intlQs = nil
	}
	if scope == ScopeIntl {
		cnQs = nil
	}
	allQs := append(append([]string{}, cnQs...), intlQs...)

	cacheKey := fmt.Sprintf("search:v4:%s:%s:%s", scope, kind, strings.ToLower(q))
	if v, ok := s.cache.Get(cacheKey); ok {
		var hits []Hit
		if json.Unmarshal([]byte(v), &hits) == nil && len(hits) > 0 {
			if len(hits) > limit {
				hits = hits[:limit]
			}
			return hits, nil
		}
	}

	wall := 5 * time.Second
	if scope == ScopeBoth {
		wall = 7 * time.Second
	}
	enough := 4
	if limit < enough {
		enough = limit
	}
	hits := s.runSearchAgents(ctx, q, kind, cnQs, intlQs, allQs, enough, wall)

	hits = dedupeHits(hits)
	hits = mergePreferBothRegions(hits)
	hits = rankHits(q, hits)
	if len(hits) == 0 {
		return nil, fmt.Errorf("没有搜到「%s」的可靠结果（scope=%s 国内 %s · 国外 %s）",
			q, scope, strings.Join(cnQs, "/"), strings.Join(intlQs, "/"))
	}
	if needsDeepRead(q) {
		nRead := 1
		if scope == ScopeBoth {
			nRead = 2
		}
		// Short budget for enrich so it can't dominate latency.
		ectx, cancel := context.WithTimeout(ctx, 3*time.Second)
		hits = s.enrichTopHits(ectx, hits, nRead)
		cancel()
	}
	if len(hits) > limit {
		hits = hits[:limit]
	}
	if raw, err := json.Marshal(hits); err == nil {
		s.cache.Set(cacheKey, string(raw), 6*time.Minute)
	}
	return hits, nil
}

// mergePreferBothRegions interleaves domestic and international hits so the
// briefing is not dominated by a single lane.
func mergePreferBothRegions(hits []Hit) []Hit {
	if len(hits) < 2 {
		return hits
	}
	var cn, intl, other []Hit
	for _, h := range hits {
		switch h.Region {
		case "cn":
			cn = append(cn, h)
		case "intl":
			intl = append(intl, h)
		default:
			other = append(other, h)
		}
	}
	if len(cn) == 0 || len(intl) == 0 {
		return hits
	}
	out := make([]Hit, 0, len(hits))
	i, j := 0, 0
	for i < len(cn) || j < len(intl) {
		if i < len(cn) {
			out = append(out, cn[i])
			i++
		}
		if j < len(intl) {
			out = append(out, intl[j])
			j++
		}
	}
	out = append(out, other...)
	return out
}

func toJapaneseSportsForm(s string) string {
	r := strings.NewReplacer(
		"驿传", "駅伝",
		"驿", "駅",
		"区间赏", "区間賞",
		"区间", "区間",
		"黑田朝日", "黒田朝日",
		"山神", "山の神",
	)
	return r.Replace(s)
}

func toChineseSportsForm(s string) string {
	r := strings.NewReplacer(
		"駅伝", "驿传",
		"駅", "驿",
		"区間賞", "区间赏",
		"区間", "区间",
		"黒田朝日", "黑田朝日",
		"山の神", "山神",
	)
	return r.Replace(s)
}

func looksFreshIntent(q string) bool {
	keys := []string{
		"最新", "新料", "更新", "版本", "补丁", "新闻", "热点", "今天", "近日", "刚刚",
		"本届", "本赛季", "赛季", "世界杯", "入选", "国家队", "山神", "山の神",
		"成绩", "冠军", "结果", "谁赢", "比赛", "球员", "选手",
		"latest", "update", "patch", "news", "release", "world cup", "squad", "roster",
	}
	low := strings.ToLower(q)
	for _, k := range keys {
		if strings.Contains(low, strings.ToLower(k)) || strings.Contains(q, k) {
			return true
		}
	}
	return false
}

func hasCJK(s string) bool {
	for _, r := range s {
		if unicode.In(r, unicode.Han) {
			return true
		}
	}
	return false
}

func roughLatinHint(q string) string {
	// If alias already expanded, skip. Otherwise strip CJK punctuation-ish leftovers.
	var b strings.Builder
	for _, r := range q {
		if r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == ' ' || r == '-' || r == '_') {
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

// FormatHits turns hits into a compact briefing for the LLM (CN+intl merged).
func FormatHits(hits []Hit) string {
	if len(hits) == 0 {
		return "（无搜索结果）"
	}
	var cnN, intlN int
	for _, h := range hits {
		switch h.Region {
		case "cn":
			cnN++
		case "intl":
			intlN++
		}
	}
	var b strings.Builder
	if cnN > 0 || intlN > 0 {
		fmt.Fprintf(&b, "（已合并：国内 %d · 国外 %d）\n", cnN, intlN)
	}
	for i, h := range hits {
		src := h.Source
		if h.Region == "cn" && !strings.Contains(src, "国内") {
			src = src + "·国内"
		} else if h.Region == "intl" && !strings.Contains(src, "国际") && !strings.Contains(src, "News") && !strings.Contains(src, "Duck") && !strings.Contains(src, "Wiki") {
			src = src + "·国际"
		}
		fmt.Fprintf(&b, "%d. [%s] %s", i+1, src, h.Title)
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

func (s *Service) bingRSSPref(ctx context.Context, q string, preferCN bool) []Hit {
	var urls []string
	if preferCN {
		urls = []string{
			"https://cn.bing.com/search?q=" + url.QueryEscape(q) + "&format=rss",
			"https://www.bing.com/search?q=" + url.QueryEscape(q) + "&format=rss&setlang=zh-CN",
		}
	} else {
		urls = []string{
			"https://www.bing.com/search?q=" + url.QueryEscape(q) + "&format=rss&setlang=en-US",
			"https://cn.bing.com/search?q=" + url.QueryEscape(q) + "&format=rss",
		}
	}
	var raw []byte
	for _, u := range urls {
		b, err := s.get(ctx, u, 4*time.Second)
		if err == nil && strings.Contains(string(b), "<item") {
			raw = b
			break
		}
	}
	if len(raw) == 0 {
		return nil
	}
	body := string(raw)
	blocks := itemBlockRe.FindAllStringSubmatch(body, 8)
	var out []Hit
	channelTitle := ""
	if m := itemTitleRe.FindStringSubmatch(body); len(m) > 1 {
		channelTitle = cleanText(html.UnescapeString(m[1]), 80)
	}
	for _, blk := range blocks {
		chunk := blk[1]
		tm := itemTitleRe.FindStringSubmatch(chunk)
		if len(tm) < 2 {
			continue
		}
		title := cleanText(html.UnescapeString(tm[1]), 100)
		if title == "" || title == channelTitle || strings.HasPrefix(title, "必应") || strings.HasPrefix(title, "Bing:") {
			continue
		}
		snip := ""
		if dm := itemDescRe.FindStringSubmatch(chunk); len(dm) > 1 {
			snip = cleanText(html.UnescapeString(stripTags(dm[1])), 280)
		}
		link := ""
		if lm := itemLinkRe.FindStringSubmatch(chunk); len(lm) > 1 {
			link = strings.TrimSpace(html.UnescapeString(lm[1]))
		}
		out = append(out, Hit{Title: title, Snippet: snip, Source: "Bing", URL: link})
	}
	return out
}

func (s *Service) sogouHTML(ctx context.Context, q string) []Hit {
	u := "https://www.sogou.com/web?query=" + url.QueryEscape(q)
	raw, err := s.get(ctx, u, 4*time.Second)
	if err != nil {
		return nil
	}
	body := string(raw)
	if strings.Contains(body, "antispider") || strings.Contains(body, "百度安全验证") {
		return nil
	}
	matches := sogouTitleRe.FindAllStringSubmatch(body, 8)
	snips := sogouSnipRe.FindAllStringSubmatch(body, 12)
	var out []Hit
	for i, m := range matches {
		link := html.UnescapeString(strings.TrimSpace(m[1]))
		title := cleanText(html.UnescapeString(stripTags(m[2])), 100)
		snip := ""
		if i < len(snips) {
			snip = cleanText(html.UnescapeString(stripTags(snips[i][1])), 280)
		}
		if title == "" {
			continue
		}
		out = append(out, Hit{Title: title, Snippet: snip, Source: "Sogou", URL: absoluteURL("https://www.sogou.com", link)})
	}
	return out
}

// sogouWeixin scrapes WeChat article search — usually reachable when web sogou is antispider'd.
func (s *Service) sogouWeixin(ctx context.Context, q string) []Hit {
	u := "https://weixin.sogou.com/weixin?type=2&query=" + url.QueryEscape(q)
	raw, err := s.get(ctx, u, 5*time.Second)
	if err != nil {
		return nil
	}
	body := string(raw)
	if !strings.Contains(body, "sogou_vr_11002601_title_") {
		return nil
	}
	titles := weixinTitleRe.FindAllStringSubmatch(body, 10)
	sums := map[string]string{}
	for _, sm := range weixinSumRe.FindAllStringSubmatch(body, 10) {
		if len(sm) == 3 {
			sums[sm[1]] = cleanText(html.UnescapeString(stripTags(sm[2])), 320)
		}
	}
	var out []Hit
	for _, tm := range titles {
		if len(tm) < 4 {
			continue
		}
		link := html.UnescapeString(strings.TrimSpace(tm[1]))
		idx := tm[2]
		title := cleanText(html.UnescapeString(stripTags(tm[3])), 120)
		if title == "" {
			continue
		}
		out = append(out, Hit{
			Title:   title,
			Snippet: sums[idx],
			Source:  "WeChat",
			URL:     absoluteURL("https://weixin.sogou.com", link),
		})
	}
	return out
}

func absoluteURL(base, link string) string {
	link = strings.TrimSpace(link)
	if link == "" {
		return ""
	}
	if strings.HasPrefix(link, "http://") || strings.HasPrefix(link, "https://") {
		return link
	}
	if strings.HasPrefix(link, "//") {
		return "https:" + link
	}
	if strings.HasPrefix(link, "/") {
		return strings.TrimRight(base, "/") + link
	}
	return base + "/" + link
}

func isJunkHit(h Hit) bool {
	blob := strings.ToLower(h.Title + " " + h.Snippet + " " + h.URL)
	junk := []string{
		"汉语国学", "新华字典", "汉语字典", "汉语查", "拼音,意思", "的笔顺",
		"qq邮箱", "163网易免费邮", "集装箱", "纸箱1至", "登录qq",
		"baike.baidu.com/item/%e7%ac%ac/", // 第
		"baike.baidu.com/item/%e7%ae%b1/", // 箱
	}
	for _, j := range junk {
		if strings.Contains(blob, j) {
			return true
		}
	}
	// Single-character dictionary titles like "第（汉语汉字）"
	title := strings.TrimSpace(h.Title)
	if utf8.RuneCountInString(title) <= 12 && (strings.Contains(title, "汉语") || strings.Contains(title, "字典") || strings.Contains(title, "的意思")) {
		return true
	}
	return false
}

func (s *Service) duckDuckGo(ctx context.Context, q string) []Hit {
	u := "https://api.duckduckgo.com/?q=" + url.QueryEscape(q) + "&format=json&no_html=1&skip_disambig=1"
	raw, err := s.get(ctx, u, 3*time.Second)
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
	for _, lang := range []string{"zh", "en"} {
		u := fmt.Sprintf(
			"https://%s.wikipedia.org/w/api.php?action=opensearch&search=%s&limit=3&namespace=0&format=json",
			lang, url.QueryEscape(q),
		)
		raw, err := s.get(ctx, u, 3*time.Second)
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
	raw, err := s.get(ctx, u, 3*time.Second)
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
	raw, err := s.get(ctx, u, 3*time.Second)
	if err != nil {
		// English mirror
		u = "https://news.google.com/rss/search?q=" + url.QueryEscape(q) + "&hl=en-US&gl=US&ceid=US:en"
		raw, err = s.get(ctx, u, 3*time.Second)
		if err != nil {
			return nil
		}
	}
	body := string(raw)
	blocks := itemBlockRe.FindAllStringSubmatch(body, 5)
	var out []Hit
	for _, blk := range blocks {
		chunk := blk[1]
		tm := itemTitleRe.FindStringSubmatch(chunk)
		if len(tm) < 2 {
			continue
		}
		title := cleanText(html.UnescapeString(tm[1]), 100)
		snip := ""
		if dm := itemDescRe.FindStringSubmatch(chunk); len(dm) > 1 {
			snip = cleanText(html.UnescapeString(stripTags(dm[1])), 180)
		}
		link := ""
		if lm := itemLinkRe.FindStringSubmatch(chunk); len(lm) > 1 {
			link = strings.TrimSpace(lm[1])
		}
		out = append(out, Hit{Title: title, Snippet: snip, Source: "Google News", URL: link})
	}
	return out
}

func (s *Service) get(ctx context.Context, rawURL string, softTimeout time.Duration) ([]byte, error) {
	if softTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, softTimeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 FluffNestDeskPet/0.2")
	req.Header.Set("Accept", "application/rss+xml, application/xml, application/json, text/html;q=0.9, */*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// Client usually follows redirects; still accept 2xx only on final response.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 2<<20))
}

func needsDeepRead(q string) bool {
	keys := []string{
		"名单", "选手", "区间赏", "区間賞", "区间", "区間", "成绩", "成績", "冠军", "優勝",
		"结果", "結果", "山神", "山の神", "入选", "世界杯", "国家队",
		"roster", "section", "prize", "winner", "results", "squad", "world cup",
	}
	for _, k := range keys {
		if strings.Contains(q, k) || strings.Contains(strings.ToLower(q), strings.ToLower(k)) {
			return true
		}
	}
	return false
}

// enrichTopHits pulls readable excerpts via jina.ai reader for the top URLs.
func (s *Service) enrichTopHits(ctx context.Context, hits []Hit, n int) []Hit {
	if n <= 0 || len(hits) == 0 {
		return hits
	}
	if n > len(hits) {
		n = len(hits)
	}
	type enr struct {
		i   int
		txt string
	}
	ch := make(chan enr, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		u := strings.TrimSpace(hits[i].URL)
		if u == "" || strings.Contains(u, "sogou.com/link") {
			continue
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			continue
		}
		wg.Add(1)
		go func(i int, page string) {
			defer wg.Done()
			readerURL := "https://r.jina.ai/http://" + strings.TrimPrefix(strings.TrimPrefix(page, "https://"), "http://")
			raw, err := s.get(ctx, readerURL, 5*time.Second)
			if err != nil || len(raw) < 80 {
				return
			}
			txt := cleanText(string(raw), 900)
			if txt == "" {
				return
			}
			ch <- enr{i: i, txt: txt}
		}(i, u)
	}
	wg.Wait()
	close(ch)
	for e := range ch {
		if e.txt == "" {
			continue
		}
		snip := hits[e.i].Snippet
		if snip != "" {
			hits[e.i].Snippet = snip + "｜正文摘录：" + e.txt
		} else {
			hits[e.i].Snippet = "正文摘录：" + e.txt
		}
		hits[e.i].Source = hits[e.i].Source + "+read"
	}
	return hits
}

func looksRelevant(q string, h Hit) bool {
	blob := foldSportsOrthography(strings.ToLower(h.Title + " " + h.Snippet + " " + h.URL))
	tokens := relevanceTokens(q)
	if len(tokens) == 0 {
		return true
	}
	hit := 0
	for _, t := range tokens {
		t = foldSportsOrthography(t)
		if strings.Contains(blob, t) {
			hit++
		}
	}
	if len(tokens) <= 2 {
		return hit >= 1
	}
	need := (len(tokens) + 1) / 2
	if need < 1 {
		need = 1
	}
	return hit >= need
}

func foldSportsOrthography(s string) string {
	r := strings.NewReplacer(
		"驿", "駅", "传", "伝", "區", "区", "間", "间", "賞", "赏",
		"驛", "駅", "傳", "伝",
	)
	return r.Replace(s)
}

func sportsIntent(q string) bool {
	q = foldSportsOrthography(q)
	keys := []string{"駅伝", "驿传", "ekiden", "区間", "区间", "接力", "大学駅伝", "箱根駅"}
	low := strings.ToLower(q)
	for _, k := range keys {
		if strings.Contains(q, k) || strings.Contains(low, strings.ToLower(k)) {
			return true
		}
	}
	return false
}

func isTourismNoise(q string, h Hit) bool {
	if !sportsIntent(q) && !strings.Contains(foldSportsOrthography(q), "箱根") {
		return false
	}
	// Only filter when the query is about the race (駅伝) or clearly race-y.
	if !sportsIntent(q) {
		return false
	}
	blob := foldSportsOrthography(strings.ToLower(h.Title + " " + h.Snippet + " " + h.URL))
	sports := false
	for _, k := range []string{"駅伝", "ekiden", "区間", "区間賞", "接力", "往路", "復路", "大学"} {
		if strings.Contains(blob, strings.ToLower(k)) || strings.Contains(blob, k) {
			sports = true
			break
		}
	}
	tourism := false
	for _, k := range []string{"温泉", "観光", "travel", "sightseeing", "旅馆", "ホテル", "hot spring", "ryokan", "旅游", "目的地"} {
		if strings.Contains(blob, k) {
			tourism = true
			break
		}
	}
	return tourism && !sports
}

func rankHits(q string, hits []Hit) []Hit {
	if len(hits) < 2 {
		return hits
	}
	type scored struct {
		h Hit
		s int
	}
	arr := make([]scored, 0, len(hits))
	for _, h := range hits {
		arr = append(arr, scored{h: h, s: scoreHit(q, h)})
	}
	for i := 0; i < len(arr); i++ {
		for j := i + 1; j < len(arr); j++ {
			if arr[j].s > arr[i].s {
				arr[i], arr[j] = arr[j], arr[i]
			}
		}
	}
	out := make([]Hit, len(arr))
	for i := range arr {
		out[i] = arr[i].h
	}
	return out
}

func scoreHit(q string, h Hit) int {
	blob := foldSportsOrthography(strings.ToLower(h.Title + " " + h.Snippet))
	score := 0
	for _, t := range relevanceTokens(q) {
		if strings.Contains(blob, foldSportsOrthography(t)) {
			score++
		}
	}
	boosts := []struct {
		k string
		n int
	}{
		{"駅伝", 8}, {"ekiden", 8}, {"区間賞", 6}, {"区间赏", 6}, {"区間", 4},
		{"往路", 3}, {"復路", 3}, {"優勝", 3}, {"冠军", 3}, {"名单", 3},
	}
	for _, b := range boosts {
		if strings.Contains(blob, strings.ToLower(b.k)) || strings.Contains(blob, b.k) {
			score += b.n
		}
	}
	for _, k := range []string{"温泉", "観光", "travel guide", "hot spring"} {
		if strings.Contains(blob, k) {
			score -= 8
		}
	}
	// Prefer hits that mention explicit edition numbers from the query (e.g. 102回).
	for _, part := range strings.FieldsFunc(q, func(r rune) bool {
		return unicode.IsSpace(r) || r == '，' || r == ','
	}) {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.ContainsAny(part, "0123456789０１２３４５６７８９") && strings.Contains(blob, foldSportsOrthography(strings.ToLower(part))) {
			score += 4
		}
	}
	if strings.Contains(h.Source, "Sogou") {
		score += 1
	}
	if strings.Contains(h.Source, "+read") {
		score += 2
	}
	return score
}

func relevanceTokens(q string) []string {
	q = strings.ToLower(strings.TrimSpace(q))
	var out []string
	seen := map[string]bool{}
	add := func(t string) {
		t = strings.TrimSpace(strings.ToLower(t))
		if utf8.RuneCountInString(t) < 2 || seen[t] {
			return
		}
		// Skip ultra-common fillers.
		switch t {
		case "the", "and", "for", "最新", "更新", "新闻", "什么", "怎么", "一下", "查询", "搜索", "news", "update", "latest":
			return
		}
		seen[t] = true
		out = append(out, t)
	}
	for _, a := range queryAliases {
		if strings.Contains(q, strings.ToLower(a.zh)) || strings.Contains(q, strings.ToLower(a.en)) {
			add(a.zh)
			add(strings.ToLower(a.en))
			for _, w := range strings.Fields(strings.ToLower(a.en)) {
				add(w)
			}
		}
	}
	// Latin words
	var buf strings.Builder
	flush := func() {
		if buf.Len() > 0 {
			add(buf.String())
			buf.Reset()
		}
	}
	for _, r := range q {
		if unicode.IsLetter(r) && r < 128 || unicode.IsDigit(r) {
			buf.WriteRune(unicode.ToLower(r))
		} else {
			flush()
			if unicode.In(r, unicode.Han) {
				// CJK bigrams later from full string
			}
		}
	}
	flush()
	// CJK bigrams from original
	runes := []rune(q)
	for i := 0; i+1 < len(runes); i++ {
		if unicode.In(runes[i], unicode.Han) && unicode.In(runes[i+1], unicode.Han) {
			add(string(runes[i : i+2]))
		}
	}
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func dedupeHits(in []Hit) []Hit {
	seen := map[string]bool{}
	var out []Hit
	for _, h := range in {
		key := strings.ToLower(h.URL)
		if key == "" {
			key = strings.ToLower(h.Title)
		}
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, h)
	}
	return out
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

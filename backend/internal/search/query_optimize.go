package search

import (
	"regexp"
	"strings"
)

// OptimizedQuery is a search-ready rewrite of the user's raw question.
// Domestic (CN) and international (EN/JP) lanes are filled separately so
// both engine groups can run in parallel and merge.
type OptimizedQuery struct {
	Original string   `json:"original"`
	Kind     string   `json:"kind"` // web|news
	CN       []string `json:"cn"`
	Intl     []string `json:"intl"`
	Note     string   `json:"note,omitempty"`
}

var (
	// Require at least one filler token — optional-only groups match empty strings and
	// would otherwise insert spaces between every CJK rune.
	fillerRe = regexp.MustCompile(`(?i)(?:请|麻烦|帮我|帮忙|替我)?(?:查一下|搜一下|搜索一下|找一下|看一下|查一查|搜一搜|告诉我|问一下|请问)`)
	trailAskRe = regexp.MustCompile(`[?？!！。．…]+$`)
	chatNoiseRe = regexp.MustCompile(`(?i)^(你好|在吗|嗨|hi|hello)[,，\s]*`)
)

// OptimizeQuery rewrites a conversational question into tight CN + intl search terms.
func OptimizeQuery(raw, kind string) OptimizedQuery {
	raw = strings.TrimSpace(raw)
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != "news" {
		kind = "web"
	}
	if looksFreshIntent(raw) {
		kind = "news"
	}

	core := cleanUserQuestion(raw)
	if core == "" {
		core = raw
	}

	out := OptimizedQuery{
		Original: raw,
		Kind:     kind,
		Note:     "已优化检索词（国内+国外分轨）",
	}

	seenCN := map[string]bool{}
	seenIntl := map[string]bool{}
	addCN := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seenCN[strings.ToLower(s)] {
			return
		}
		seenCN[strings.ToLower(s)] = true
		out.CN = append(out.CN, s)
	}
	addIntl := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || seenIntl[strings.ToLower(s)] {
			return
		}
		seenIntl[strings.ToLower(s)] = true
		out.Intl = append(out.Intl, s)
	}

	// —— Domestic core ——
	addCN(core)
	if jp := toJapaneseSportsForm(core); jp != core {
		addCN(jp)
	}
	if cn := toChineseSportsForm(core); cn != core {
		addCN(cn)
	}

	// —— International / EN / JP ——
	low := strings.ToLower(core)
	for _, a := range queryAliases {
		if strings.Contains(core, a.zh) || strings.Contains(low, strings.ToLower(a.en)) {
			enCore := strings.ReplaceAll(core, a.zh, a.en)
			addIntl(enCore)
			addIntl(a.en)
			addCN(strings.ReplaceAll(core, a.en, a.zh))
			if kind == "news" {
				addIntl(a.en + " results")
				addIntl(a.en + " news")
				addCN(a.zh + " 最新")
				addCN(a.zh + " 成绩")
			}
		}
	}
	if jp := toJapaneseSportsForm(core); jp != core {
		addIntl(jp)
	}
	if en := roughLatinHint(core); en != "" && len(en) >= 3 {
		addIntl(en)
	}
	// If query is already Latin-heavy, push it to intl and keep a CN mirror when possible.
	if !hasCJK(core) {
		addIntl(core)
		if kind == "news" {
			addIntl(core + " latest")
			addIntl(core + " results")
		}
	} else if kind == "news" {
		addCN(core + " 最新")
		addCN(compactNewsCN(core))
	}

	// Intent-specific shaping for awards / rosters / winners.
	shapeIntentQueries(core, kind, addCN, addIntl)

	if len(out.CN) == 0 {
		addCN(core)
	}
	if len(out.Intl) == 0 {
		// Always give intl lane something to try (alias or translit fallback).
		if en := firstAliasEN(core); en != "" {
			addIntl(en)
		} else if jp := toJapaneseSportsForm(core); jp != core {
			addIntl(jp)
		} else {
			addIntl(core)
		}
	}

	out.CN = capStrings(out.CN, 4)
	out.Intl = capStrings(out.Intl, 4)
	return out
}

// All returns unique CN∪Intl terms (legacy ExpandQueries shape).
func (o OptimizedQuery) All() []string {
	seen := map[string]bool{}
	var out []string
	for _, xs := range [][]string{o.CN, o.Intl} {
		for _, s := range xs {
			k := strings.ToLower(strings.TrimSpace(s))
			if k == "" || seen[k] {
				continue
			}
			seen[k] = true
			out = append(out, s)
		}
	}
	return out
}

func cleanUserQuestion(q string) string {
	q = strings.TrimSpace(q)
	q = chatNoiseRe.ReplaceAllString(q, "")
	q = fillerRe.ReplaceAllString(q, " ")
	q = trailAskRe.ReplaceAllString(q, "")
	// Drop soft question wrappers that hurt keyword search (multi-rune phrases only).
	for _, w := range []string{
		"是什么意思", "是什么", "怎么样", "怎么回事", "有没有", "有什么",
		"能不能", "可以吗", "是谁", "who won", "what is", "what's", "tell me",
	} {
		q = strings.ReplaceAll(q, w, " ")
		if low := strings.ToLower(w); low != w {
			q = strings.ReplaceAll(strings.ToLower(q), low, " ")
		}
	}
	// Strip trailing soft particles only.
	q = strings.TrimRightFunc(q, func(r rune) bool {
		switch r {
		case '吗', '呢', '啊', '吧', '呗', '呀', '嘛', '？', '?', '！', '!':
			return true
		}
		return false
	})
	return strings.Join(strings.Fields(q), " ")
}

func shapeIntentQueries(core, kind string, addCN, addIntl func(string)) {
	blob := core
	low := strings.ToLower(core)
	has := func(xs ...string) bool {
		for _, x := range xs {
			if strings.Contains(blob, x) || strings.Contains(low, strings.ToLower(x)) {
				return true
			}
		}
		return false
	}
	baseCN := stripIntentNoise(core)
	baseJP := toJapaneseSportsForm(baseCN)
	baseEN := firstAliasEN(core)
	if baseEN == "" {
		baseEN = roughLatinHint(core)
	}

	switch {
	case has("区间赏", "区間賞", "section award"):
		addCN(baseCN + " 区间赏")
		addCN(baseJP + " 区間賞")
		if baseEN != "" {
			addIntl(baseEN + " section awards")
			addIntl(baseEN + " 区間賞")
		}
	case has("名单", "选手", "roster", "entry list"):
		addCN(baseCN + " 名单")
		addIntl(strings.TrimSpace(baseEN + " roster"))
		addIntl(strings.TrimSpace(baseEN + " entry list"))
	case has("冠军", "谁赢", "winner", "champion", "総合優勝"):
		addCN(baseCN + " 冠军")
		addCN(baseCN + " 成绩")
		if baseEN != "" {
			addIntl(baseEN + " winner")
			addIntl(baseEN + " results")
		}
	case kind == "news" && hasCJK(core):
		addCN(baseCN + " 成绩")
	}
}

func stripIntentNoise(s string) string {
	r := strings.NewReplacer(
		"区间赏", "", "区間賞", "",
		"名单", "", "选手", "",
		"冠军", "", "成绩", "", "结果", "",
		"最新", "", "新料", "", "更新", "",
	)
	return strings.Join(strings.Fields(r.Replace(s)), " ")
}

func compactNewsCN(core string) string {
	base := stripIntentNoise(core)
	if base == "" {
		base = core
	}
	return base + " 最新消息"
}

func firstAliasEN(q string) string {
	low := strings.ToLower(q)
	for _, a := range queryAliases {
		if strings.Contains(q, a.zh) || strings.Contains(low, strings.ToLower(a.en)) {
			return a.en
		}
	}
	return ""
}

func capStrings(xs []string, n int) []string {
	if len(xs) <= n {
		return xs
	}
	return xs[:n]
}

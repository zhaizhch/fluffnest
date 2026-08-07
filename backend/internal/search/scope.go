package search

import (
	"strings"
	"unicode"
)

// Scope selects which engine lane(s) to hit.
type Scope string

const (
	ScopeCN   Scope = "cn"   // domestic engines only
	ScopeIntl Scope = "intl" // international engines only
	ScopeBoth Scope = "both" // both lanes (slower; use sparingly)
)

// ClassifyScope picks CN vs intl vs both from the query shape.
// Goal: avoid always paying for dual-lane latency.
func ClassifyScope(q string) Scope {
	q = strings.TrimSpace(q)
	if q == "" {
		return ScopeCN
	}
	low := strings.ToLower(q)
	cjk := hasCJK(q)
	latin := hasLatinWord(q)

	intlScore := 0
	cnScore := 0

	for _, k := range []string{
		"world cup", "haaland", "premier league", "nba", "mlb", "nfl",
		"champions league", "uefa", "fifa", "steam", "patch notes",
		"github", "openai", "google", "apple", "tesla",
	} {
		if strings.Contains(low, k) {
			intlScore += 2
		}
	}
	for _, k := range []string{
		"世界杯", "欧冠", "英超", "美联储", "华尔街", "好莱坞",
	} {
		if strings.Contains(q, k) {
			intlScore++
		}
	}
	// Known bilingual entities (games/sports aliases) usually need the intl lane.
	for _, a := range queryAliases {
		if strings.Contains(q, a.zh) || strings.Contains(low, strings.ToLower(a.en)) {
			intlScore++
			if hasCJK(a.zh) {
				cnScore++
			}
		}
	}
	for _, k := range []string{
		"箱根", "驿传", "駅伝", "山神", "区间赏", "区間賞",
		"春晚", "央视", "微博", "抖音", "高铁", "高考",
		"京东", "淘宝", "微信", "春节", "两会",
	} {
		if strings.Contains(q, k) {
			cnScore += 2
		}
	}
	// Japanese sports orthography → still best served by CN WeChat + JP terms on CN lane,
	// but English writeups help: slight both bias only when JP form present with Latin.
	if strings.Contains(q, "駅") || strings.Contains(q, "黒田") || strings.Contains(q, "山の神") {
		cnScore += 2
	}

	switch {
	case intlScore > cnScore && intlScore >= 2:
		if cjk {
			return ScopeBoth
		}
		return ScopeIntl
	case cnScore > intlScore && cnScore >= 2:
		return ScopeCN
	case intlScore >= 2 && cnScore >= 2:
		return ScopeBoth
	case cjk && !latin:
		return ScopeCN
	case latin && !cjk:
		return ScopeIntl
	case cjk && latin:
		return ScopeBoth
	case cjk:
		return ScopeCN
	default:
		return ScopeIntl
	}
}

func hasLatinWord(s string) bool {
	letter := 0
	for _, r := range s {
		if r < 128 && unicode.IsLetter(r) {
			letter++
			if letter >= 3 {
				return true
			}
		} else if unicode.Is(unicode.Han, r) {
			letter = 0
		}
	}
	return letter >= 3
}

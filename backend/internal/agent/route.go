package agent

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

const maxRoutedSkills = 3

// RouteSkills picks skills using triggers, follow-up continuity, and soft scoring.
// Prefer this over MatchSkills alone for multi-turn WeChat threads.
func (c Catalog) RouteSkills(userText string, history []types.ChatMessage, lastSkills []string) []Skill {
	text := strings.TrimSpace(userText)
	if text == "" {
		return nil
	}

	direct := preferTaskSkills(c.MatchSkills(text))
	if len(direct) > 0 {
		return limitSkills(direct, maxRoutedSkills)
	}

	if isFollowUp(text) {
		if cont := c.skillsByNames(lastSkills); len(cont) > 0 {
			return limitSkills(cont, 2)
		}
		for i := len(history) - 1; i >= 0 && i >= len(history)-6; i-- {
			m := history[i]
			if strings.TrimSpace(m.Content) == "" {
				continue
			}
			// Strip [微信] prefix used in host chat history.
			body := strings.TrimSpace(strings.TrimPrefix(m.Content, "[微信]"))
			if hit := preferTaskSkills(c.MatchSkills(body)); len(hit) > 0 {
				return limitSkills(hit, 2)
			}
		}
		if clarify, ok := c.FindSkill("clarify"); ok {
			return []Skill{clarify}
		}
	}

	scored := c.scoreSkills(text)
	if len(scored) > 0 {
		return scored
	}

	// Very short / vague → clarify when available.
	if runeLen(text) <= 8 {
		if clarify, ok := c.FindSkill("clarify"); ok && looksVague(text) {
			return []Skill{clarify}
		}
	}
	return nil
}

func (c Catalog) skillsByNames(names []string) []Skill {
	var out []Skill
	seen := map[string]bool{}
	for _, n := range names {
		sk, ok := c.FindSkill(n)
		if !ok || seen[sk.Name] {
			continue
		}
		seen[sk.Name] = true
		out = append(out, sk)
	}
	return out
}

func (c Catalog) scoreSkills(text string) []Skill {
	low := strings.ToLower(text)
	type scored struct {
		sk    Skill
		score int
	}
	var ranked []scored
	for _, sk := range c.Skills {
		score := 0
		for _, trig := range sk.Triggers {
			t := strings.ToLower(strings.TrimSpace(trig))
			if t == "" {
				continue
			}
			if strings.Contains(low, t) {
				score += 5
			}
		}
		// Soft overlap on description tokens (CJK bigrams + latin words).
		for _, tok := range softTokens(sk.Description) {
			if len(tok) >= 2 && strings.Contains(low, tok) {
				score += 1
			}
		}
		for _, tok := range softTokens(sk.Name) {
			if len(tok) >= 2 && strings.Contains(low, tok) {
				score += 2
			}
		}
		if score >= 3 {
			ranked = append(ranked, scored{sk: sk, score: score})
		}
	}
	if len(ranked) == 0 {
		return nil
	}
	// Simple insertion sort by score desc.
	for i := 1; i < len(ranked); i++ {
		j := i
		for j > 0 && ranked[j-1].score < ranked[j].score {
			ranked[j-1], ranked[j] = ranked[j], ranked[j-1]
			j--
		}
	}
	var out []Skill
	for i, r := range ranked {
		if i >= maxRoutedSkills {
			break
		}
		out = append(out, r.sk)
	}
	return out
}

func softTokens(s string) []string {
	s = strings.ToLower(s)
	var out []string
	var latin strings.Builder
	flushLatin := func() {
		if latin.Len() >= 3 {
			out = append(out, latin.String())
		}
		latin.Reset()
	}
	runes := []rune(s)
	for i, r := range runes {
		if unicode.Is(unicode.Han, r) {
			flushLatin()
			if i+1 < len(runes) && unicode.Is(unicode.Han, runes[i+1]) {
				out = append(out, string([]rune{r, runes[i+1]}))
			}
			continue
		}
		if unicode.IsLetter(r) {
			latin.WriteRune(r)
			continue
		}
		flushLatin()
	}
	flushLatin()
	return out
}

func isFollowUp(text string) bool {
	t := strings.TrimSpace(strings.ToLower(text))
	if t == "" {
		return false
	}
	followUps := []string{
		"再来一个", "再来首", "再讲一个", "下一个", "继续", "然后呢", "还有呢",
		"换成", "改成", "英文呢", "中文呢", "再说详细点", "详细一点", "简单点",
		"那个", "刚才", "上面", "同上", "同样", "也一样", "同样再来",
		"again", "another", "more", "continue", "same",
	}
	for _, f := range followUps {
		if strings.Contains(t, f) {
			return true
		}
	}
	// Ultra-short acknowledgements / pronouns
	if runeLen(t) <= 4 {
		for _, f := range []string{"嗯", "哦", "好", "行", "可以", "这个", "那个", "呢"} {
			if t == f || strings.HasPrefix(t, f) {
				return true
			}
		}
	}
	return false
}

func looksVague(text string) bool {
	t := strings.TrimSpace(text)
	vague := []string{"帮我", "弄一下", "处理下", "看看", "那个", "随便", "都行", "你懂的", "搞定"}
	for _, v := range vague {
		if strings.Contains(t, v) {
			return true
		}
	}
	return runeLen(t) <= 4
}

func limitSkills(in []Skill, n int) []Skill {
	if len(in) <= n {
		return in
	}
	return in[:n]
}

// preferTaskSkills drops pure small-talk when a task skill also matched
// (e.g. English "hello" inside a translate request).
func preferTaskSkills(in []Skill) []Skill {
	if len(in) <= 1 {
		return in
	}
	var task []Skill
	for _, sk := range in {
		switch sk.Name {
		case "companion", "clarify":
			continue
		default:
			task = append(task, sk)
		}
	}
	if len(task) > 0 {
		return task
	}
	return in
}

func runeLen(s string) int {
	return len([]rune(s))
}

// FormatRoutedSkills explains why skills were chosen (for traces / prompts).
func FormatRoutedSkills(skills []Skill) string {
	if len(skills) == 0 {
		return ""
	}
	var b strings.Builder
	for i, sk := range skills {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "%s", sk.Name)
	}
	return b.String()
}

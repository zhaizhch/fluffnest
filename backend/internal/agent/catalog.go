package agent

import (
	"bufio"
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
)

//go:embed rules/*.md skills/*/SKILL.md
var bundled embed.FS

type Rule struct {
	Name     string
	Priority int
	Always   bool
	Channel  string
	Body     string
}

type Skill struct {
	Name        string
	Description string
	Triggers    []string
	Body        string
}

type Catalog struct {
	Rules  []Rule
	Skills []Skill
}

func LoadCatalog() (Catalog, error) {
	var cat Catalog
	rules, err := loadRules()
	if err != nil {
		return cat, err
	}
	skills, err := loadSkills()
	if err != nil {
		return cat, err
	}
	cat.Rules = rules
	cat.Skills = skills
	return cat, nil
}

func loadRules() ([]Rule, error) {
	entries, err := fs.ReadDir(bundled, "rules")
	if err != nil {
		return nil, err
	}
	var out []Rule
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		raw, err := bundled.ReadFile(path.Join("rules", e.Name()))
		if err != nil {
			return nil, err
		}
		meta, body := parseFrontmatter(string(raw))
		r := Rule{
			Name:     firstNonEmpty(meta["name"], strings.TrimSuffix(e.Name(), ".md")),
			Priority: atoiDefault(meta["priority"], 100),
			Always:   meta["always"] == "true" || meta["always"] == "1" || meta["always"] == "",
			Channel:  meta["channel"],
			Body:     strings.TrimSpace(body),
		}
		if meta["always"] == "false" || meta["always"] == "0" {
			r.Always = false
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority < out[j].Priority
	})
	return out, nil
}

func loadSkills() ([]Skill, error) {
	entries, err := fs.ReadDir(bundled, "skills")
	if err != nil {
		return nil, err
	}
	var out []Skill
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := bundled.ReadFile(path.Join("skills", e.Name(), "SKILL.md"))
		if err != nil {
			continue
		}
		meta, body := parseFrontmatter(string(raw))
		sk := Skill{
			Name:        firstNonEmpty(meta["name"], e.Name()),
			Description: meta["description"],
			Triggers:    splitList(meta["triggers"]),
			Body:        strings.TrimSpace(body),
		}
		out = append(out, sk)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (c Catalog) ActiveRules(channel string) []Rule {
	var out []Rule
	for _, r := range c.Rules {
		if r.Channel != "" && channel != "" && !strings.EqualFold(r.Channel, channel) {
			continue
		}
		if r.Always || r.Channel != "" {
			out = append(out, r)
		}
	}
	return out
}

func (c Catalog) FindSkill(name string) (Skill, bool) {
	name = strings.TrimSpace(strings.ToLower(name))
	for _, s := range c.Skills {
		if strings.ToLower(s.Name) == name {
			return s, true
		}
	}
	return Skill{}, false
}

func (c Catalog) MatchSkills(userText string) []Skill {
	t := strings.ToLower(userText)
	var out []Skill
	seen := map[string]bool{}
	for _, s := range c.Skills {
		for _, trig := range s.Triggers {
			trig = strings.ToLower(strings.TrimSpace(trig))
			if trig == "" {
				continue
			}
			if strings.Contains(t, trig) {
				if !seen[s.Name] {
					out = append(out, s)
					seen[s.Name] = true
				}
				break
			}
		}
	}
	return out
}

func (c Catalog) SkillsBrief() string {
	var b strings.Builder
	for _, s := range c.Skills {
		fmt.Fprintf(&b, "- %s: %s\n", s.Name, s.Description)
	}
	return strings.TrimSpace(b.String())
}

func (c Catalog) RulesPrompt(channel string) string {
	rules := c.ActiveRules(channel)
	var b strings.Builder
	b.WriteString("## Active Rules\n")
	for _, r := range rules {
		fmt.Fprintf(&b, "### Rule: %s\n%s\n\n", r.Name, r.Body)
	}
	return strings.TrimSpace(b.String())
}

func parseFrontmatter(raw string) (map[string]string, string) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	if !strings.HasPrefix(raw, "---\n") {
		return map[string]string{}, raw
	}
	rest := strings.TrimPrefix(raw, "---\n")
	idx := strings.Index(rest, "\n---\n")
	if idx < 0 {
		return map[string]string{}, raw
	}
	fm := rest[:idx]
	body := rest[idx+len("\n---\n"):]
	meta := map[string]string{}
	sc := bufio.NewScanner(bytes.NewReader([]byte(fm)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		meta[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return meta, body
}

func splitList(v string) []string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(v, "[")
	v = strings.TrimSuffix(v, "]")
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, `"'`)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func atoiDefault(s string, def int) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

package agent

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// JournalEntry is a time-indexed personal note (thought / diary / mood / reflection).
type JournalEntry struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"` // thought|diary|mood|reflection
	Text      string   `json:"text"`
	Date      string   `json:"date"` // YYYY-MM-DD (local)
	Month     string   `json:"month"` // YYYY-MM for grouping
	CreatedAt string   `json:"createdAt"`
	Tags      []string `json:"tags,omitempty"`
	Source    string   `json:"source,omitempty"`
}

const (
	journalKeepMax     = 240
	journalTextRunes   = 800
	journalBriefDays   = 7
	journalBriefMax    = 5
	journalListDefault = 12
)

func normalizeJournalKind(kind string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	switch kind {
	case "thought", "想法", "idea":
		return "thought"
	case "diary", "日记", "journal":
		return "diary"
	case "mood", "心情", "情绪":
		return "mood"
	case "reflection", "反思", "感悟":
		return "reflection"
	default:
		if kind == "" {
			return "thought"
		}
		return "thought"
	}
}

func localDateParts(t time.Time) (date, month string) {
	t = t.Local()
	return t.Format("2006-01-02"), t.Format("2006-01")
}

func parseJournalDate(raw string) (date, month string, ok bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", false
	}
	// Accept YYYY-MM-DD or YYYY/MM/DD
	raw = strings.ReplaceAll(raw, "/", "-")
	t, err := time.ParseInLocation("2006-01-02", raw, time.Local)
	if err != nil {
		return "", "", false
	}
	d, m := localDateParts(t)
	return d, m, true
}

// JournalAppend stores a personal thought/diary entry under the peer, classified by date.
func (m *Memory) JournalAppend(peerID, kind, text, dateHint, source string, tags []string) (JournalEntry, error) {
	var zero JournalEntry
	if m == nil {
		return zero, fmt.Errorf("memory nil")
	}
	peerID = strings.TrimSpace(peerID)
	text = strings.TrimSpace(text)
	if peerID == "" || text == "" {
		return zero, fmt.Errorf("peer/text 不能为空")
	}
	if looksSecret("journal", text) {
		return zero, fmt.Errorf("拒绝存储疑似敏感信息")
	}
	kind = normalizeJournalKind(kind)
	now := time.Now()
	date, month := localDateParts(now)
	if d, mo, ok := parseJournalDate(dateHint); ok {
		date, month = d, mo
	}
	text = truncateRunes(text, journalTextRunes)
	cleanTags := make([]string, 0, len(tags))
	seen := map[string]bool{}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[strings.ToLower(t)] {
			continue
		}
		seen[strings.ToLower(t)] = true
		cleanTags = append(cleanTags, truncateRunes(t, 24))
		if len(cleanTags) >= 6 {
			break
		}
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Journals == nil {
		m.Journals = map[string][]JournalEntry{}
	}
	entry := JournalEntry{
		ID:        fmt.Sprintf("%s-%d", date, now.UnixNano()%1_000_000_000),
		Kind:      kind,
		Text:      text,
		Date:      date,
		Month:     month,
		CreatedAt: now.UTC().Format(time.RFC3339),
		Tags:      cleanTags,
		Source:    strings.TrimSpace(source),
	}
	list := append(m.Journals[peerID], entry)
	if len(list) > journalKeepMax {
		list = list[len(list)-journalKeepMax:]
	}
	m.Journals[peerID] = list
	if err := m.saveLocked(); err != nil {
		return zero, err
	}
	return entry, nil
}

// JournalList returns entries newest-first, optionally filtered by month (YYYY-MM),
// date (YYYY-MM-DD), kind, or recent day count.
func (m *Memory) JournalList(peerID, month, date, kind string, recentDays, limit int) []JournalEntry {
	if m == nil {
		return nil
	}
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		return nil
	}
	kind = strings.TrimSpace(kind)
	if kind != "" {
		kind = normalizeJournalKind(kind)
	}
	month = strings.TrimSpace(month)
	date = strings.TrimSpace(date)
	if limit <= 0 {
		limit = journalListDefault
	}
	if limit > 40 {
		limit = 40
	}
	cutoff := ""
	if recentDays > 0 {
		cutoff = time.Now().Local().AddDate(0, 0, -recentDays).Format("2006-01-02")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	src := m.Journals[peerID]
	var out []JournalEntry
	for i := len(src) - 1; i >= 0; i-- {
		e := src[i]
		if month != "" && e.Month != month {
			continue
		}
		if date != "" && e.Date != date {
			continue
		}
		if kind != "" && e.Kind != kind {
			continue
		}
		if cutoff != "" && e.Date < cutoff {
			continue
		}
		out = append(out, e)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// JournalSearch finds entries whose text/tags match query (newest first).
func (m *Memory) JournalSearch(peerID, query string, limit int) []JournalEntry {
	if m == nil {
		return nil
	}
	peerID = strings.TrimSpace(peerID)
	query = strings.ToLower(strings.TrimSpace(query))
	if peerID == "" || query == "" {
		return nil
	}
	if limit <= 0 {
		limit = journalListDefault
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	src := m.Journals[peerID]
	var out []JournalEntry
	for i := len(src) - 1; i >= 0; i-- {
		e := src[i]
		blob := strings.ToLower(e.Text + " " + e.Kind + " " + strings.Join(e.Tags, " "))
		if !strings.Contains(blob, query) {
			continue
		}
		out = append(out, e)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// FormatJournalTimeline groups entries by month → date for tool/prompt display.
// Entries should already be newest-first.
func FormatJournalTimeline(entries []JournalEntry) string {
	if len(entries) == 0 {
		return "（暂无日记/想法）"
	}
	var b strings.Builder
	b.WriteString("## 个人日记 / 想法（按时间）\n")
	curMonth, curDate := "", ""
	for _, e := range entries {
		if e.Month != curMonth {
			curMonth = e.Month
			curDate = ""
			fmt.Fprintf(&b, "\n### %s\n", curMonth)
		}
		if e.Date != curDate {
			curDate = e.Date
			fmt.Fprintf(&b, "\n#### %s\n", curDate)
		}
		tag := ""
		if len(e.Tags) > 0 {
			tag = " · " + strings.Join(e.Tags, ",")
		}
		fmt.Fprintf(&b, "- [%s]%s %s\n", e.Kind, tag, e.Text)
	}
	return strings.TrimSpace(b.String())
}

// JournalBriefForPrompt injects recent journal snippets into working memory.
func (m *Memory) JournalBriefForPrompt(peerID string) string {
	entries := m.JournalList(peerID, "", "", "", journalBriefDays, journalBriefMax)
	if len(entries) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("### Recent journal（近日想法/日记）\n")
	for _, e := range entries {
		fmt.Fprintf(&b, "- %s [%s] %s\n", e.Date, e.Kind, truncateRunes(e.Text, 100))
	}
	return strings.TrimSpace(b.String())
}

// DetectJournalIntent returns kind+text if the user is explicitly writing a diary/thought.
func DetectJournalIntent(msg string) (kind, text string, ok bool) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return "", "", false
	}
	low := msg
	prefixes := []struct {
		p    string
		kind string
	}{
		{"写日记：", "diary"},
		{"写日记:", "diary"},
		{"日记：", "diary"},
		{"日记:", "diary"},
		{"今天日记：", "diary"},
		{"今天日记:", "diary"},
		{"记一下想法：", "thought"},
		{"记一下想法:", "thought"},
		{"记个想法：", "thought"},
		{"记个想法:", "thought"},
		{"想法：", "thought"},
		{"想法:", "thought"},
		{"帮我记到日记：", "diary"},
		{"帮我记到日记:", "diary"},
		{"存到日记：", "diary"},
		{"存到日记:", "diary"},
		{"心情：", "mood"},
		{"心情:", "mood"},
		{"感悟：", "reflection"},
		{"感悟:", "reflection"},
		{"反思：", "reflection"},
		{"反思:", "reflection"},
	}
	for _, it := range prefixes {
		if strings.HasPrefix(low, it.p) {
			body := strings.TrimSpace(msg[len(it.p):])
			if utf8.RuneCountInString(body) >= 4 {
				return it.kind, body, true
			}
		}
	}
	// Soft: 「帮我记到日记 xxx」without colon
	for _, p := range []string{"帮我记到日记 ", "记到日记 ", "写进日记 "} {
		if i := strings.Index(low, p); i >= 0 {
			body := strings.TrimSpace(msg[i+len(p):])
			if utf8.RuneCountInString(body) >= 4 {
				return "diary", body, true
			}
		}
	}
	return "", "", false
}

func journalKindLabel(kind string) string {
	switch normalizeJournalKind(kind) {
	case "diary":
		return "日记"
	case "mood":
		return "心情"
	case "reflection":
		return "感悟"
	default:
		return "想法"
	}
}

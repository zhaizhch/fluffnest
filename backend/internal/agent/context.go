package agent

import (
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/types"
)

// Layered memory budgets — follow the usual STM / working / episodic / LTM split
// (MemGPT-style): keep recent turns readable, roll older chat into a summary,
// and always inject a compact working-memory block (never dump the whole store).
const (
	historyKeepRecent     = 8 // ~4 turns as real messages
	historyFullRecent     = 4
	historyMsgRunes       = 520
	historyFullMsgRunes   = 900
	historyOlderMax       = 10
	historyOlderLineRunes = 120
	historyDigestBudget   = 1200

	toolResultRunes    = 1800
	skillBodyRunes     = 280
	essentialsRunes    = 700
	workingMemoryRunes = 1400

	sessionNoteRunes   = 240
	sessionNotesKeep   = 16
	sessionNotesHot    = 6
	sessionDigestRunes = 700
	sessionThreadRunes = 220
	recallHitLimit     = 4
)

// EssentialsForPrompt injects owner + self highlights into every turn (core / LTM).
// Full dossiers stay on disk and are fetched via tools.
func (m *Memory) EssentialsForPrompt(peerID string) string {
	if m == nil {
		return ""
	}
	brief := strings.TrimSpace(m.DossierBrief(peerID))
	if brief == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Essentials（长期档案要点）\n")
	b.WriteString("完整档案按需：owner_dossier_get / self_dossier_get。\n")
	b.WriteString(strings.TrimPrefix(brief, "## Living Dossiers\n"))
	out := strings.TrimSpace(b.String())
	if utf8.RuneCountInString(out) > essentialsRunes {
		out = truncateRunes(out, essentialsRunes)
	}
	return out
}

// WorkingMemoryForPrompt is the always-on conversational continuity block:
// open thread + episodic digest + recent session notes + query-relevant recalls.
// This is what prevents “前后聊不起来” when chat history is compressed.
func (m *Memory) WorkingMemoryForPrompt(peerID, userMessage string) string {
	if m == nil {
		return ""
	}
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		return ""
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	sess := m.Sessions[peerID]
	recalls := m.recallLocked(peerID, userMessage, recallHitLimit)

	var b strings.Builder
	b.WriteString("## Working Memory（本轮必读，用于衔接前后对话）\n")
	b.WriteString("指代（那个/刚才/继续）优先对照这里与下方近期原文，勿装作失忆。\n")

	wrote := false
	if t := strings.TrimSpace(sess.Thread); t != "" {
		fmt.Fprintf(&b, "### Open thread\n%s\n", t)
		wrote = true
	}
	if d := strings.TrimSpace(sess.Digest); d != "" {
		fmt.Fprintf(&b, "### Episodic digest\n%s\n", truncateRunes(d, sessionDigestRunes))
		wrote = true
	}
	if len(sess.Notes) > 0 {
		b.WriteString("### Recent session notes\n")
		notes := sess.Notes
		if len(notes) > sessionNotesHot {
			notes = notes[len(notes)-sessionNotesHot:]
		}
		for _, n := range notes {
			fmt.Fprintf(&b, "- %s\n", n)
		}
		wrote = true
	}
	if len(recalls) > 0 {
		b.WriteString("### Recalled for this message\n")
		for _, h := range recalls {
			fmt.Fprintf(&b, "- %s\n", h)
		}
		wrote = true
	}
	if !wrote {
		return ""
	}
	out := strings.TrimSpace(b.String())
	if utf8.RuneCountInString(out) > workingMemoryRunes {
		out = truncateRunes(out, workingMemoryRunes)
	}
	return out
}

// CompressHistory keeps recent turns as real messages (light trim) and folds
// older turns into one episodic summary system message — not 90-char stubs.
func CompressHistory(history []types.ChatMessage) []llm.ChatMessage {
	clean := normalizeHistory(history)
	if len(clean) == 0 {
		return nil
	}
	if len(clean) <= historyKeepRecent {
		return formatRecentMessages(clean)
	}

	older := clean[:len(clean)-historyKeepRecent]
	recent := clean[len(clean)-historyKeepRecent:]
	var out []llm.ChatMessage
	if summary := summarizeOlderTurns(older); summary != "" {
		out = append(out, llm.ChatMessage{Role: "system", Content: summary})
	}
	out = append(out, formatRecentMessages(recent)...)
	return out
}

func normalizeHistory(history []types.ChatMessage) []types.ChatMessage {
	var clean []types.ChatMessage
	for _, m := range history {
		c := strings.TrimSpace(m.Content)
		if c == "" {
			continue
		}
		c = strings.TrimSpace(strings.TrimPrefix(c, "[微信]"))
		role := m.Role
		if role != "assistant" {
			role = "user"
		}
		clean = append(clean, types.ChatMessage{Role: role, Content: c})
	}
	return clean
}

func formatRecentMessages(msgs []types.ChatMessage) []llm.ChatMessage {
	n := len(msgs)
	out := make([]llm.ChatMessage, 0, n)
	for i, m := range msgs {
		limit := historyMsgRunes
		if i >= n-historyFullRecent {
			limit = historyFullMsgRunes
		}
		out = append(out, llm.ChatMessage{
			Role:    m.Role,
			Content: truncateRunes(m.Content, limit),
		})
	}
	return out
}

func summarizeOlderTurns(older []types.ChatMessage) string {
	if len(older) == 0 {
		return ""
	}
	if len(older) > historyOlderMax {
		older = older[len(older)-historyOlderMax:]
	}
	var dig strings.Builder
	dig.WriteString("## Earlier conversation (episodic summary)\n")
	dig.WriteString("以下为更早对话压缩；实体、约定、未完成事项请保留衔接。\n")
	budget := historyDigestBudget
	for _, m := range older {
		tag := "主"
		lineBudget := historyOlderLineRunes
		if m.Role == "assistant" {
			tag = "宠"
			lineBudget = historyOlderLineRunes * 3 / 4
		}
		line := fmt.Sprintf("- %s：%s\n", tag, truncateRunes(m.Content, lineBudget))
		cost := utf8.RuneCountInString(line)
		if budget-cost < 0 {
			dig.WriteString("- …(更早轮次已省略)\n")
			break
		}
		dig.WriteString(line)
		budget -= cost
	}
	return strings.TrimSpace(dig.String())
}

func TruncateToolResult(name, content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return content
	}
	limit := toolResultRunes
	switch name {
	case "read_document":
		limit = 2800
	case "owner_dossier_get", "self_dossier_get", "memory_list":
		limit = 1600
	case "web_search", "get_news":
		limit = 1800
	}
	if utf8.RuneCountInString(content) <= limit {
		return content
	}
	return truncateRunes(content, limit) + "\n…(已压缩，需要细节可再精确查询)"
}

func truncateSkillBody(body string) string {
	body = strings.TrimSpace(body)
	if utf8.RuneCountInString(body) <= skillBodyRunes {
		return body
	}
	return truncateRunes(body, skillBodyRunes) + "\n…(完整流程可用 load_skill)"
}

// RememberTurn records a durable turn into session working memory and refines.
func (m *Memory) RememberTurn(peerID, question, answer string) error {
	peerID = strings.TrimSpace(peerID)
	question = strings.TrimSpace(question)
	answer = strings.TrimSpace(answer)
	if peerID == "" || (question == "" && answer == "") {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	sess := m.Sessions[peerID]
	if question != "" {
		sess.Notes = append(sess.Notes, "Q: "+truncateRunes(question, sessionNoteRunes))
		sess.Thread = truncateRunes("进行中："+question, sessionThreadRunes)
	}
	if answer != "" {
		sess.Notes = append(sess.Notes, "A: "+truncateRunes(answer, sessionNoteRunes))
	}
	if len(sess.Notes) > sessionNotesKeep {
		sess.Notes = sess.Notes[len(sess.Notes)-sessionNotesKeep:]
	}
	sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.Sessions[peerID] = sess
	return m.refinePeerKnowledgeLocked(peerID)
}

// RefinePeerKnowledge folds old session notes into an episodic digest and
// drops answered open questions.
func (m *Memory) RefinePeerKnowledge(peerID string) error {
	peerID = strings.TrimSpace(peerID)
	if peerID == "" || m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.refinePeerKnowledgeLocked(peerID)
}

func (m *Memory) refinePeerKnowledgeLocked(peerID string) error {
	m.ensureDossiersLocked()

	sess := m.Sessions[peerID]
	// Fold older notes into digest once we have more than hot window + buffer.
	foldAt := sessionNotesHot + 4
	if len(sess.Notes) > foldAt {
		old := sess.Notes[:len(sess.Notes)-sessionNotesHot]
		keep := sess.Notes[len(sess.Notes)-sessionNotesHot:]
		merged := foldNotesToDigest(old)
		if sess.Digest != "" {
			sess.Digest = truncateRunes(sess.Digest+"；"+merged, sessionDigestRunes)
		} else {
			sess.Digest = truncateRunes(merged, sessionDigestRunes)
		}
		sess.Notes = keep
		sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		m.Sessions[peerID] = sess
	}

	d := m.getOwnerLocked(peerID)
	if len(d.OpenQuestions) > 0 {
		d = normalizeOwner(d)
		var remain []string
		for _, q := range d.OpenQuestions {
			ql := strings.ToLower(q)
			answered := false
			switch {
			case strings.Contains(ql, "称呼") || strings.Contains(ql, "nickname"):
				answered = firstMap(d.Identity, "nickname", "name", "call_me") != ""
			case strings.Contains(ql, "城市") || strings.Contains(ql, "city"):
				answered = firstMap(d.Identity, "home_city", "city") != ""
			case strings.Contains(ql, "工作"):
				answered = firstMap(d.Work, "role", "focus", "project") != ""
			case strings.Contains(ql, "风格") || strings.Contains(ql, "tone"):
				answered = firstMap(d.Preferences, "tone", "reply_style", "length") != ""
			case strings.Contains(ql, "目标"):
				answered = firstMap(d.Goals, "focus", "habit", "goal") != ""
			case strings.Contains(ql, "边界"):
				answered = firstMap(d.Boundaries, "no_go", "quiet_hours") != ""
			}
			if !answered {
				remain = append(remain, q)
			}
		}
		if len(remain) > 8 {
			remain = remain[:8]
		}
		d.OpenQuestions = remain
		d.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		m.OwnerProfiles[peerID] = d
	}

	if m.Self != nil {
		if len(m.Self.Lessons) > 12 {
			m.Self.Lessons = m.Self.Lessons[len(m.Self.Lessons)-12:]
		}
		if len(m.Self.Improvements) > 12 {
			m.Self.Improvements = m.Self.Improvements[len(m.Self.Improvements)-12:]
		}
		if len(m.Self.Notes) > 12 {
			m.Self.Notes = m.Self.Notes[len(m.Self.Notes)-12:]
		}
		m.Self.Lessons = dedupeTail(m.Self.Lessons)
		m.Self.Improvements = dedupeTail(m.Self.Improvements)
	}

	return m.saveLocked()
}

func foldNotesToDigest(notes []string) string {
	var parts []string
	for _, n := range notes {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		// Prefer keeping substance over ultra-short stubs.
		parts = append(parts, truncateRunes(n, 120))
	}
	return strings.Join(parts, " · ")
}

func dedupeTail(in []string) []string {
	if len(in) == 0 {
		return in
	}
	out := make([]string, 0, len(in))
	var last string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || s == last {
			continue
		}
		out = append(out, s)
		last = s
	}
	return out
}

// recallLocked finds KV / session / dossier hits related to the current message.
// Caller must hold m.mu.
func (m *Memory) recallLocked(peerID, query string, limit int) []string {
	query = strings.TrimSpace(query)
	if query == "" || limit <= 0 {
		return nil
	}
	seen := map[string]bool{}
	var hits []string
	addHits := func(q string) {
		q = strings.TrimSpace(strings.ToLower(q))
		if utf8.RuneCountInString(q) < 2 {
			return
		}
		for _, h := range m.searchLocked(peerID, q, limit) {
			if seen[h] {
				continue
			}
			seen[h] = true
			hits = append(hits, h)
			if len(hits) >= limit {
				return
			}
		}
	}
	addHits(query)
	for _, part := range splitRecallParts(query) {
		if len(hits) >= limit {
			break
		}
		addHits(part)
	}
	return hits
}

func splitRecallParts(msg string) []string {
	fields := strings.FieldsFunc(msg, func(r rune) bool {
		if unicode.IsSpace(r) {
			return true
		}
		switch r {
		case ',', '，', '.', '。', '!', '！', '?', '？', ';', '；', ':', '：',
			'、', '/', '|', '(', ')', '（', '）', '[', ']', '【', '】',
			'"', '\'', '“', '”', '‘', '’':
			return true
		}
		return false
	})
	var out []string
	for _, f := range fields {
		f = strings.TrimSpace(f)
		n := utf8.RuneCountInString(f)
		if n >= 2 && n <= 24 {
			out = append(out, f)
		}
	}
	return out
}

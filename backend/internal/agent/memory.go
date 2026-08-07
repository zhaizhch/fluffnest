package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Memory is durable agent knowledge scoped by peer (WeChat user) + global.
type Memory struct {
	mu       sync.Mutex
	path     string
	Global   map[string]MemoryItem            `json:"global"`
	Peers    map[string]map[string]MemoryItem `json:"peers"`
	Sessions map[string]SessionMemory         `json:"sessions"`
	// OwnerProfiles: structured living dossier per WeChat peer (the human master).
	OwnerProfiles map[string]OwnerDossier `json:"ownerProfiles,omitempty"`
	// Self: agent self-improvement dossier (global).
	Self *SelfDossier `json:"self,omitempty"`
}

type MemoryItem struct {
	Value     string `json:"value"`
	UpdatedAt string `json:"updatedAt"`
	Source    string `json:"source,omitempty"`
}

type SessionMemory struct {
	Notes     []string `json:"notes"`
	Digest    string   `json:"digest,omitempty"` // rolled-up episodic summary (injected via working memory)
	Thread    string   `json:"thread,omitempty"` // open topic / pending commitment
	UpdatedAt string   `json:"updatedAt"`
}

func DefaultMemoryPath() string {
	if p := strings.TrimSpace(os.Getenv("FLUFFNEST_AGENT_MEMORY")); p != "" {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "fluffnest-agent-memory.json"
	}
	return filepath.Join(home, ".fluffnest", "agent-memory.json")
}

func OpenMemory(path string) (*Memory, error) {
	if path == "" {
		path = DefaultMemoryPath()
	}
	m := &Memory{
		path:          path,
		Global:        map[string]MemoryItem{},
		Peers:         map[string]map[string]MemoryItem{},
		Sessions:      map[string]SessionMemory{},
		OwnerProfiles: map[string]OwnerDossier{},
		Self:          nil,
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return m, nil
		}
		return nil, err
	}
	if len(raw) == 0 {
		return m, nil
	}
	if err := json.Unmarshal(raw, m); err != nil {
		return nil, err
	}
	if m.Global == nil {
		m.Global = map[string]MemoryItem{}
	}
	if m.Peers == nil {
		m.Peers = map[string]map[string]MemoryItem{}
	}
	if m.Sessions == nil {
		m.Sessions = map[string]SessionMemory{}
	}
	if m.OwnerProfiles == nil {
		m.OwnerProfiles = map[string]OwnerDossier{}
	}
	if m.Self == nil {
		sd := emptySelfDossier()
		m.Self = &sd
	}
	m.path = path
	return m, nil
}

func (m *Memory) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(m.path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

func (m *Memory) Snapshot(peerID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var b strings.Builder
	b.WriteString("### Global memory\n")
	if len(m.Global) == 0 {
		b.WriteString("(empty)\n")
	} else {
		for k, v := range m.Global {
			fmt.Fprintf(&b, "- %s = %s\n", k, v.Value)
		}
	}
	peerID = strings.TrimSpace(peerID)
	if peerID != "" {
		b.WriteString("\n### Peer memory\n")
		if pm := m.Peers[peerID]; len(pm) == 0 {
			b.WriteString("(empty)\n")
		} else {
			for k, v := range pm {
				fmt.Fprintf(&b, "- %s = %s\n", k, v.Value)
			}
		}
		if sess, ok := m.Sessions[peerID]; ok {
			if t := strings.TrimSpace(sess.Thread); t != "" {
				b.WriteString("\n### Open thread\n")
				fmt.Fprintf(&b, "%s\n", t)
			}
			if d := strings.TrimSpace(sess.Digest); d != "" {
				b.WriteString("\n### Session digest\n")
				fmt.Fprintf(&b, "%s\n", d)
			}
			if len(sess.Notes) > 0 {
				b.WriteString("\n### Session notes\n")
				for _, n := range sess.Notes {
					fmt.Fprintf(&b, "- %s\n", n)
				}
			}
		}
	}
	return strings.TrimSpace(b.String())
}

func (m *Memory) Read(peerID, key string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key = strings.TrimSpace(key)
	if key == "" {
		return "", false
	}
	if peerID != "" {
		if pm := m.Peers[peerID]; pm != nil {
			if it, ok := pm[key]; ok {
				return it.Value, true
			}
		}
	}
	if it, ok := m.Global[key]; ok {
		return it.Value, true
	}
	return "", false
}

func (m *Memory) Write(peerID, key, value, source string, global bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	if key == "" || value == "" {
		return fmt.Errorf("key/value 不能为空")
	}
	if looksSecret(key, value) {
		return fmt.Errorf("拒绝存储疑似敏感信息")
	}
	item := MemoryItem{
		Value:     truncateRunes(value, 240),
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    source,
	}
	if global || peerID == "" {
		m.Global[key] = item
	} else {
		if m.Peers[peerID] == nil {
			m.Peers[peerID] = map[string]MemoryItem{}
		}
		m.Peers[peerID][key] = item
	}
	return m.saveLocked()
}

func (m *Memory) Delete(peerID, key string, global bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key = strings.TrimSpace(key)
	if key == "" {
		return fmt.Errorf("key 不能为空")
	}
	if global || peerID == "" {
		delete(m.Global, key)
	} else if pm := m.Peers[peerID]; pm != nil {
		delete(pm, key)
	}
	return m.saveLocked()
}

// Search returns key/value pairs whose key or value contains query (case-insensitive).
func (m *Memory) Search(peerID, query string, limit int) []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.searchLocked(peerID, query, limit)
}

// searchLocked is the unlocked Search implementation. Caller must hold m.mu.
func (m *Memory) searchLocked(peerID, query string, limit int) []string {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" {
		return nil
	}
	if limit <= 0 {
		limit = 8
	}
	var hits []string
	add := func(scope, key string, it MemoryItem) {
		if len(hits) >= limit {
			return
		}
		blob := strings.ToLower(key + " " + it.Value)
		if strings.Contains(blob, query) {
			hits = append(hits, fmt.Sprintf("[%s] %s = %s", scope, key, it.Value))
		}
	}
	for k, v := range m.Global {
		add("global", k, v)
	}
	peerID = strings.TrimSpace(peerID)
	if peerID != "" {
		for k, v := range m.Peers[peerID] {
			add("peer", k, v)
		}
		if sess, ok := m.Sessions[peerID]; ok {
			if t := strings.TrimSpace(sess.Thread); t != "" && strings.Contains(strings.ToLower(t), query) && len(hits) < limit {
				hits = append(hits, "[thread] "+t)
			}
			if d := strings.TrimSpace(sess.Digest); d != "" && strings.Contains(strings.ToLower(d), query) && len(hits) < limit {
				hits = append(hits, "[digest] "+truncateRunes(d, 160))
			}
			for _, n := range sess.Notes {
				if len(hits) >= limit {
					break
				}
				if strings.Contains(strings.ToLower(n), query) {
					hits = append(hits, "[session] "+n)
				}
			}
		}
		if d, ok := m.OwnerProfiles[peerID]; ok {
			blob := strings.ToLower(FormatOwnerDossier(d))
			if strings.Contains(blob, query) && len(hits) < limit {
				hits = append(hits, ownerRecallSnippet(d, query))
			}
		}
	}
	if m.Self != nil {
		blob := strings.ToLower(FormatSelfDossier(*m.Self))
		if strings.Contains(blob, query) && len(hits) < limit {
			hits = append(hits, "[self_dossier] matched self profile")
		}
	}
	return hits
}

func ownerRecallSnippet(d OwnerDossier, query string) string {
	d = normalizeOwner(d)
	type pair struct{ k, v string }
	var candidates []pair
	collect := func(section string, mp map[string]string) {
		for k, v := range mp {
			blob := strings.ToLower(section + " " + k + " " + v)
			if strings.Contains(blob, query) {
				candidates = append(candidates, pair{section + "." + k, v})
			}
		}
	}
	collect("identity", d.Identity)
	collect("work", d.Work)
	collect("lifestyle", d.Lifestyle)
	collect("preferences", d.Preferences)
	collect("relationships", d.Relationships)
	collect("goals", d.Goals)
	collect("boundaries", d.Boundaries)
	collect("context", d.Context)
	for _, n := range d.Notes {
		if strings.Contains(strings.ToLower(n), query) {
			candidates = append(candidates, pair{"note", n})
		}
	}
	if len(candidates) == 0 {
		return "[owner_dossier] matched profile text"
	}
	return fmt.Sprintf("[owner_dossier] %s = %s", candidates[0].k, truncateRunes(candidates[0].v, 120))
}

func looksSecret(key, value string) bool {
	k := strings.ToLower(key + " " + value)
	for _, s := range []string{"password", "passwd", "api_key", "apikey", "token", "secret", "bot_token", "私钥", "密码"} {
		if strings.Contains(k, s) {
			return true
		}
	}
	return false
}

func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

package agent

import (
	"fmt"
	"strings"
	"time"
)

// OwnerDossier is a structured, living profile of the human master (per WeChat peer).
type OwnerDossier struct {
	Identity      map[string]string `json:"identity,omitempty"`      // name, nickname, pronouns, birthday, timezone, home_city…
	Work          map[string]string `json:"work,omitempty"`          // role, company, skills, tools, schedule…
	Lifestyle     map[string]string `json:"lifestyle,omitempty"`     // sleep, food, exercise, hobbies, games…
	Preferences   map[string]string `json:"preferences,omitempty"`   // tone, reply_length, topics_like/dislike…
	Relationships map[string]string `json:"relationships,omitempty"` // family, pets, important people…
	Goals         map[string]string `json:"goals,omitempty"`         // short/mid goals, habits to keep…
	Boundaries    map[string]string `json:"boundaries,omitempty"`    // no-go topics, quiet hours, privacy…
	Context       map[string]string `json:"context,omitempty"`       // current projects, travel, health soft notes…
	OpenQuestions []string          `json:"openQuestions,omitempty"` // what we still want to learn
	Notes         []string          `json:"notes,omitempty"`         // freeform durable observations
	UpdatedAt     string            `json:"updatedAt,omitempty"`
}

// SelfDossier is the agent's living self-improvement log (global).
type SelfDossier struct {
	Identity      map[string]string `json:"identity,omitempty"`      // who I am to the master, role…
	Capabilities  map[string]string `json:"capabilities,omitempty"`  // tools/skills strengths & gaps…
	ServiceStyle  map[string]string `json:"serviceStyle,omitempty"`  // how I should serve THIS master…
	Lessons       []string          `json:"lessons,omitempty"`       // what worked / failed
	Improvements  []string          `json:"improvements,omitempty"`  // concrete next upgrades
	MasterFit     map[string]string `json:"masterFit,omitempty"`     // adaptations to owner's tastes…
	OpenQuestions []string          `json:"openQuestions,omitempty"`
	Notes         []string          `json:"notes,omitempty"`
	UpdatedAt     string            `json:"updatedAt,omitempty"`
}

var ownerSections = []string{
	"identity", "work", "lifestyle", "preferences", "relationships", "goals", "boundaries", "context",
}

var selfSections = []string{
	"identity", "capabilities", "serviceStyle", "masterFit",
}

func emptyOwnerDossier() OwnerDossier {
	return OwnerDossier{
		Identity:      map[string]string{},
		Work:          map[string]string{},
		Lifestyle:     map[string]string{},
		Preferences:   map[string]string{},
		Relationships: map[string]string{},
		Goals:         map[string]string{},
		Boundaries:    map[string]string{},
		Context:       map[string]string{},
		OpenQuestions: defaultOwnerOpenQuestions(),
		Notes:         nil,
	}
}

func emptySelfDossier() SelfDossier {
	return SelfDossier{
		Identity: map[string]string{
			"role": "桌边宠物兼微信智能体，服务主人日常生活与信息需求",
		},
		Capabilities: map[string]string{
			"tools":   "web_search, weather, news, calc, time, documents(pdf/docx/txt/md), schedules, memory, dossiers",
			"channel": "WeChat ClawBot + desktop pet bubble",
			"gaps":    "图片OCR未做; 旧版.doc不支持; 微信回传文件未做",
		},
		ServiceStyle: map[string]string{
			"default": "先工具后结论；微信短聊；不空口编事实",
		},
		MasterFit:     map[string]string{},
		OpenQuestions: defaultSelfOpenQuestions(),
		Lessons:       nil,
		Improvements:  nil,
		Notes:         nil,
	}
}

func defaultOwnerOpenQuestions() []string {
	return []string{
		"主人希望怎么称呼？时区/常住城市？",
		"工作/学习在忙什么？常用工具？",
		"作息与安静时段？",
		"喜欢怎样的回复风格（短/详/正经/温柔）？",
		"兴趣爱好与正在追的游戏/内容？",
		"有什么绝对不要提或不要做的事？",
		"近期最想我帮着盯的目标？",
	}
}

func defaultSelfOpenQuestions() []string {
	return []string{
		"主人更吃哪种陪伴节奏？",
		"哪些工具调用最常帮到主人？",
		"上次翻车是什么原因，怎么避免？",
	}
}

func (m *Memory) ensureDossiersLocked() {
	if m.OwnerProfiles == nil {
		m.OwnerProfiles = map[string]OwnerDossier{}
	}
	if m.Self == nil {
		sd := emptySelfDossier()
		m.Self = &sd
	}
	if m.Self.Identity == nil {
		m.Self.Identity = map[string]string{}
	}
	if m.Self.Capabilities == nil {
		m.Self.Capabilities = map[string]string{}
	}
	if m.Self.ServiceStyle == nil {
		m.Self.ServiceStyle = map[string]string{}
	}
	if m.Self.MasterFit == nil {
		m.Self.MasterFit = map[string]string{}
	}
}

func (m *Memory) getOwnerLocked(peerID string) OwnerDossier {
	m.ensureDossiersLocked()
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		peerID = "_default"
	}
	d, ok := m.OwnerProfiles[peerID]
	if !ok {
		d = emptyOwnerDossier()
		m.OwnerProfiles[peerID] = d
	}
	d = normalizeOwner(d)
	return d
}

func normalizeOwner(d OwnerDossier) OwnerDossier {
	if d.Identity == nil {
		d.Identity = map[string]string{}
	}
	if d.Work == nil {
		d.Work = map[string]string{}
	}
	if d.Lifestyle == nil {
		d.Lifestyle = map[string]string{}
	}
	if d.Preferences == nil {
		d.Preferences = map[string]string{}
	}
	if d.Relationships == nil {
		d.Relationships = map[string]string{}
	}
	if d.Goals == nil {
		d.Goals = map[string]string{}
	}
	if d.Boundaries == nil {
		d.Boundaries = map[string]string{}
	}
	if d.Context == nil {
		d.Context = map[string]string{}
	}
	if d.OpenQuestions == nil {
		d.OpenQuestions = defaultOwnerOpenQuestions()
	}
	return d
}

func (m *Memory) OwnerGet(peerID string) OwnerDossier {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.getOwnerLocked(peerID)
}

func (m *Memory) SelfGet() SelfDossier {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureDossiersLocked()
	return *m.Self
}

func ownerSectionMap(d *OwnerDossier, section string) (map[string]string, bool) {
	switch strings.ToLower(strings.TrimSpace(section)) {
	case "identity":
		return d.Identity, true
	case "work":
		return d.Work, true
	case "lifestyle":
		return d.Lifestyle, true
	case "preferences", "prefs":
		return d.Preferences, true
	case "relationships", "people":
		return d.Relationships, true
	case "goals":
		return d.Goals, true
	case "boundaries", "limits":
		return d.Boundaries, true
	case "context", "now":
		return d.Context, true
	default:
		return nil, false
	}
}

func selfSectionMap(d *SelfDossier, section string) (map[string]string, bool) {
	switch strings.ToLower(strings.TrimSpace(section)) {
	case "identity":
		return d.Identity, true
	case "capabilities", "skills":
		return d.Capabilities, true
	case "servicestyle", "service_style", "style":
		return d.ServiceStyle, true
	case "masterfit", "master_fit", "fit":
		return d.MasterFit, true
	default:
		return nil, false
	}
}

// OwnerUpdateField sets one field in a dossier section.
func (m *Memory) OwnerUpdateField(peerID, section, key, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	section = strings.TrimSpace(section)
	if key == "" || value == "" || section == "" {
		return fmt.Errorf("section/key/value 不能为空")
	}
	if looksSecret(key, value) {
		return fmt.Errorf("拒绝存储疑似敏感信息")
	}
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		peerID = "_default"
	}
	d := m.getOwnerLocked(peerID)
	sec, ok := ownerSectionMap(&d, section)
	if !ok {
		return fmt.Errorf("未知 section：%s（可用：%s）", section, strings.Join(ownerSections, "/"))
	}
	sec[key] = truncateRunes(value, 320)
	d.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.OwnerProfiles[peerID] = d
	return m.saveLocked()
}

// OwnerAppendNote appends a durable freeform note.
func (m *Memory) OwnerAppendNote(peerID, note string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	note = strings.TrimSpace(note)
	if note == "" {
		return fmt.Errorf("note 为空")
	}
	if looksSecret("note", note) {
		return fmt.Errorf("拒绝存储疑似敏感信息")
	}
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		peerID = "_default"
	}
	d := m.getOwnerLocked(peerID)
	d.Notes = append(d.Notes, truncateRunes(note, 200))
	if len(d.Notes) > 20 {
		d.Notes = d.Notes[len(d.Notes)-20:]
	}
	d.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.OwnerProfiles[peerID] = d
	return m.saveLocked()
}

// OwnerSetOpenQuestions replaces remaining questions to learn.
func (m *Memory) OwnerSetOpenQuestions(peerID string, qs []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	peerID = strings.TrimSpace(peerID)
	if peerID == "" {
		peerID = "_default"
	}
	d := m.getOwnerLocked(peerID)
	clean := make([]string, 0, len(qs))
	for _, q := range qs {
		q = strings.TrimSpace(q)
		if q != "" {
			clean = append(clean, truncateRunes(q, 120))
		}
	}
	if len(clean) > 16 {
		clean = clean[:16]
	}
	d.OpenQuestions = clean
	d.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	m.OwnerProfiles[peerID] = d
	return m.saveLocked()
}

func (m *Memory) SelfUpdateField(section, key, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key = strings.TrimSpace(key)
	value = strings.TrimSpace(value)
	section = strings.TrimSpace(section)
	if key == "" || value == "" || section == "" {
		return fmt.Errorf("section/key/value 不能为空")
	}
	if looksSecret(key, value) {
		return fmt.Errorf("拒绝存储疑似敏感信息")
	}
	m.ensureDossiersLocked()
	sec, ok := selfSectionMap(m.Self, section)
	if !ok {
		return fmt.Errorf("未知 section：%s（可用：%s）", section, strings.Join(selfSections, "/"))
	}
	sec[key] = truncateRunes(value, 320)
	m.Self.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return m.saveLocked()
}

func (m *Memory) SelfAppend(kind, text string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	text = strings.TrimSpace(text)
	if text == "" {
		return fmt.Errorf("内容为空")
	}
	if looksSecret(kind, text) {
		return fmt.Errorf("拒绝存储疑似敏感信息")
	}
	m.ensureDossiersLocked()
	item := truncateRunes(text, 280)
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "lesson", "lessons":
		m.Self.Lessons = append(m.Self.Lessons, item)
		if len(m.Self.Lessons) > 30 {
			m.Self.Lessons = m.Self.Lessons[len(m.Self.Lessons)-30:]
		}
	case "improvement", "improvements":
		m.Self.Improvements = append(m.Self.Improvements, item)
		if len(m.Self.Improvements) > 30 {
			m.Self.Improvements = m.Self.Improvements[len(m.Self.Improvements)-30:]
		}
	case "note", "notes":
		m.Self.Notes = append(m.Self.Notes, item)
		if len(m.Self.Notes) > 30 {
			m.Self.Notes = m.Self.Notes[len(m.Self.Notes)-30:]
		}
	default:
		return fmt.Errorf("kind 须为 lesson|improvement|note")
	}
	m.Self.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	return m.saveLocked()
}

func FormatOwnerDossier(d OwnerDossier) string {
	d = normalizeOwner(d)
	var b strings.Builder
	b.WriteString("## 主人档案（Owner Dossier）\n")
	writeMapSection(&b, "身份 identity", d.Identity)
	writeMapSection(&b, "工作/学习 work", d.Work)
	writeMapSection(&b, "生活 lifestyle", d.Lifestyle)
	writeMapSection(&b, "偏好 preferences", d.Preferences)
	writeMapSection(&b, "关系 relationships", d.Relationships)
	writeMapSection(&b, "目标 goals", d.Goals)
	writeMapSection(&b, "边界 boundaries", d.Boundaries)
	writeMapSection(&b, "近况 context", d.Context)
	if len(d.Notes) > 0 {
		b.WriteString("### 笔记 notes\n")
		for _, n := range d.Notes {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	if len(d.OpenQuestions) > 0 {
		b.WriteString("### 仍想了解\n")
		for _, q := range d.OpenQuestions {
			fmt.Fprintf(&b, "- %s\n", q)
		}
	}
	if d.UpdatedAt != "" {
		fmt.Fprintf(&b, "更新于：%s\n", d.UpdatedAt)
	}
	return strings.TrimSpace(b.String())
}

func FormatSelfDossier(d SelfDossier) string {
	var b strings.Builder
	b.WriteString("## 自我档案（Self Dossier）\n")
	writeMapSection(&b, "定位 identity", d.Identity)
	writeMapSection(&b, "能力 capabilities", d.Capabilities)
	writeMapSection(&b, "服务风格 serviceStyle", d.ServiceStyle)
	writeMapSection(&b, "适配主人 masterFit", d.MasterFit)
	if len(d.Lessons) > 0 {
		b.WriteString("### 教训 lessons\n")
		for _, n := range d.Lessons {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	if len(d.Improvements) > 0 {
		b.WriteString("### 改进 improvements\n")
		for _, n := range d.Improvements {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	if len(d.Notes) > 0 {
		b.WriteString("### 笔记 notes\n")
		for _, n := range d.Notes {
			fmt.Fprintf(&b, "- %s\n", n)
		}
	}
	if len(d.OpenQuestions) > 0 {
		b.WriteString("### 自我反思问题\n")
		for _, q := range d.OpenQuestions {
			fmt.Fprintf(&b, "- %s\n", q)
		}
	}
	if d.UpdatedAt != "" {
		fmt.Fprintf(&b, "更新于：%s\n", d.UpdatedAt)
	}
	return strings.TrimSpace(b.String())
}

func writeMapSection(b *strings.Builder, title string, m map[string]string) {
	if len(m) == 0 {
		return
	}
	fmt.Fprintf(b, "### %s\n", title)
	for k, v := range m {
		fmt.Fprintf(b, "- %s: %s\n", k, v)
	}
}

// DossierBrief returns lean owner + self highlights for every agent turn.
// Full dossiers / KV memory are NOT dumped here — use tools when needed.
func (m *Memory) DossierBrief(peerID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureDossiersLocked()
	owner := m.getOwnerLocked(peerID)
	self := *m.Self

	var b strings.Builder
	b.WriteString("## Living Dossiers\n")
	b.WriteString("### 主人\n")
	highlights := 0
	addHL := func(label, v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		fmt.Fprintf(&b, "- %s：%s\n", label, truncateRunes(v, 60))
		highlights++
	}
	addHL("称呼", firstMap(owner.Identity, "nickname", "name", "call_me"))
	addHL("城市", firstMap(owner.Identity, "home_city", "city"))
	addHL("工作", firstMap(owner.Work, "role", "focus", "project"))
	addHL("风格", firstMap(owner.Preferences, "tone", "reply_style", "length"))
	addHL("边界", firstMap(owner.Boundaries, "no_go", "quiet_hours"))
	if highlights == 0 {
		b.WriteString("- （尚空）合适时问 1 个问题并 owner_dossier_update。\n")
	} else if len(owner.OpenQuestions) > 0 {
		fmt.Fprintf(&b, "- 可了解：%s\n", truncateRunes(owner.OpenQuestions[0], 50))
	}

	b.WriteString("### 自我\n")
	if v := firstMap(self.ServiceStyle, "default", "tone"); v != "" {
		fmt.Fprintf(&b, "- 风格：%s\n", truncateRunes(v, 70))
	}
	if v := firstMap(self.MasterFit, "likes", "avoid"); v != "" {
		fmt.Fprintf(&b, "- 适配：%s\n", truncateRunes(v, 70))
	}
	if len(self.Lessons) > 0 {
		fmt.Fprintf(&b, "- 近训：%s\n", truncateRunes(self.Lessons[len(self.Lessons)-1], 70))
	}
	return strings.TrimSpace(b.String())
}

func firstMap(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(m[k]); v != "" {
			return v
		}
	}
	return ""
}

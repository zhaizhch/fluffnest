package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/llm"
)

// Multi-agent design (WeChat-latency oriented), drawing from:
//   - OpenAI Agents SDK: manager stays in control; specialists as bounded helpers
//   - CrewAI: role / goal / task crew mental model
//   - OpenAI Swarm: lightweight process modes (concurrent | sequential | handoff)
// Avoid AutoGen-style long group chats (token-heavy for IM).

const (
	maxCrewSize       = 4
	maxAgentChatIters = 3
	agentChatTokens   = 320
	agentChatTimeout  = 14 * time.Second
	planTeamTimeout   = 8 * time.Second
	defaultCrewMode   = "concurrent"
)

// InboxMsg is a peer message waiting to be consumed on next Chat().
type InboxMsg struct {
	From    string
	Content string
}

// PersistentAgent is a stateful specialist (not a one-shot sub-call):
// identity (name/role/goal) + durable messages + inbox channel.
type PersistentAgent struct {
	Name string
	Role string
	Goal string

	mu       sync.Mutex
	inbox    []InboxMsg
	messages []llm.ChatMessage
	alive    bool
}

// NewPersistentAgent creates an agent with system identity baked into memory.
func NewPersistentAgent(name, role, goal string) *PersistentAgent {
	name = sanitizeAgentName(name)
	role = strings.TrimSpace(role)
	if role == "" {
		role = "specialist"
	}
	goal = strings.TrimSpace(goal)
	sys := fmt.Sprintf(
		"你是 %s，角色：%s。说话简洁、聚焦。只输出与任务相关的要点，不要扮演主人，不要输出 JSON/工具 XML。",
		name, role,
	)
	if goal != "" {
		sys += "\n目标：" + goal
	}
	return &PersistentAgent{
		Name:  name,
		Role:  role,
		Goal:  goal,
		alive: true,
		messages: []llm.ChatMessage{
			{Role: "system", Content: sys},
		},
	}
}

// Receive enqueues a message from another agent (or main).
func (a *PersistentAgent) Receive(sender, message string) {
	if a == nil {
		return
	}
	sender = strings.TrimSpace(sender)
	message = strings.TrimSpace(message)
	if sender == "" || message == "" {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.alive {
		return
	}
	a.inbox = append(a.inbox, InboxMsg{From: sender, Content: truncateRunes(message, 600)})
}

// Chat runs one task turn. Inbox is drained first (persistent memory across calls).
func (a *PersistentAgent) Chat(ctx context.Context, deps ToolDeps, task string, withTools bool) (string, error) {
	if a == nil {
		return "", fmt.Errorf("agent is nil")
	}
	task = strings.TrimSpace(task)
	if task == "" {
		return "", fmt.Errorf("task 为空")
	}
	if deps.LLM == nil {
		return "", fmt.Errorf("LLM 未就绪")
	}

	a.mu.Lock()
	if !a.alive {
		a.mu.Unlock()
		return "", fmt.Errorf("agent %s 已解散", a.Name)
	}
	if len(a.inbox) > 0 {
		var b strings.Builder
		b.WriteString("你收到了团队成员的消息：\n")
		for _, m := range a.inbox {
			b.WriteString(fmt.Sprintf("[来自 %s]: %s\n", m.From, m.Content))
		}
		a.messages = append(a.messages, llm.ChatMessage{Role: "user", Content: b.String()})
		a.inbox = nil
		a.mu.Unlock()
		_ = a.completeOnce(ctx, deps, false)
		a.mu.Lock()
	}
	a.messages = append(a.messages, llm.ChatMessage{Role: "user", Content: task})
	a.mu.Unlock()

	return a.runLoop(ctx, deps, withTools)
}

func (a *PersistentAgent) completeOnce(ctx context.Context, deps ToolDeps, withTools bool) error {
	a.mu.Lock()
	msgs := append([]llm.ChatMessage(nil), a.messages...)
	a.mu.Unlock()

	opts := llm.CompletionOpts{MaxTokens: agentChatTokens, Timeout: agentChatTimeout, Temperature: 0.4}
	var tools []llm.ToolSpec
	if withTools {
		tools = subAgentToolSpecs()
	}
	res, err := deps.LLM.ChatCompletionEx(ctx, deps.LlmCfg, msgs, tools, toolChoiceFor(withTools), opts)
	if err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.messages = append(a.messages, llm.ChatMessage{Role: "assistant", Content: strings.TrimSpace(res.Content)})
	return nil
}

func (a *PersistentAgent) runLoop(ctx context.Context, deps ToolDeps, withTools bool) (string, error) {
	opts := llm.CompletionOpts{MaxTokens: agentChatTokens, Timeout: agentChatTimeout, Temperature: 0.4}
	var tools []llm.ToolSpec
	if withTools {
		tools = subAgentToolSpecs()
	}
	choice := toolChoiceFor(withTools)

	for i := 0; i < maxAgentChatIters; i++ {
		a.mu.Lock()
		msgs := append([]llm.ChatMessage(nil), a.messages...)
		a.mu.Unlock()

		res, err := deps.LLM.ChatCompletionEx(ctx, deps.LlmCfg, msgs, tools, choice, opts)
		if err != nil {
			return "", err
		}
		if len(res.ToolCalls) == 0 {
			text := strings.TrimSpace(llm.CleanWechatReply(res.Content, 700))
			a.mu.Lock()
			a.messages = append(a.messages, llm.ChatMessage{Role: "assistant", Content: text})
			if len(a.messages) > 24 {
				a.messages = append(a.messages[:1], a.messages[len(a.messages)-23:]...)
			}
			a.mu.Unlock()
			if text == "" {
				return "", fmt.Errorf("空回复")
			}
			return text, nil
		}

		a.mu.Lock()
		a.messages = append(a.messages, llm.ChatMessage{
			Role:      "assistant",
			Content:   res.Content,
			ToolCalls: res.ToolCalls,
		})
		a.mu.Unlock()

		for _, tc := range res.ToolCalls {
			content := "子智能体禁止调用团队编排工具：" + tc.Function.Name
			if !isCrewMetaTool(tc.Function.Name) {
				content = TruncateToolResult(tc.Function.Name, runTool(ctx, deps, tc))
			}
			a.mu.Lock()
			a.messages = append(a.messages, llm.ChatMessage{
				Role: "tool", ToolCallID: tc.ID, Content: content,
			})
			a.mu.Unlock()
		}
	}
	return "", fmt.Errorf("达到最大工具轮次")
}

func (a *PersistentAgent) kill() {
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.alive = false
	a.inbox = nil
}

func (a *PersistentAgent) MemoryLen() int {
	if a == nil {
		return 0
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.messages)
}

// Crew manages agent lifecycle: hire → collaborate → disband.
type Crew struct {
	mu     sync.Mutex
	agents map[string]*PersistentAgent
	board  *AgentBoard
	topic  string
	mode   string
}

func NewCrew(board *AgentBoard) *Crew {
	if board == nil {
		board = NewAgentBoard("")
	}
	return &Crew{agents: map[string]*PersistentAgent{}, board: board}
}

func (c *Crew) Board() *AgentBoard {
	if c == nil {
		return nil
	}
	return c.board
}

func (c *Crew) Hire(name, role, goal string) (*PersistentAgent, error) {
	if c == nil {
		return nil, fmt.Errorf("crew is nil")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.agents) >= maxCrewSize {
		return nil, fmt.Errorf("团队已满（最多 %d 人）", maxCrewSize)
	}
	name = sanitizeAgentName(name)
	if name == "" {
		return nil, fmt.Errorf("name 为空")
	}
	if _, ok := c.agents[name]; ok {
		return nil, fmt.Errorf("已存在：%s", name)
	}
	ag := NewPersistentAgent(name, role, goal)
	c.agents[name] = ag
	if c.board != nil {
		c.board.Post("system", "all", "meta", fmt.Sprintf("招募 %s（%s）", name, role))
	}
	return ag, nil
}

func (c *Crew) Get(name string) (*PersistentAgent, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	ag, ok := c.agents[sanitizeAgentName(name)]
	return ag, ok
}

func (c *Crew) Names() []string {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.agents))
	for n := range c.agents {
		out = append(out, n)
	}
	return out
}

func (c *Crew) Send(from, to, message string) error {
	if c == nil {
		return fmt.Errorf("crew is nil")
	}
	to = sanitizeAgentName(to)
	c.mu.Lock()
	ag, ok := c.agents[to]
	c.mu.Unlock()
	if !ok {
		return fmt.Errorf("未找到：%s", to)
	}
	ag.Receive(from, message)
	if c.board != nil {
		c.board.Post(from, to, "reply", message)
	}
	return nil
}

func (c *Crew) Broadcast(from, message string) {
	if c == nil {
		return
	}
	from = sanitizeAgentName(from)
	c.mu.Lock()
	targets := make([]*PersistentAgent, 0, len(c.agents))
	for name, ag := range c.agents {
		if name != from {
			targets = append(targets, ag)
		}
	}
	c.mu.Unlock()
	for _, ag := range targets {
		ag.Receive(from, message)
	}
	if c.board != nil {
		c.board.Post(from, "all", "opinion", message)
	}
}

func (c *Crew) Disband() []string {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	names := make([]string, 0, len(c.agents))
	for n, ag := range c.agents {
		names = append(names, n)
		ag.kill()
	}
	c.agents = map[string]*PersistentAgent{}
	if c.board != nil {
		c.board.Post("system", "all", "meta", "团队已解散："+strings.Join(names, ", "))
	}
	return names
}

// CrewMember is one planned hire.
type CrewMember struct {
	Name string `json:"name"`
	Role string `json:"role"`
	Task string `json:"task"`
	Goal string `json:"goal,omitempty"`
}

type crewRunOpts struct {
	Topic         string
	SharedContext string
	Mode          string // concurrent | sequential | handoff
	Members       []CrewMember
	WithTools     bool
	KeepAlive     bool
	AutoPlan      bool // LLM plans roster (extra RTT); default false
}

// RunCrew orchestrates a full crew lifecycle and returns a board+results briefing.
func RunCrew(ctx context.Context, deps ToolDeps, opt crewRunOpts) string {
	if deps.LLM == nil {
		return "错误：LLM 未就绪"
	}
	topic := strings.TrimSpace(opt.Topic)
	if topic == "" {
		return "错误：topic 为空"
	}
	mode := strings.ToLower(strings.TrimSpace(opt.Mode))
	switch mode {
	case "concurrent", "sequential", "handoff":
	default:
		mode = defaultCrewMode
	}

	board := deps.Board
	if board == nil {
		board = NewAgentBoard(topic)
	} else {
		board.SetTopic(topic)
	}
	crew := deps.Crew
	if crew == nil {
		crew = NewCrew(board)
	} else {
		crew.board = board
		crew.Disband()
	}
	crew.mu.Lock()
	crew.topic = topic
	crew.mode = mode
	crew.mu.Unlock()

	// Persist pointers back when caller shared deps by value — Cycle must set them.
	deps.Board = board
	deps.Crew = crew

	members := opt.Members
	if len(members) == 0 {
		members = planCrewMembers(ctx, deps, topic, mode, opt.AutoPlan)
	}
	members = normalizeMembers(members, topic)
	if len(members) == 0 {
		return "错误：无法组建团队"
	}

	board.Post("main", "all", "meta", fmt.Sprintf("模式=%s · 议题=%s", mode, topic))
	if sc := strings.TrimSpace(opt.SharedContext); sc != "" {
		board.Post("main", "all", "evidence", "主智能体共享背景：\n"+truncateRunes(sc, 1200))
	}

	for _, m := range members {
		if _, err := crew.Hire(m.Name, m.Role, firstNonEmpty(m.Goal, m.Task)); err != nil {
			board.Post("system", "all", "meta", "招募失败 "+m.Name+": "+err.Error())
		}
	}

	results := map[string]string{}
	var errMsg string
	switch mode {
	case "sequential":
		results, errMsg = runSequential(ctx, deps, crew, members, opt)
	case "handoff":
		results, errMsg = runHandoff(ctx, deps, crew, members, opt)
	default:
		results, errMsg = runConcurrent(ctx, deps, crew, members, opt)
	}

	var out strings.Builder
	out.WriteString(board.Format(40))
	out.WriteString("\n## 各成员产出\n")
	for _, m := range members {
		if r, ok := results[m.Name]; ok {
			out.WriteString(fmt.Sprintf("\n### %s（%s）\n%s\n", m.Name, m.Role, r))
		}
	}
	if fr, ok := results["final_review"]; ok {
		out.WriteString("\n### final_review\n" + fr + "\n")
	}
	if errMsg != "" {
		out.WriteString("\n（部分失败：" + errMsg + "）\n")
	}
	if !opt.KeepAlive {
		disbanded := crew.Disband()
		out.WriteString("\n已解散：" + strings.Join(disbanded, ", ") + "\n")
	} else {
		out.WriteString("\n团队仍存活，可用 agent_chat / agent_send / agent_broadcast 继续协作。\n")
	}
	out.WriteString("\n---\n主智能体请综合：标出共识/分歧，给主人一条微信口语结论；勿逐人复读。")
	return out.String()
}

func runConcurrent(ctx context.Context, deps ToolDeps, crew *Crew, members []CrewMember, opt crewRunOpts) (map[string]string, string) {
	type item struct {
		name string
		text string
		err  string
	}
	ch := make(chan item, len(members))
	var wg sync.WaitGroup
	shared := strings.TrimSpace(opt.SharedContext)
	for _, m := range members {
		m := m
		ag, ok := crew.Get(m.Name)
		if !ok {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			task := m.Task
			if shared != "" {
				task = task + "\n\n背景：\n" + truncateRunes(shared, 800)
			}
			text, err := ag.Chat(ctx, deps, task, opt.WithTools)
			if err != nil {
				ch <- item{name: m.Name, err: err.Error()}
				return
			}
			crew.Broadcast(m.Name, "我完成了任务。摘要："+truncateRunes(text, 220))
			ch <- item{name: m.Name, text: text}
		}()
	}
	wg.Wait()
	close(ch)
	results := map[string]string{}
	var errs []string
	for it := range ch {
		if it.err != "" {
			errs = append(errs, it.name+": "+it.err)
			continue
		}
		results[it.name] = it.text
	}
	if len(members) > 0 {
		last := members[len(members)-1]
		if ag, ok := crew.Get(last.Name); ok {
			review, err := ag.Chat(ctx, deps, "请根据你收到的团队成果做最终审查与总结；指出分歧与建议。", false)
			if err == nil {
				results["final_review"] = review
			}
		}
	}
	return results, strings.Join(errs, "; ")
}

func runSequential(ctx context.Context, deps ToolDeps, crew *Crew, members []CrewMember, opt crewRunOpts) (map[string]string, string) {
	results := map[string]string{}
	var errs []string
	shared := strings.TrimSpace(opt.SharedContext)
	for _, m := range members {
		ag, ok := crew.Get(m.Name)
		if !ok {
			continue
		}
		task := m.Task
		if shared != "" {
			task = task + "\n\n背景：\n" + truncateRunes(shared, 800)
		}
		text, err := ag.Chat(ctx, deps, task, opt.WithTools)
		if err != nil {
			errs = append(errs, m.Name+": "+err.Error())
			continue
		}
		results[m.Name] = text
		crew.Broadcast(m.Name, "我完成了任务。摘要："+truncateRunes(text, 220))
	}
	if len(members) > 0 {
		last := members[len(members)-1]
		if ag, ok := crew.Get(last.Name); ok {
			review, err := ag.Chat(ctx, deps, "请根据你收到的所有团队成果，做最终总结和审查。如有问题请指出。", false)
			if err == nil {
				results["final_review"] = review
			} else {
				errs = append(errs, "review: "+err.Error())
			}
		}
	}
	return results, strings.Join(errs, "; ")
}

func runHandoff(ctx context.Context, deps ToolDeps, crew *Crew, members []CrewMember, opt crewRunOpts) (map[string]string, string) {
	results := map[string]string{}
	if len(members) == 0 {
		return results, "无成员"
	}
	primary := members[0]
	ag, ok := crew.Get(primary.Name)
	if !ok {
		return results, "主办人缺失"
	}
	task := primary.Task
	if sc := strings.TrimSpace(opt.SharedContext); sc != "" {
		task += "\n\n背景：\n" + truncateRunes(sc, 800)
	}
	text, err := ag.Chat(ctx, deps, task, opt.WithTools)
	if err != nil {
		return results, err.Error()
	}
	results[primary.Name] = text
	crew.Broadcast(primary.Name, "交接摘要："+truncateRunes(text, 220))

	if len(members) > 1 {
		rev := members[len(members)-1]
		if rag, ok := crew.Get(rev.Name); ok && rev.Name != primary.Name {
			review, err := rag.Chat(ctx, deps, "你接手审查。请基于 inbox 中的交接摘要，给出确认或修正后的结论。", false)
			if err == nil {
				results[rev.Name] = review
				results["final_review"] = review
			}
		}
	} else {
		results["final_review"] = text
	}
	return results, ""
}

func planCrewMembers(ctx context.Context, deps ToolDeps, topic, mode string, autoPlan bool) []CrewMember {
	if mode == "handoff" {
		return []CrewMember{
			{Name: "specialist", Role: "主办专家", Task: topic},
			{Name: "reviewer", Role: "审查员", Task: "审查主办结论"},
		}
	}
	if autoPlan && deps.LLM != nil {
		if planned := llmPlanCrew(ctx, deps, topic); len(planned) > 0 {
			return planned
		}
	}
	return []CrewMember{
		{Name: "researcher", Role: "事实核查", Task: "核对事实与信息缺口：" + topic},
		{Name: "critic", Role: "挑刺反方", Task: "找漏洞与隐藏假设：" + topic},
		{Name: "planner", Role: "可行方案 / 审查", Task: "给可执行路径并做收束：" + topic},
	}
}

func llmPlanCrew(ctx context.Context, deps ToolDeps, topic string) []CrewMember {
	pctx, cancel := context.WithTimeout(ctx, planTeamTimeout)
	defer cancel()
	sys := `你是项目经理。为任务规划 2～4 人团队。只输出 JSON：
{"team":[{"name":"alice","role":"...","task":"..."}]}
规则：name 用小写英文；最后一人兼任 reviewer；task 简短。`
	opts := llm.CompletionOpts{MaxTokens: 220, Timeout: planTeamTimeout, Temperature: 0.2}
	raw, err := deps.LLM.ChatCompletion(pctx, deps.LlmCfg, []map[string]string{
		{"role": "system", "content": sys},
		{"role": "user", "content": topic},
	}, opts)
	if err != nil || strings.TrimSpace(raw) == "" {
		return nil
	}
	raw = extractJSONObject(raw)
	var parsed struct {
		Team []CrewMember `json:"team"`
	}
	if json.Unmarshal([]byte(raw), &parsed) != nil || len(parsed.Team) == 0 {
		return nil
	}
	return parsed.Team
}

func normalizeMembers(in []CrewMember, topic string) []CrewMember {
	seen := map[string]bool{}
	var out []CrewMember
	for _, m := range in {
		name := sanitizeAgentName(m.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		role := strings.TrimSpace(m.Role)
		if role == "" {
			role = name
		}
		task := strings.TrimSpace(m.Task)
		if task == "" {
			task = topic
		}
		out = append(out, CrewMember{Name: name, Role: role, Task: task, Goal: strings.TrimSpace(m.Goal)})
		if len(out) >= maxCrewSize {
			break
		}
	}
	return out
}

func sanitizeAgentName(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.ReplaceAll(s, " ", "_")
	return s
}

func toolChoiceFor(withTools bool) any {
	if withTools {
		return "auto"
	}
	return "none"
}

func isCrewMetaTool(name string) bool {
	switch name {
	case "multi_agent_run", "agent_board_post", "agent_board_read",
		"agent_send", "agent_broadcast", "agent_chat", "team_status":
		return true
	default:
		return false
	}
}

func subAgentToolSpecs() []llm.ToolSpec {
	all := toolSpecs()
	allow := map[string]bool{
		"web_search": true, "calc": true, "get_local_time": true, "get_weather": true,
	}
	var out []llm.ToolSpec
	for _, t := range all {
		if allow[t.Function.Name] {
			out = append(out, t)
		}
	}
	return out
}

func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "{"); i >= 0 {
		if j := strings.LastIndex(s, "}"); j > i {
			return s[i : j+1]
		}
	}
	return s
}

// --- Board (shared message log) ---

type BoardMessage struct {
	From string
	To   string
	Kind string
	Text string
	At   time.Time
}

type AgentBoard struct {
	mu    sync.Mutex
	topic string
	msgs  []BoardMessage
}

func NewAgentBoard(topic string) *AgentBoard {
	return &AgentBoard{topic: strings.TrimSpace(topic)}
}

func (b *AgentBoard) SetTopic(topic string) {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if t := strings.TrimSpace(topic); t != "" {
		b.topic = t
	}
}

func (b *AgentBoard) Post(from, to, kind, text string) {
	if b == nil {
		return
	}
	from = strings.TrimSpace(from)
	text = strings.TrimSpace(text)
	if from == "" || text == "" {
		return
	}
	kind = strings.ToLower(strings.TrimSpace(kind))
	switch kind {
	case "opinion", "question", "reply", "evidence", "meta":
	default:
		kind = "opinion"
	}
	to = strings.TrimSpace(to)
	if to == "" {
		to = "all"
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.msgs = append(b.msgs, BoardMessage{
		From: from, To: to, Kind: kind, Text: truncateRunes(text, 800), At: time.Now(),
	})
}

func (b *AgentBoard) Snapshot() []BoardMessage {
	if b == nil {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]BoardMessage, len(b.msgs))
	copy(out, b.msgs)
	return out
}

func (b *AgentBoard) Format(limit int) string {
	if b == nil {
		return "（白板未初始化）"
	}
	msgs := b.Snapshot()
	b.mu.Lock()
	topic := b.topic
	b.mu.Unlock()

	var sb strings.Builder
	sb.WriteString("## 多智能体共享白板\n")
	if topic != "" {
		sb.WriteString("议题：" + topic + "\n")
	}
	if len(msgs) == 0 {
		sb.WriteString("（尚无消息）\n")
		return sb.String()
	}
	if limit <= 0 || limit > len(msgs) {
		limit = len(msgs)
	}
	start := len(msgs) - limit
	if start < 0 {
		start = 0
	}
	for i, m := range msgs[start:] {
		sb.WriteString(fmt.Sprintf("\n### #%d [%s→%s] (%s)\n%s\n", start+i+1, m.From, m.To, m.Kind, m.Text))
	}
	return sb.String()
}

// MembersFromAgentArgs converts tool "agents" strings into CrewMembers.
func MembersFromAgentArgs(names []string, topic string) []CrewMember {
	var out []CrewMember
	for _, raw := range names {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		name, role, task := raw, raw, topic
		if i := strings.IndexAny(raw, ":："); i > 0 {
			name = strings.TrimSpace(raw[:i])
			rest := strings.TrimSpace(raw[i+1:])
			role = name
			if rest != "" {
				task = rest
			}
		}
		if p, ok := presetRole(name); ok {
			role = p.role
			if task == topic || task == name {
				task = p.taskPrefix + topic
			}
		}
		out = append(out, CrewMember{Name: name, Role: role, Task: task})
	}
	return normalizeMembers(out, topic)
}

type rolePreset struct {
	role       string
	taskPrefix string
}

func presetRole(name string) (rolePreset, bool) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "researcher":
		return rolePreset{"事实核查", "核对事实与缺口："}, true
	case "critic":
		return rolePreset{"挑刺反方", "找漏洞与假设："}, true
	case "planner":
		return rolePreset{"可行方案", "给可执行路径："}, true
	case "risk":
		return rolePreset{"风险合规", "评估风险与降险："}, true
	case "creative":
		return rolePreset{"创意旁路", "给非常规可落地点子："}, true
	case "advocate":
		return rolePreset{"正向推动", "论证收益："}, true
	case "reviewer":
		return rolePreset{"审查员", "审查并总结："}, true
	default:
		return rolePreset{}, false
	}
}

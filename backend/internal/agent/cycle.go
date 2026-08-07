package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/search"
	"github.com/fluffnest/deskpet/backend/internal/types"
)

const (
	MaxCycles      = 4 // gather → act → finalize; WeChat shouldn't burn 6 LLM RTTs
	MaxReplyChars  = 600
	DefaultChannel = "wechat"
)

// Agent LLM budgets — prefer fewer/faster calls over long thinking.
var (
	agentThinkOpts = llm.CompletionOpts{MaxTokens: 380, Timeout: 16 * time.Second, Temperature: 0.45}
	agentFinalOpts = llm.CompletionOpts{MaxTokens: 420, Timeout: 14 * time.Second, Temperature: 0.5}
	agentFastOpts  = llm.CompletionOpts{MaxTokens: 280, Timeout: 12 * time.Second, Temperature: 0.55}
)

// Request is one agent turn from WeChat (or other channel).
type Request struct {
	LLM         types.LlmSettings
	Pet         types.PetInstance
	History     []types.ChatMessage
	Message     string
	City        string
	PeerID      string
	Channel     string
	Host        *HostSnapshot
	Attachments []types.ImAttachment
}

// Result is the final user-facing reply plus cycle telemetry.
type Result struct {
	Text        string       `json:"text"`
	Cycles      int          `json:"cycles"`
	ToolsUsed   []string     `json:"toolsUsed,omitempty"`
	SkillsUsed  []string     `json:"skillsUsed,omitempty"`
	Trace       []string     `json:"trace,omitempty"`
	HostActions []HostAction `json:"hostActions,omitempty"`
}

// Runtime owns catalog + memory + tool backends.
type Runtime struct {
	LLM     *llm.Client
	Deps    ToolDeps
	Catalog Catalog
	Memory  *Memory
}

func NewRuntimeWithDeps(ai *llm.Client, deps ToolDeps) (*Runtime, error) {
	cat, err := LoadCatalog()
	if err != nil {
		return nil, err
	}
	if deps.Memory == nil {
		mem, err := OpenMemory("")
		if err != nil {
			return nil, err
		}
		deps.Memory = mem
	}
	deps.Catalog = cat
	return &Runtime{LLM: ai, Deps: deps, Catalog: cat, Memory: deps.Memory}, nil
}

// Run executes the agent cycle: rules + skills + tools + memory → final reply.
func (rt *Runtime) Run(ctx context.Context, req Request) (Result, error) {
	var zero Result
	if err := llm.EnsureConfigured(req.LLM); err != nil {
		return zero, err
	}
	channel := req.Channel
	if channel == "" {
		channel = DefaultChannel
	}
	city := strings.TrimSpace(req.City)
	if city == "" {
		city = strings.TrimSpace(req.LLM.City)
	}
	if city == "" {
		city = "北京"
	}
	deps := rt.Deps
	deps.City = city
	deps.PeerID = req.PeerID
	deps.Catalog = rt.Catalog
	deps.Memory = rt.Memory
	deps.Pet = req.Pet
	deps.LLM = rt.LLM
	deps.LlmCfg = req.LLM
	deps.Attachments = append([]types.ImAttachment(nil), req.Attachments...)
	if deps.MediaRoot == "" {
		deps.MediaRoot = defaultMediaRoot()
	}
	if req.Host != nil {
		deps.Host = &HostBridge{Snapshot: *req.Host}
	} else {
		deps.Host = &HostBridge{}
	}

	lastSkills := readLastSkills(rt.Memory, req.PeerID)
	matched := rt.Catalog.RouteSkills(req.Message, req.History, lastSkills)
	if len(req.Attachments) > 0 {
		if docSk, ok := rt.Catalog.FindSkill("documents"); ok {
			matched = prependSkill(matched, docSk)
		}
	}
	var matchedNames []string
	var skillBlocks []string
	for _, sk := range matched {
		matchedNames = append(matchedNames, sk.Name)
		skillBlocks = append(skillBlocks, fmt.Sprintf(
			"### Suggested Skill: %s\n%s\n\n%s",
			sk.Name, sk.Description, truncateSkillBody(sk.Body),
		))
	}
	if routeNote := FormatRoutedSkills(matched); routeNote != "" {
		log.Printf("[agent] routed skills=%s peer=%s", routeNote, shortPeer(req.PeerID))
	}

	system := rt.buildSystemPrompt(req.Pet, channel, city, skillBlocks)
	messages := []llm.ChatMessage{{Role: "system", Content: system}}

	// Core LTM highlights + working memory (thread/digest/notes/recalls).
	if ess := rt.Memory.EssentialsForPrompt(req.PeerID); ess != "" {
		messages = append(messages, llm.ChatMessage{Role: "system", Content: ess})
	}
	if wm := rt.Memory.WorkingMemoryForPrompt(req.PeerID, req.Message); wm != "" {
		messages = append(messages, llm.ChatMessage{Role: "system", Content: wm})
	}
	if deps.Host != nil {
		messages = append(messages, llm.ChatMessage{
			Role: "system",
			Content: "## Desktop Host State\n" + deps.Host.SnapshotText() +
				"\n提醒/定时用 reminder_* / schedule_*；冒泡用 pet_notify。",
		})
	}
	if note := formatAttachmentsNote(req.Attachments); note != "" {
		messages = append(messages, llm.ChatMessage{
			Role:    "system",
			Content: note,
		})
	}

	messages = append(messages, CompressHistory(req.History)...)
	messages = append(messages, llm.ChatMessage{
		Role: "user",
		Content: fmt.Sprintf(
			"主人微信：%s\n\n衔接 Working Memory/近期对话。需要事实再调工具（已注入的 skill 勿再 load_skill）。最后直接口语回复。",
			strings.TrimSpace(req.Message),
		),
	})

	fastPath := !needsToolsLikely(matched, req.Message, req.Attachments)
	tools := toolSpecs()
	var (
		toolsUsed  []string
		skillsUsed = append([]string{}, matchedNames...)
		trace      []string
		usedTool   bool
	)

	for cycle := 1; cycle <= MaxCycles; cycle++ {
		trace = append(trace, fmt.Sprintf("cycle_%d_think", cycle))
		opts := agentThinkOpts
		var toolChoice any = "auto"
		activeTools := tools
		switch {
		case fastPath && cycle == 1 && !usedTool:
			// Chitchat / follow-up: one shot, no tool RTT.
			opts = agentFastOpts
			toolChoice = "none"
			activeTools = nil
			trace = append(trace, "fast_path")
		case usedTool && cycle >= MaxCycles-1:
			// Force finalize — avoid another tool round near the cap.
			opts = agentFinalOpts
			toolChoice = "none"
			activeTools = nil
		case usedTool:
			opts = agentFinalOpts
		}

		res, err := rt.LLM.ChatCompletionEx(ctx, req.LLM, messages, activeTools, toolChoice, opts)
		if err != nil {
			if cycle == 1 {
				return rt.fallback(ctx, req, deps, city, matchedNames)
			}
			return zero, err
		}

		// Some gateways dump tool XML/DSML into content when tools are disabled.
		if len(res.ToolCalls) == 0 {
			if embedded := llm.ParseEmbeddedToolCalls(res.Content); len(embedded) > 0 {
				res.ToolCalls = embedded
				trace = append(trace, "recover_embedded_tools")
			} else if llm.LooksLikeToolLeak(res.Content) && !usedTool && cycle < MaxCycles {
				fastPath = false
				messages = append(messages, llm.ChatMessage{
					Role:    "assistant",
					Content: res.Content,
				})
				messages = append(messages, llm.ChatMessage{
					Role:    "user",
					Content: "不要把工具调用写成 XML/DSML 文本。请用正式 tools 调用 web_search 等，再给口语答案。",
				})
				trace = append(trace, "retry_after_tool_leak")
				continue
			}
		}

		if len(res.ToolCalls) == 0 {
			text := llm.CleanWechatReply(res.Content, MaxReplyChars)
			if text == "" {
				if usedTool {
					return rt.synthesize(ctx, req, messages, cycle, toolsUsed, skillsUsed, trace, deps)
				}
				return rt.fallback(ctx, req, deps, city, matchedNames)
			}
			persistTurnAsync(rt.Memory, req.PeerID, req.Message, text, skillsUsed)
			log.Printf("[agent] peer=%s cycles=%d tools=%v skills=%v fast=%v", shortPeer(req.PeerID), cycle, toolsUsed, skillsUsed, fastPath)
			return withHost(Result{
				Text:       text,
				Cycles:     cycle,
				ToolsUsed:  uniq(toolsUsed),
				SkillsUsed: uniq(skillsUsed),
				Trace:      trace,
			}, deps), nil
		}

		usedTool = true
		messages = append(messages, llm.ChatMessage{
			Role:      "assistant",
			Content:   res.Content,
			ToolCalls: res.ToolCalls,
		})
		toolResults := runToolsParallel(ctx, deps, res.ToolCalls)
		for _, tr := range toolResults {
			toolsUsed = append(toolsUsed, tr.name)
			trace = append(trace, fmt.Sprintf("cycle_%d_tool:%s", cycle, tr.name))
			if tr.name == "load_skill" && tr.skillName != "" {
				skillsUsed = append(skillsUsed, tr.skillName)
			}
			messages = append(messages, llm.ChatMessage{
				Role:       "tool",
				ToolCallID: tr.id,
				Name:       tr.name,
				Content:    tr.content,
			})
		}
		// Nudge model to answer — cuts an extra empty tool-thinking round.
		messages = append(messages, llm.ChatMessage{
			Role:    "system",
			Content: "工具结果已返回。若信息足够，请直接给主人微信口语回复，不要再调工具。",
		})
	}

	return rt.synthesize(ctx, req, messages, MaxCycles, toolsUsed, skillsUsed, append(trace, "synthesize"), deps)
}

type parallelToolResult struct {
	id        string
	name      string
	content   string
	skillName string
}

func runToolsParallel(ctx context.Context, deps ToolDeps, calls []llm.ToolCall) []parallelToolResult {
	out := make([]parallelToolResult, len(calls))
	if len(calls) == 0 {
		return out
	}
	if len(calls) == 1 {
		tc := calls[0]
		var skillName string
		if tc.Function.Name == "load_skill" {
			var args map[string]any
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
			skillName, _ = args["name"].(string)
		}
		out[0] = parallelToolResult{
			id:        tc.ID,
			name:      tc.Function.Name,
			content:   TruncateToolResult(tc.Function.Name, runTool(ctx, deps, tc)),
			skillName: skillName,
		}
		return out
	}
	var wg sync.WaitGroup
	for i, tc := range calls {
		wg.Add(1)
		go func(i int, tc llm.ToolCall) {
			defer wg.Done()
			var skillName string
			if tc.Function.Name == "load_skill" {
				var args map[string]any
				_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
				skillName, _ = args["name"].(string)
			}
			out[i] = parallelToolResult{
				id:        tc.ID,
				name:      tc.Function.Name,
				content:   TruncateToolResult(tc.Function.Name, runTool(ctx, deps, tc)),
				skillName: skillName,
			}
		}(i, tc)
	}
	wg.Wait()
	return out
}

func persistTurnAsync(mem *Memory, peerID, question, answer string, skills []string) {
	if mem == nil {
		return
	}
	peerID = strings.TrimSpace(peerID)
	go func() {
		_ = mem.RememberTurn(peerID, question, answer)
		writeLastSkills(mem, peerID, uniq(skills))
	}()
}

// needsToolsLikely decides whether this turn should skip the tool-calling path.
func needsToolsLikely(matched []Skill, message string, atts []types.ImAttachment) bool {
	if len(atts) > 0 {
		return true
	}
	for _, sk := range matched {
		switch sk.Name {
		case "research", "weather-care", "news-digest", "documents", "scheduler",
			"planner", "lingua", "memory-keeper", "owner-dossier", "self-growth":
			return true
		}
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		return false
	}
	low := strings.ToLower(msg)
	needles := []string{
		"天气", "气温", "下雨", "新闻", "热点", "头条", "搜索", "查一下", "查下", "查查",
		"最新", "更新", "几点", "星期", "计算", "多少", "提醒", "定时", "每天",
		"翻译", "总结", "摘要", "记住", "忘记", "档案",
		"冠军", "成绩", "结果", "谁赢", "比赛", "决赛", "排名", "积分", "比分",
		"驿传", "箱根",
		"forecast", "weather", "news", "search", "translate", "champion", "score",
		"http://", "https://",
	}
	for _, n := range needles {
		if strings.Contains(low, strings.ToLower(n)) || strings.Contains(msg, n) {
			return true
		}
	}
	// Fact-seeking questions: has ？/? and is longer than pure chitchat.
	if (strings.Contains(msg, "？") || strings.Contains(msg, "?")) && runeLen(msg) >= 6 {
		return true
	}
	return false
}

func withHost(res Result, deps ToolDeps) Result {
	if deps.Host != nil {
		res.HostActions = deps.Host.ActionsCopy()
	}
	return res
}

func (rt *Runtime) buildSystemPrompt(pet types.PetInstance, channel, city string, skillBlocks []string) string {
	var b strings.Builder
	persona := pet.Personality
	if note := strings.TrimSpace(pet.PersonalityNote); note != "" {
		persona = persona + "；设定：" + note
	}
	fmt.Fprintf(&b,
		"你是桌宠「%s」的微信 Agent（性格：%s）。\n"+
			"你不是只会闲聊的气泡回复器；你是带 tools / rules / skills / memory / cycle 的智能体。\n"+
			"默认城市：%s。频道：%s。\n\n",
		pet.Name, persona, city, channel,
	)
	b.WriteString(rt.Catalog.RulesPrompt(channel))
	b.WriteString("\n\n## Available Skills\n")
	b.WriteString(rt.Catalog.SkillsBrief())
	if len(skillBlocks) > 0 {
		b.WriteString("\n\n## Auto-matched Skills for this turn\n")
		b.WriteString(strings.Join(skillBlocks, "\n\n"))
		b.WriteString("\n（正文已注入，通常无需再 load_skill）")
	}
	b.WriteString("\n\n## Cycle Contract\n")
	b.WriteString("Observe → Working Memory → Tools?(缺事实才调) → 微信口语回复。\n")
	b.WriteString("已注入 essentials + working memory + 近期对话；够用就直接答，少绕工具圈。\n")
	b.WriteString("最终回复必须是给主人看的中文口语，不要输出 JSON/工具参数。")
	return b.String()
}

func (rt *Runtime) synthesize(
	ctx context.Context,
	req Request,
	messages []llm.ChatMessage,
	cycles int,
	toolsUsed, skillsUsed, trace []string,
	deps ToolDeps,
) (Result, error) {
	messages = append(messages, llm.ChatMessage{
		Role: "user",
		Content: fmt.Sprintf(
			"请根据以上 rules/skills/tools/memory 结果，用「%s」口吻写出最终微信回复（≤%d字，直接回复）。原问题：%s",
			req.Pet.Name, MaxReplyChars, req.Message,
		),
	})
	opts := agentFinalOpts
	res, err := rt.LLM.ChatCompletionEx(ctx, req.LLM, messages, nil, "", opts)
	if err != nil {
		return Result{}, err
	}
	text := llm.CleanWechatReply(res.Content, MaxReplyChars)
	if text == "" {
		return Result{}, fmt.Errorf("未能整理出回复")
	}
	persistTurnAsync(rt.Memory, req.PeerID, req.Message, text, skillsUsed)
	return withHost(Result{
		Text:       text,
		Cycles:     cycles,
		ToolsUsed:  uniq(toolsUsed),
		SkillsUsed: uniq(skillsUsed),
		Trace:      trace,
	}, deps), nil
}

func (rt *Runtime) fallback(ctx context.Context, req Request, deps ToolDeps, city string, skills []string) (Result, error) {
	briefing := gatherBriefing(ctx, deps, city, req.Message)
	msgs := []map[string]string{
		{"role": "system", "content": rt.buildSystemPrompt(req.Pet, DefaultChannel, city, nil) + "\n你必须依据【检索资料】作答。"},
		{"role": "user", "content": fmt.Sprintf(
			"主人问：%s\n\n【检索资料】\n%s\n\n【主人/自我要点】\n%s\n\n【Working Memory】\n%s\n\n请给出微信回复。",
			req.Message, briefing,
			rt.Memory.EssentialsForPrompt(req.PeerID),
			rt.Memory.WorkingMemoryForPrompt(req.PeerID, req.Message),
		)},
	}
	raw, err := rt.LLM.ChatCompletion(ctx, req.LLM, msgs, agentFinalOpts)
	if err != nil {
		return Result{}, err
	}
	text := llm.CleanWechatReply(raw, MaxReplyChars)
	writeLastSkills(rt.Memory, req.PeerID, uniq(skills))
	return withHost(Result{
		Text:       text,
		Cycles:     1,
		ToolsUsed:  []string{"fallback_gather"},
		SkillsUsed: skills,
		Trace:      []string{"fallback"},
	}, deps), nil
}

func gatherBriefing(ctx context.Context, deps ToolDeps, city, userMessage string) string {
	q := strings.TrimSpace(userMessage)
	var parts []string
	if deps.Search != nil {
		if hits, err := deps.Search.Search(ctx, q, 6); err == nil {
			parts = append(parts, "网络搜索：\n"+search.FormatHits(hits))
		}
	}
	low := strings.ToLower(q)
	if strings.Contains(q, "天气") || strings.Contains(low, "weather") {
		if deps.Weather != nil {
			if text, err := deps.Weather.Summary(ctx, city); err == nil {
				parts = append(parts, "天气：\n"+text)
			}
		}
	}
	if len(parts) == 0 {
		return "（暂无外部资料）"
	}
	return strings.Join(parts, "\n\n")
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func shortPeer(id string) string {
	if id == "" {
		return "-"
	}
	r := []rune(id)
	if len(r) <= 12 {
		return id
	}
	return string(r[:8]) + "…"
}

const lastSkillsKey = "last_skills"

func readLastSkills(mem *Memory, peerID string) []string {
	if mem == nil {
		return nil
	}
	v, ok := mem.Read(peerID, lastSkillsKey)
	if !ok || strings.TrimSpace(v) == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func writeLastSkills(mem *Memory, peerID string, skills []string) {
	if mem == nil || peerID == "" || len(skills) == 0 {
		return
	}
	_ = mem.Write(peerID, lastSkillsKey, strings.Join(uniq(skills), ","), "agent", false)
}

func formatAttachmentsNote(atts []types.ImAttachment) string {
	if len(atts) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## 本轮微信附件\n")
	b.WriteString("请先调用 read_document 读取后再回答。图片/视频暂不支持识读。\n")
	for i, a := range atts {
		name := strings.TrimSpace(a.Name)
		if name == "" {
			name = filepath.Base(a.Path)
		}
		fmt.Fprintf(&b, "- [%d] %s\n  path: %s\n", i, name, a.Path)
	}
	return b.String()
}

func prependSkill(list []Skill, sk Skill) []Skill {
	for _, s := range list {
		if s.Name == sk.Name {
			return list
		}
	}
	out := make([]Skill, 0, len(list)+1)
	out = append(out, sk)
	out = append(out, list...)
	if len(out) > maxRoutedSkills {
		out = out[:maxRoutedSkills]
	}
	return out
}

func defaultMediaRoot() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "com.fluffnest.deskpet", "wechat-media")
}

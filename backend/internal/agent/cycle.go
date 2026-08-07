package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/search"
	"github.com/fluffnest/deskpet/backend/internal/types"
)

const (
	MaxCycles      = 4 // gather → act → finalize; WeChat shouldn't burn 6 LLM RTTs
	MaxReplyChars  = 1200
	DefaultChannel = "wechat"
)

// Agent LLM budgets — enough headroom so WeChat replies aren't cut mid-sentence.
var (
	agentThinkOpts = llm.CompletionOpts{MaxTokens: 1000, Timeout: 22 * time.Second, Temperature: 0.45}
	agentFinalOpts = llm.CompletionOpts{MaxTokens: 1200, Timeout: 22 * time.Second, Temperature: 0.5}
	agentFastOpts  = llm.CompletionOpts{MaxTokens: 720, Timeout: 16 * time.Second, Temperature: 0.55}
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
	deps.Board = NewAgentBoard("")
	deps.Crew = NewCrew(deps.Board)

	// Capture favorites/people + explicit diary/thoughts before prompt assembly.
	if n := rt.Memory.HarvestOwnerKnowledge(req.PeerID, req.Message); n > 0 {
		log.Printf("[agent] harvested %d knowledge fields peer=%s", n, shortPeer(req.PeerID))
	}
	if kind, body, ok := DetectJournalIntent(req.Message); ok {
		if _, err := rt.Memory.JournalAppend(req.PeerID, kind, body, "", "harvest", nil); err == nil {
			log.Printf("[agent] journal %s saved peer=%s", kind, shortPeer(req.PeerID))
		}
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

	// Kick off search agent in parallel with prompt/memory assembly.
	type prefRes struct {
		brief string
		ok    bool
	}
	var prefCh <-chan prefRes
	doPrefetch := shouldPrefetchWeb(matched, req.Message, req.Attachments)
	if doPrefetch {
		ch := make(chan prefRes, 1)
		prefCh = ch
		msgCopy := req.Message
		go func() {
			b, ok := prefetchWebBriefing(ctx, deps, msgCopy)
			ch <- prefRes{brief: b, ok: ok}
		}()
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

	var (
		toolsUsed  []string
		skillsUsed = append([]string{}, matchedNames...)
		trace      []string
		usedTool   bool
	)
	fastPath := !needsToolsLikely(matched, req.Message, req.Attachments)
	if doPrefetch {
		select {
		case r := <-prefCh:
			if r.ok {
				messages = append(messages, llm.ChatMessage{
					Role: "system",
					Content: "## 本轮检索结果（国内/国际并行 agent；优先依据此作答）\n" +
						r.brief +
						"\n若仍不够，可再调 web_search / 其它工具补证。",
				})
				toolsUsed = append(toolsUsed, "web_search")
				usedTool = true
				trace = append(trace, "prefetch_web_parallel")
			} else {
				trace = append(trace, "prefetch_web_empty")
			}
		case <-ctx.Done():
			trace = append(trace, "prefetch_web_canceled")
		}
	} else {
		trace = append(trace, "skip_web_prefetch")
	}

	userHint := "请依据 Working Memory 作答；确定性任务用对应工具。最后直接口语回复。"
	if usedTool {
		userHint = "请依据上方 Working Memory / 检索结果作答；近况勿凭记忆编造。已注入的 skill 勿再 load_skill。最后直接口语回复。"
	}
	messages = append(messages, llm.ChatMessage{
		Role: "user",
		Content: fmt.Sprintf(
			"主人微信：%s\n\n%s",
			strings.TrimSpace(req.Message), userHint,
		),
	})

	tools := toolSpecs()
	for cycle := 1; cycle <= MaxCycles; cycle++ {
		trace = append(trace, fmt.Sprintf("cycle_%d_think", cycle))
		opts := agentThinkOpts
		var toolChoice any = "auto"
		activeTools := tools
		switch {
		case fastPath && cycle == 1 && !usedTool:
			// Pure chitchat only: one shot, no tool RTT.
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
			} else if llm.LooksLikeToolLeak(res.Content) && cycle < MaxCycles {
				// Never append raw DSML into history — that teaches the model to leak again.
				fastPath = false
				messages = append(messages, llm.ChatMessage{
					Role:    "user",
					Content: "刚才工具调用格式无效。请用正式 tools 调用（如 web_search），或直接给主人完整中文口语答案；禁止输出 DSML/XML/特殊符号。",
				})
				trace = append(trace, "retry_after_tool_leak")
				continue
			}
		}

		if len(res.ToolCalls) == 0 {
			text := llm.CleanWechatReply(res.Content, MaxReplyChars)
			lengthCut := strings.EqualFold(res.FinishReason, "length")
			rawIncomplete := llm.LooksIncompleteReply(strings.TrimSpace(res.Content))
			bad := text == "" || llm.LooksIncompleteReply(text)
			if (bad || lengthCut || rawIncomplete) && cycle < MaxCycles {
				fastPath = false
				hint := "请给出完整的微信口语回复，把话说完；每句用句号收尾，不要停在引号、破折号或半截从句上，也不要输出工具标记。"
				if lengthCut || rawIncomplete {
					hint = "上一段话说到一半就断了。请一次性重写完整微信口语回复（把要点/争议说完），句子必须说完，禁止半截引号或 Markdown。"
				}
				messages = append(messages, llm.ChatMessage{
					Role:    "user",
					Content: hint,
				})
				trace = append(trace, "retry_incomplete_reply")
				continue
			}
			if bad {
				if usedTool {
					return rt.synthesize(ctx, req, messages, cycle, toolsUsed, skillsUsed, append(trace, "incomplete_synth"), deps)
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
		_ = mem.HarvestOwnerKnowledge(peerID, question)
		_ = mem.RememberTurn(peerID, question, answer)
		writeLastSkills(mem, peerID, uniq(skills))
	}()
}

// needsToolsLikely decides whether this turn should skip the tool-calling path.
// Policy: default OPEN tools; only a narrow chitchat allowlist uses fast_path
// (tool_choice=none). Do NOT enumerate proper nouns (people/events) here —
// those belong in search aliases, not tool routing.
func needsToolsLikely(matched []Skill, message string, atts []types.ImAttachment) bool {
	if len(atts) > 0 {
		return true
	}
	for _, sk := range matched {
		if skillRequiresTools(sk.Name) {
			return true
		}
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		return false
	}
	if isChitchatFastPath(matched, msg) {
		return false
	}
	return true
}

func skillRequiresTools(name string) bool {
	switch name {
	case "research", "weather-care", "news-digest", "documents", "scheduler",
		"planner", "lingua", "memory-keeper", "owner-dossier", "self-growth", "multi-agent", "journal":
		return true
	default:
		return false
	}
}

var (
	nthEditionRe = regexp.MustCompile(`第\s*\d+\s*回`)
	socialAskRe  = regexp.MustCompile(`(?i)(在吗|想我|想你|想卡|爱我|爱你|吃了吗|睡了吗|开心吗|难过吗|想我了吗|早上好|晚安|早安|你好呀|嗨|hi\b|hello\b|摸摸|陪我|无聊|想你了)`)
)

// isChitchatFastPath is intentionally tiny: only greetings / mood / pet roleplay.
// Preference statements & recalls need tools/dossier path (or at least not skip memory).
func isChitchatFastPath(matched []Skill, msg string) bool {
	if hasFactSeekingShape(msg) || hasPreferenceSignal(msg) {
		return false
	}
	n := runeLen(msg)
	if n > 20 {
		return false
	}
	softOnly := matchedSoftSkillsOnly(matched)
	if !softOnly && len(matched) > 0 {
		return false
	}
	if n <= 6 {
		return true
	}
	return looksSocialUtterance(msg)
}

func matchedSoftSkillsOnly(matched []Skill) bool {
	if len(matched) == 0 {
		return true
	}
	for _, sk := range matched {
		switch sk.Name {
		case "companion", "entertainment", "clarify":
			continue
		default:
			return false
		}
	}
	return true
}

func hasFactSeekingShape(msg string) bool {
	low := strings.ToLower(msg)
	if strings.Contains(low, "http://") || strings.Contains(low, "https://") {
		return true
	}
	if nthEditionRe.MatchString(msg) {
		return true
	}
	// Category / lookup cues (domains, not proper nouns).
	for _, n := range []string{
		"搜索", "查一下", "查下", "查查", "搜一下", "搜一搜",
		"新闻", "热点", "头条", "最新", "新料", "更新", "补丁",
		"天气", "气温", "下雨", "几点", "星期", "计算", "多少",
		"翻译", "总结", "摘要", "提醒", "定时", "每天",
		"记住", "忘记", "档案",
		"成绩", "冠军", "比分", "排名", "比赛", "决赛", "谁赢",
		"名单", "入选", "国家队", "世界杯", "本届", "本赛季",
		"weather", "forecast", "news", "search", "translate",
		"champion", "score", "world cup", "update", "patch",
	} {
		if strings.Contains(low, strings.ToLower(n)) || strings.Contains(msg, n) {
			return true
		}
	}
	// Non-social questions → treat as fact-seeking.
	if (strings.Contains(msg, "？") || strings.Contains(msg, "?")) && runeLen(msg) >= 6 {
		if !isSocialQuestion(msg) {
			return true
		}
	}
	// “是不是/有没有/怎样了” about a topic (not pure mood).
	if runeLen(msg) >= 8 {
		for _, w := range []string{"是不是", "有没有", "怎么样了", "怎样了", "谁是", "哪年", "几号"} {
			if strings.Contains(msg, w) && !isSocialQuestion(msg) {
				return true
			}
		}
	}
	return false
}

func isSocialQuestion(msg string) bool {
	return socialAskRe.MatchString(msg) || looksMoodTalk(msg)
}

func looksSocialUtterance(msg string) bool {
	if isSocialQuestion(msg) || looksMoodTalk(msg) {
		return true
	}
	low := strings.ToLower(msg)
	for _, w := range []string{
		"哈哈", "嘿嘿", "嗯嗯", "好呀", "好的", "谢谢", "拜拜", "在的",
		"摸摸", "抱抱", "想你", "陪我", "无聊", "开心", "难过", "晚安", "早安",
		"hello", "hi", "hey",
	} {
		if strings.Contains(low, w) || strings.Contains(msg, w) {
			return true
		}
	}
	return false
}

func looksMoodTalk(msg string) bool {
	for _, w := range []string{"心情", "感觉", "累了", "开心", "难过", "想哭", "想你", "陪陪", "撒娇"} {
		if strings.Contains(msg, w) {
			return true
		}
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
	b.WriteString("Observe → Working Memory ∥ 检索agents → 主智能体判断是否 multi_agent_run → 工具 → 微信口语回复。\n")
	b.WriteString("天气/时间/计算/翻译/记忆/提醒等确定性任务不要网页搜索；时事/人物近况才检索。\n")
	b.WriteString("决策/利弊/多视角权衡可用多智能体会议（共享白板）；简单问题不要开会。\n")
	b.WriteString("最终回复必须是给主人看的中文口语，句子说完再停；不要输出 JSON/工具参数/Markdown。")
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
			"请根据以上 rules/skills/tools/memory 结果，用「%s」口吻写出最终微信回复（≤%d字，句子要说完，禁止半截引号，直接回复）。原问题：%s",
			req.Pet.Name, MaxReplyChars, req.Message,
		),
	})
	opts := agentFinalOpts
	res, err := rt.LLM.ChatCompletionEx(ctx, req.LLM, messages, nil, "", opts)
	if err != nil {
		return Result{}, err
	}
	text := llm.CleanWechatReply(res.Content, MaxReplyChars)
	if text == "" || llm.LooksIncompleteReply(text) {
		return Result{}, fmt.Errorf("未能整理出完整回复")
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
	if brief, ok := prefetchWebBriefing(ctx, deps, q); ok {
		parts = append(parts, "网络搜索：\n"+brief)
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

// prefetchWebBriefing hits scoped federated search (cn|intl|both).
func prefetchWebBriefing(ctx context.Context, deps ToolDeps, userMessage string) (string, bool) {
	q := strings.TrimSpace(userMessage)
	if q == "" || deps.Search == nil {
		return "", false
	}
	kind := "web"
	if searchLooksNews(q) {
		kind = "news"
	}
	scope := search.ClassifyScope(q)
	hits, err := deps.Search.SearchOpt(ctx, q, search.Options{Limit: 6, Type: kind, Scope: scope})
	if err != nil || len(hits) == 0 {
		return "", false
	}
	return search.FormatHits(hits), true
}

// shouldPrefetchWeb: only when the answer needs live web evidence.
// Skip deterministic / tool-specific intents that won't benefit from search engines.
func shouldPrefetchWeb(matched []Skill, message string, atts []types.ImAttachment) bool {
	if len(atts) > 0 {
		return false
	}
	msg := strings.TrimSpace(message)
	if msg == "" || isChitchatFastPath(matched, msg) {
		return false
	}
	if skipWebSearchIntent(matched, msg) {
		return false
	}
	// Personal-fact statements belong in dossier, not web search.
	if hasPersonalFactSignal(msg) && !hasFactSeekingShape(msg) && !searchLooksNews(msg) && !looksFreshIntentMsg(msg) {
		return false
	}
	// Explicit research skill or fact/current-affairs shape.
	for _, sk := range matched {
		if sk.Name == "research" || sk.Name == "news-digest" {
			return true
		}
	}
	return hasFactSeekingShape(msg) || searchLooksNews(msg) || looksFreshIntentMsg(msg)
}

func looksFreshIntentMsg(msg string) bool {
	keys := []string{
		"最新", "新料", "刚刚", "近日", "本届", "本赛季", "世界杯", "入选",
		"谁赢", "成绩", "冠军", "比赛", "转会", "山神", "驿传", "駅伝",
	}
	for _, k := range keys {
		if strings.Contains(msg, k) {
			return true
		}
	}
	return false
}

func skipWebSearchIntent(matched []Skill, msg string) bool {
	// Dedicated-tool intents (even without skill match).
	low := strings.ToLower(msg)
	for _, k := range []string{
		"天气", "气温", "下雨", "下雪", "紫外线", "穿什么",
		"几点", "星期几", "周几", "今天几号", "现在时间",
		"计算", "算一下", "等于多少", "翻译", "译成", "翻成",
		"总结这段", "摘要一下", "说人话",
		"记住", "别忘", "忘记", "我的档案", "提醒我", "定个时", "取消提醒",
		"讲个笑", "笑话", "运势", "占卜",
		"我住", "我家在", "我叫", "叫我", "最喜欢", "最爱", "我女朋友", "我男朋友",
		"日记", "想法", "心情", "感悟", "翻日记",
		"weather", "translate", "remind",
	} {
		if strings.Contains(low, strings.ToLower(k)) || strings.Contains(msg, k) {
			return true
		}
	}
	if isDeterministicMath(msg) {
		return true
	}
	if len(matched) > 0 && matchedSoftSkillsOnly(matched) {
		return true
	}
	for _, sk := range matched {
		switch sk.Name {
		case "weather-care", "scheduler", "lingua", "memory-keeper",
			"owner-dossier", "self-growth", "documents", "journal":
			return true
		}
	}
	return false
}

func isDeterministicMath(msg string) bool {
	s := strings.TrimSpace(msg)
	if s == "" {
		return false
	}
	// Allow digits, ops, spaces, 等于/是多少
	compact := strings.NewReplacer("等于", "", "是多少", "", "多少", "", "？", "", "?", "", " ", "", "算", "").Replace(s)
	if compact == "" {
		return false
	}
	hasDigit := false
	for _, r := range compact {
		switch {
		case r >= '0' && r <= '9':
			hasDigit = true
		case r == '+' || r == '-' || r == '*' || r == '/' || r == '×' || r == '÷' || r == '(' || r == ')' || r == '.' || r == '=':
			continue
		default:
			return false
		}
	}
	return hasDigit
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

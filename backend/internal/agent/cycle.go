package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/search"
	"github.com/fluffnest/deskpet/backend/internal/types"
)

const (
	MaxCycles      = 6
	MaxReplyChars  = 600
	DefaultChannel = "wechat"
)

// Request is one agent turn from WeChat (or other channel).
type Request struct {
	LLM     types.LlmSettings
	Pet     types.PetInstance
	History []types.ChatMessage
	Message string
	City    string
	PeerID  string
	Channel string
}

// Result is the final user-facing reply plus cycle telemetry.
type Result struct {
	Text       string   `json:"text"`
	Cycles     int      `json:"cycles"`
	ToolsUsed  []string `json:"toolsUsed,omitempty"`
	SkillsUsed []string `json:"skillsUsed,omitempty"`
	Trace      []string `json:"trace,omitempty"`
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

	matched := rt.Catalog.MatchSkills(req.Message)
	var matchedNames []string
	var skillBlocks []string
	for _, sk := range matched {
		matchedNames = append(matchedNames, sk.Name)
		skillBlocks = append(skillBlocks, fmt.Sprintf("### Suggested Skill: %s\n%s\n\n%s", sk.Name, sk.Description, sk.Body))
	}

	system := rt.buildSystemPrompt(req.Pet, channel, city, skillBlocks)
	messages := []llm.ChatMessage{{Role: "system", Content: system}}

	if snap := rt.Memory.Snapshot(req.PeerID); snap != "" {
		messages = append(messages, llm.ChatMessage{
			Role:    "system",
			Content: "## Memory Snapshot\n" + snap,
		})
	}

	start := 0
	if len(req.History) > 10 {
		start = len(req.History) - 10
	}
	for _, m := range req.History[start:] {
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		messages = append(messages, llm.ChatMessage{Role: role, Content: m.Content})
	}
	messages = append(messages, llm.ChatMessage{
		Role: "user",
		Content: fmt.Sprintf(
			"主人微信消息：%s\n\n请按 Agent Cycle 工作：\n1) 判断是否命中 skill（可用 load_skill）\n2) 需要事实则调用 tools\n3) 可读写 memory\n4) 产出最终微信回复（不要再调用工具时直接给最终回复文本）",
			strings.TrimSpace(req.Message),
		),
	})

	opts := llm.CompletionOpts{MaxTokens: 700, Timeout: 28 * time.Second, Temperature: 0.5}
	tools := toolSpecs()
	var (
		toolsUsed  []string
		skillsUsed = append([]string{}, matchedNames...)
		trace      []string
		usedTool   bool
	)

	for cycle := 1; cycle <= MaxCycles; cycle++ {
		trace = append(trace, fmt.Sprintf("cycle_%d_think", cycle))
		res, err := rt.LLM.ChatCompletionEx(ctx, req.LLM, messages, tools, "auto", opts)
		if err != nil {
			if cycle == 1 {
				return rt.fallback(ctx, req, deps, city, matchedNames)
			}
			return zero, err
		}

		if len(res.ToolCalls) == 0 {
			text := llm.CleanWechatReply(res.Content, MaxReplyChars)
			if text == "" {
				if usedTool {
					return rt.synthesize(ctx, req, messages, cycle, toolsUsed, skillsUsed, trace)
				}
				return rt.fallback(ctx, req, deps, city, matchedNames)
			}
			_ = rt.Memory.AddSessionNote(req.PeerID, "Q: "+truncateRunes(req.Message, 80))
			_ = rt.Memory.AddSessionNote(req.PeerID, "A: "+truncateRunes(text, 80))
			log.Printf("[agent] peer=%s cycles=%d tools=%v skills=%v", shortPeer(req.PeerID), cycle, toolsUsed, skillsUsed)
			return Result{
				Text:       text,
				Cycles:     cycle,
				ToolsUsed:  uniq(toolsUsed),
				SkillsUsed: uniq(skillsUsed),
				Trace:      trace,
			}, nil
		}

		usedTool = true
		messages = append(messages, llm.ChatMessage{
			Role:      "assistant",
			Content:   res.Content,
			ToolCalls: res.ToolCalls,
		})
		for _, tc := range res.ToolCalls {
			toolsUsed = append(toolsUsed, tc.Function.Name)
			trace = append(trace, fmt.Sprintf("cycle_%d_tool:%s", cycle, tc.Function.Name))
			if tc.Function.Name == "load_skill" {
				var args map[string]any
				_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
				if name, _ := args["name"].(string); name != "" {
					skillsUsed = append(skillsUsed, name)
				}
			}
			out := runTool(ctx, deps, tc)
			messages = append(messages, llm.ChatMessage{
				Role:       "tool",
				ToolCallID: tc.ID,
				Name:       tc.Function.Name,
				Content:    out,
			})
		}
	}

	return rt.synthesize(ctx, req, messages, MaxCycles, toolsUsed, skillsUsed, append(trace, "synthesize"))
}

func (rt *Runtime) buildSystemPrompt(pet types.PetInstance, channel, city string, skillBlocks []string) string {
	var b strings.Builder
	fmt.Fprintf(&b,
		"你是桌宠「%s」的微信 Agent（性格：%s）。\n"+
			"你不是只会闲聊的气泡回复器；你是带 tools / rules / skills / memory / cycle 的智能体。\n"+
			"默认城市：%s。频道：%s。\n\n",
		pet.Name, pet.Personality, city, channel,
	)
	b.WriteString(rt.Catalog.RulesPrompt(channel))
	b.WriteString("\n\n## Available Skills\n")
	b.WriteString(rt.Catalog.SkillsBrief())
	if len(skillBlocks) > 0 {
		b.WriteString("\n\n## Auto-matched Skills for this turn\n")
		b.WriteString(strings.Join(skillBlocks, "\n\n"))
	}
	b.WriteString("\n\n## Cycle Contract\n")
	b.WriteString("Observe → (load_skill?) → Tools? → Memory? → Final WeChat reply.\n")
	b.WriteString("最终回复必须是给主人看的中文口语，不要输出 JSON/工具参数。")
	return b.String()
}

func (rt *Runtime) synthesize(
	ctx context.Context,
	req Request,
	messages []llm.ChatMessage,
	cycles int,
	toolsUsed, skillsUsed, trace []string,
) (Result, error) {
	messages = append(messages, llm.ChatMessage{
		Role: "user",
		Content: fmt.Sprintf(
			"请根据以上 rules/skills/tools/memory 结果，用「%s」口吻写出最终微信回复（≤%d字，直接回复）。原问题：%s",
			req.Pet.Name, MaxReplyChars, req.Message,
		),
	})
	opts := llm.CompletionOpts{MaxTokens: 700, Timeout: 28 * time.Second, Temperature: 0.5}
	res, err := rt.LLM.ChatCompletionEx(ctx, req.LLM, messages, nil, "", opts)
	if err != nil {
		return Result{}, err
	}
	text := llm.CleanWechatReply(res.Content, MaxReplyChars)
	if text == "" {
		return Result{}, fmt.Errorf("未能整理出回复")
	}
	return Result{
		Text:       text,
		Cycles:     cycles,
		ToolsUsed:  uniq(toolsUsed),
		SkillsUsed: uniq(skillsUsed),
		Trace:      trace,
	}, nil
}

func (rt *Runtime) fallback(ctx context.Context, req Request, deps ToolDeps, city string, skills []string) (Result, error) {
	briefing := gatherBriefing(ctx, deps, city, req.Message)
	msgs := []map[string]string{
		{"role": "system", "content": rt.buildSystemPrompt(req.Pet, DefaultChannel, city, nil) + "\n你必须依据【检索资料】作答。"},
		{"role": "user", "content": fmt.Sprintf(
			"主人问：%s\n\n【检索资料】\n%s\n\n【记忆】\n%s\n\n请给出微信回复。",
			req.Message, briefing, rt.Memory.Snapshot(req.PeerID),
		)},
	}
	raw, err := rt.LLM.ChatCompletion(ctx, req.LLM, msgs, llm.CompletionOpts{MaxTokens: 700, Timeout: 28 * time.Second, Temperature: 0.5})
	if err != nil {
		return Result{}, err
	}
	text := llm.CleanWechatReply(raw, MaxReplyChars)
	return Result{
		Text:       text,
		Cycles:     1,
		ToolsUsed:  []string{"fallback_gather"},
		SkillsUsed: skills,
		Trace:      []string{"fallback"},
	}, nil
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

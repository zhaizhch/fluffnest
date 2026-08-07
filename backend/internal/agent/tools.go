package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/geo"
	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/news"
	"github.com/fluffnest/deskpet/backend/internal/docread"
	"github.com/fluffnest/deskpet/backend/internal/search"
	"github.com/fluffnest/deskpet/backend/internal/types"
	"github.com/fluffnest/deskpet/backend/internal/weather"
)

type ToolDeps struct {
	Search      *search.Service
	Weather     *weather.Service
	News        *news.Service
	Geo         *geo.Service
	Memory      *Memory
	Catalog     Catalog
	City        string
	PeerID      string
	Host        *HostBridge
	Pet         types.PetInstance
	LLM         *llm.Client
	LlmCfg      types.LlmSettings
	Attachments []types.ImAttachment
	MediaRoot   string
}

type toolHandler func(ctx context.Context, deps ToolDeps, args map[string]any) string

func toolSpecs() []llm.ToolSpec {
	return []llm.ToolSpec{
		fnTool("web_search", "国内+国外联邦搜索（搜狗微信/Bing国内 ∥ Bing国际/DDG/百科/Google News），结果合并。调用前会自动优化查询词；请把用户原话放进 query，不必自己翻译。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "用户原始问题或核心实体；工具会改写成国内+国外检索词"},
				"type":  map[string]any{"type": "string", "description": "web|news，news 会追加时效关键词"},
			},
			"required": []string{"query"},
		}),
		fnTool("get_weather", "查询城市天气。可查今日或未来几天（forTomorrow / dayOffset）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"city":         map[string]any{"type": "string", "description": "城市名，可空"},
				"forTomorrow":  map[string]any{"type": "boolean", "description": "true=明日预报"},
				"dayOffset":    map[string]any{"type": "integer", "description": "0=今天，1=明天，2=后天…优先于 forTomorrow"},
			},
		}),
		fnTool("get_news", "获取科技/娱乐头条。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"category": map[string]any{"type": "string", "description": "tech|entertainment|both"},
			},
		}),
		fnTool("get_local_time", "获取本机当前日期时间、星期与时区（安排提醒/说「今天」前调用）。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("calc", "安全计算简单算术表达式（+ - * / () % 与小数）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"expression": map[string]any{"type": "string", "description": "如 (120+30)*0.85"},
			},
			"required": []string{"expression"},
		}),
		fnTool("get_pet_status", "查看当前桌宠名称、性格、心情、能量、亲密度。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("memory_read", "读取长期记忆中的某个 key（全局或当前微信好友）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"key": map[string]any{"type": "string"},
			},
			"required": []string{"key"},
		}),
		fnTool("memory_write", "写入长期记忆（偏好、昵称、城市等）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"key":    map[string]any{"type": "string"},
				"value":  map[string]any{"type": "string"},
				"global": map[string]any{"type": "boolean", "description": "true=全局，false=仅当前好友"},
			},
			"required": []string{"key", "value"},
		}),
		fnTool("memory_delete", "删除一条记忆。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"key":    map[string]any{"type": "string"},
				"global": map[string]any{"type": "boolean"},
			},
			"required": []string{"key"},
		}),
		fnTool("memory_list", "按需列出记忆摘要（整库不在默认 context，需要时再调）。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("memory_search", "按需按关键词搜索记忆（key/value/session notes）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "关键词"},
			},
			"required": []string{"query"},
		}),
		fnTool("owner_dossier_get", "按需读取主人完整档案（默认 context 只有要点）。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("owner_dossier_update", "更新主人档案某一字段。section=identity|work|lifestyle|preferences|relationships|goals|boundaries|context。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"section": map[string]any{"type": "string"},
				"key":     map[string]any{"type": "string", "description": "如 nickname/home_city/tone"},
				"value":   map[string]any{"type": "string"},
			},
			"required": []string{"section", "key", "value"},
		}),
		fnTool("owner_dossier_note", "向主人档案追加一条自由笔记（稳定观察，非一次性闲聊）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"note": map[string]any{"type": "string"},
			},
			"required": []string{"note"},
		}),
		fnTool("self_dossier_get", "按需读取自我完整档案（默认 context 只有要点）。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("self_dossier_update", "更新自我档案字段。section=identity|capabilities|serviceStyle|masterFit。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"section": map[string]any{"type": "string"},
				"key":     map[string]any{"type": "string"},
				"value":   map[string]any{"type": "string"},
			},
			"required": []string{"section", "key", "value"},
		}),
		fnTool("self_dossier_log", "记录自我成长条目。kind=lesson|improvement|note。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"kind": map[string]any{"type": "string", "description": "lesson|improvement|note"},
				"text": map[string]any{"type": "string"},
			},
			"required": []string{"kind", "text"},
		}),
		fnTool("load_skill", "加载一个专用 skill 工作流到上下文并按其 cycle 执行。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string", "description": "如 research / weather-care / companion / memory-keeper / owner-dossier / self-growth / scheduler / news-digest / entertainment / planner / clarify / lingua / documents"},
			},
			"required": []string{"name"},
		}),
		fnTool("list_skills", "列出可用 skills。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("reminder_list", "查看桌面喝水/久坐/会议提醒开关状态。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("reminder_set", "开启或调整喝水/久坐/会议提醒。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"kind":            map[string]any{"type": "string", "description": "water|stretch|meeting"},
				"intervalMinutes": map[string]any{"type": "integer", "description": "周期分钟，water/stretch 用"},
				"title":           map[string]any{"type": "string"},
				"at":              map[string]any{"type": "string", "description": "会议 RFC3339 时间"},
			},
			"required": []string{"kind"},
		}),
		fnTool("reminder_cancel", "关闭喝水/久坐提醒，或按 id 关闭会议提醒。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"kind": map[string]any{"type": "string", "description": "water|stretch"},
				"id":   map[string]any{"type": "string"},
			},
		}),
		fnTool("schedule_list", "列出用户自定义定时推送任务（天气/新闻简报等到微信）。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("schedule_upsert", "创建或更新定时推送。例：每天 20:00 发明日天气到微信；每天 09:00 发过去 24h 资讯简报。用户说「每天/每晚把天气发到微信」必须用本工具，不要用 reminder_set。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":             map[string]any{"type": "string"},
				"title":          map[string]any{"type": "string"},
				"kind":           map[string]any{"type": "string", "description": "weather_forecast|news_brief|custom_prompt"},
				"channel":        map[string]any{"type": "string", "description": "wechat|pet，默认 wechat"},
				"hour":           map[string]any{"type": "integer", "description": "本地小时 0-23"},
				"minute":         map[string]any{"type": "integer", "description": "本地分钟 0-59"},
				"city":           map[string]any{"type": "string", "description": "城市，多个用逗号分隔，如 北京,天津,南皮"},
				"cities":         map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "多城市数组，优先于 city"},
				"forTomorrow":    map[string]any{"type": "boolean"},
				"lookbackHours":  map[string]any{"type": "integer"},
				"prompt":         map[string]any{"type": "string", "description": "custom_prompt 说明"},
				"daysOfWeek":     map[string]any{"type": "array", "items": map[string]any{"type": "integer"}},
			},
			"required": []string{"kind", "hour"},
		}),
		fnTool("schedule_cancel", "关闭或删除定时推送（按 id 或标题关键词）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":    map[string]any{"type": "string"},
				"query": map[string]any{"type": "string", "description": "标题或类型关键词"},
			},
		}),
		fnTool("pet_notify", "让桌宠立刻冒气泡说话（同步到 macOS 桌面窗）。用于「让桌宠念一下/弹个泡」或短确认。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"text":     map[string]any{"type": "string", "description": "气泡文案，宜短（≤80字）"},
				"behavior": map[string]any{"type": "string", "description": "可选动作：wave|cheer|think|phone|magic|react"},
				"kind":     map[string]any{"type": "string", "description": "默认 agent；也可用 joke|chat"},
			},
			"required": []string{"text"},
		}),
		fnTool("rewrite_text", "翻译 / 摘要 / 说人话改写长文本（专用短提示，结果更稳）。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"mode":       map[string]any{"type": "string", "description": "translate|summarize|simplify"},
				"text":       map[string]any{"type": "string", "description": "待处理正文"},
				"targetLang": map[string]any{"type": "string", "description": "translate 目标语言，如 zh/en/ja"},
			},
			"required": []string{"mode", "text"},
		}),
		fnTool("read_document", "读取本轮微信附件或 wechat-media 中的文档并抽取文本（pdf/docx/txt/md）。收到文件后必须先调用再回答。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"path":  map[string]any{"type": "string", "description": "附件绝对路径；可空则读第一个附件"},
				"index": map[string]any{"type": "integer", "description": "附件索引，从 0 起；path 优先"},
			},
		}),
	}
}

func fnTool(name, desc string, params map[string]any) llm.ToolSpec {
	return llm.ToolSpec{
		Type: "function",
		Function: llm.ToolFunction{
			Name:        name,
			Description: desc,
			Parameters:  params,
		},
	}
}

func runTool(ctx context.Context, deps ToolDeps, tc llm.ToolCall) string {
	var args map[string]any
	_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
	if args == nil {
		args = map[string]any{}
	}
	handlers := map[string]toolHandler{
		"web_search":       toolWebSearch,
		"get_weather":      toolWeather,
		"get_news":         toolNews,
		"get_local_time":   toolLocalTime,
		"calc":             toolCalc,
		"get_pet_status":   toolPetStatus,
		"memory_read":      toolMemoryRead,
		"memory_write":     toolMemoryWrite,
		"memory_delete":    toolMemoryDelete,
		"memory_list":      toolMemoryList,
		"memory_search":       toolMemorySearch,
		"owner_dossier_get":   toolOwnerDossierGet,
		"owner_dossier_update": toolOwnerDossierUpdate,
		"owner_dossier_note":  toolOwnerDossierNote,
		"self_dossier_get":    toolSelfDossierGet,
		"self_dossier_update": toolSelfDossierUpdate,
		"self_dossier_log":    toolSelfDossierLog,
		"load_skill":          toolLoadSkill,
		"list_skills":      toolListSkills,
		"reminder_list":    toolReminderList,
		"reminder_set":     toolReminderSet,
		"reminder_cancel":  toolReminderCancel,
		"schedule_list":    toolScheduleList,
		"schedule_upsert":  toolScheduleUpsert,
		"schedule_cancel":  toolScheduleCancel,
		"pet_notify":       toolPetNotify,
		"rewrite_text":     toolRewriteText,
		"read_document":    toolReadDocument,
	}
	h, ok := handlers[tc.Function.Name]
	if !ok {
		return "未知工具：" + tc.Function.Name
	}
	return h(ctx, deps, args)
}

func toolWebSearch(ctx context.Context, deps ToolDeps, args map[string]any) string {
	q, _ := args["query"].(string)
	q = strings.TrimSpace(q)
	if q == "" {
		return "错误：query 为空"
	}
	if deps.Search == nil {
		return "错误：搜索服务未就绪"
	}
	kind, _ := args["type"].(string)
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind == "" && searchLooksNews(q) {
		kind = "news"
	}

	optimized := rewriteSearchQuery(ctx, deps, q, kind)
	kind = optimized.Kind
	hits, err := deps.Search.SearchOpt(ctx, q, search.Options{
		Limit:       8,
		Type:        kind,
		CNQueries:   optimized.CN,
		IntlQueries: optimized.Intl,
	})
	if err != nil {
		return "搜索失败：" + err.Error() +
			"\n优化后国内：" + strings.Join(optimized.CN, " · ") +
			"\n优化后国外：" + strings.Join(optimized.Intl, " · ")
	}
	note := "\n（查询优化：国内「" + strings.Join(optimized.CN, " · ") +
		"」∥ 国外「" + strings.Join(optimized.Intl, " · ") + "」）"
	return "搜索「" + q + "」" + note + "：\n" + search.FormatHits(hits)
}

// rewriteSearchQuery optimizes the raw user question before fanout.
// Heuristic always; optional short LLM polish when configured.
func rewriteSearchQuery(ctx context.Context, deps ToolDeps, raw, kind string) search.OptimizedQuery {
	base := search.OptimizeQuery(raw, kind)
	if deps.LLM == nil {
		return base
	}
	cfg := deps.LlmCfg
	if strings.TrimSpace(cfg.APIKey) == "" && strings.TrimSpace(cfg.APIBase) == "" {
		return base
	}

	ctx2, cancel := context.WithTimeout(ctx, 3500*time.Millisecond)
	defer cancel()
	prompt := "你是搜索查询优化器。把用户问题改写成便于检索的关键词。\n" +
		"只输出 JSON（不要 markdown）：{\"cn\":[\"中文词1\",\"中文词2\"],\"intl\":[\"English or Japanese 1\",\"...\"],\"type\":\"news|web\"}\n" +
		"规则：cn 给国内引擎，intl 给国外引擎；去掉口语废话；新闻/成绩类 type=news；最多各 3 条。\n" +
		"用户问题：" + raw
	opts := llm.CompletionOpts{MaxTokens: 140, Timeout: 3 * time.Second, Temperature: 0.2}
	out, err := deps.LLM.ChatCompletion(ctx2, cfg, []map[string]string{
		{"role": "system", "content": "Output JSON only."},
		{"role": "user", "content": prompt},
	}, opts)
	if err != nil || strings.TrimSpace(out) == "" {
		return base
	}
	parsed := parseOptimizedJSON(out)
	if len(parsed.CN) == 0 && len(parsed.Intl) == 0 {
		return base
	}
	if parsed.Kind == "news" || parsed.Kind == "web" {
		base.Kind = parsed.Kind
	}
	if len(parsed.CN) > 0 {
		base.CN = mergeUniqueQueries(parsed.CN, base.CN, 4)
	}
	if len(parsed.Intl) > 0 {
		base.Intl = mergeUniqueQueries(parsed.Intl, base.Intl, 4)
	}
	base.Note = "启发式+LLM 优化"
	return base
}

func parseOptimizedJSON(raw string) search.OptimizedQuery {
	raw = strings.TrimSpace(raw)
	if i := strings.Index(raw, "{"); i >= 0 {
		if j := strings.LastIndex(raw, "}"); j > i {
			raw = raw[i : j+1]
		}
	}
	var obj struct {
		CN   []string `json:"cn"`
		Intl []string `json:"intl"`
		Type string   `json:"type"`
	}
	if json.Unmarshal([]byte(raw), &obj) != nil {
		return search.OptimizedQuery{}
	}
	return search.OptimizedQuery{CN: obj.CN, Intl: obj.Intl, Kind: strings.ToLower(strings.TrimSpace(obj.Type))}
}

func mergeUniqueQueries(primary, fallback []string, limit int) []string {
	seen := map[string]bool{}
	var out []string
	add := func(xs []string) {
		for _, s := range xs {
			s = strings.TrimSpace(s)
			if s == "" || seen[strings.ToLower(s)] {
				continue
			}
			seen[strings.ToLower(s)] = true
			out = append(out, s)
			if len(out) >= limit {
				return
			}
		}
	}
	add(primary)
	add(fallback)
	return out
}

func searchLooksNews(q string) bool {
	keys := []string{
		"最新", "新料", "更新", "补丁", "版本", "新闻", "热点", "冠军", "成绩", "结果",
		"区间赏", "区間賞", "名单", "选手",
		"latest", "update", "patch", "news", "release", "results", "winner", "champion",
	}
	low := strings.ToLower(q)
	for _, k := range keys {
		if strings.Contains(low, strings.ToLower(k)) || strings.Contains(q, k) {
			return true
		}
	}
	return false
}

func toolWeather(ctx context.Context, deps ToolDeps, args map[string]any) string {
	city, _ := args["city"].(string)
	city = strings.TrimSpace(city)
	if city == "" && deps.Memory != nil {
		if v, ok := deps.Memory.Read(deps.PeerID, "home_city"); ok {
			city = v
		}
	}
	if city == "" {
		city = deps.City
	}
	if city == "" {
		city = "北京"
	}
	if deps.Weather == nil {
		return "错误：天气服务未就绪"
	}
	forTomorrow, _ := args["forTomorrow"].(bool)
	dayOffset := 0
	switch v := args["dayOffset"].(type) {
	case float64:
		dayOffset = int(v)
	case int:
		dayOffset = v
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			dayOffset = n
		}
	}
	offset := weather.DayOffset(forTomorrow, dayOffset)
	text, err := deps.Weather.SummaryDay(ctx, city, offset)
	if err != nil {
		return "天气查询失败：" + err.Error()
	}
	return "天气（" + city + "）：\n" + text
}

func toolLocalTime(_ context.Context, _ ToolDeps, _ map[string]any) string {
	now := time.Now()
	weekday := [...]string{"日", "一", "二", "三", "四", "五", "六"}[now.Weekday()]
	name, offset := now.Zone()
	return fmt.Sprintf(
		"本地时间：%s\n星期%s\n时区：%s (UTC%+d)",
		now.Format("2006-01-02 15:04:05"),
		weekday,
		name,
		offset/3600,
	)
}

func toolCalc(_ context.Context, _ ToolDeps, args map[string]any) string {
	expr, _ := args["expression"].(string)
	expr = strings.TrimSpace(expr)
	if expr == "" {
		return "错误：expression 为空"
	}
	v, err := evalArithmetic(expr)
	if err != nil {
		return "计算失败：" + err.Error()
	}
	if v == float64(int64(v)) {
		return fmt.Sprintf("%s = %d", expr, int64(v))
	}
	return fmt.Sprintf("%s = %g", expr, v)
}

func toolPetStatus(_ context.Context, deps ToolDeps, _ map[string]any) string {
	p := deps.Pet
	if strings.TrimSpace(p.Name) == "" && strings.TrimSpace(p.ID) == "" {
		return "当前没有桌宠状态信息"
	}
	persona := p.Personality
	if note := strings.TrimSpace(p.PersonalityNote); note != "" {
		persona = persona + "（备注：" + note + "）"
	}
	return fmt.Sprintf(
		"桌宠：%s\n物种：%s\n性格：%s\n心情：%d · 能量：%d · 亲密度：%d",
		p.Name, p.SpeciesID, persona, p.Mood, p.Energy, p.Bond,
	)
}

func toolMemorySearch(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	q, _ := args["query"].(string)
	hits := deps.Memory.Search(deps.PeerID, q, 8)
	if len(hits) == 0 {
		return "未找到与「" + strings.TrimSpace(q) + "」相关的记忆"
	}
	return "记忆搜索结果：\n- " + strings.Join(hits, "\n- ")
}

// evalArithmetic evaluates a restricted + - * / % and parentheses expression.
func evalArithmetic(expr string) (float64, error) {
	p := &arithParser{s: expr}
	v, err := p.parseExpr()
	if err != nil {
		return 0, err
	}
	p.skipSpace()
	if p.pos < len(p.s) {
		return 0, fmt.Errorf("多余字符 %q", p.s[p.pos:])
	}
	return v, nil
}

type arithParser struct {
	s   string
	pos int
}

func (p *arithParser) skipSpace() {
	for p.pos < len(p.s) {
		switch p.s[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

func (p *arithParser) parseExpr() (float64, error) {
	v, err := p.parseTerm()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.s) {
			return v, nil
		}
		op := p.s[p.pos]
		if op != '+' && op != '-' {
			return v, nil
		}
		p.pos++
		r, err := p.parseTerm()
		if err != nil {
			return 0, err
		}
		if op == '+' {
			v += r
		} else {
			v -= r
		}
	}
}

func (p *arithParser) parseTerm() (float64, error) {
	v, err := p.parseFactor()
	if err != nil {
		return 0, err
	}
	for {
		p.skipSpace()
		if p.pos >= len(p.s) {
			return v, nil
		}
		op := p.s[p.pos]
		if op != '*' && op != '/' && op != '%' {
			return v, nil
		}
		p.pos++
		r, err := p.parseFactor()
		if err != nil {
			return 0, err
		}
		switch op {
		case '*':
			v *= r
		case '/':
			if r == 0 {
				return 0, fmt.Errorf("除以零")
			}
			v /= r
		case '%':
			if r == 0 {
				return 0, fmt.Errorf("对零取模")
			}
			v = float64(int64(v) % int64(r))
		}
	}
}

func (p *arithParser) parseFactor() (float64, error) {
	p.skipSpace()
	if p.pos >= len(p.s) {
		return 0, fmt.Errorf("表达式不完整")
	}
	if p.s[p.pos] == '+' {
		p.pos++
		return p.parseFactor()
	}
	if p.s[p.pos] == '-' {
		p.pos++
		v, err := p.parseFactor()
		return -v, err
	}
	if p.s[p.pos] == '(' {
		p.pos++
		v, err := p.parseExpr()
		if err != nil {
			return 0, err
		}
		p.skipSpace()
		if p.pos >= len(p.s) || p.s[p.pos] != ')' {
			return 0, fmt.Errorf("缺少 )")
		}
		p.pos++
		return v, nil
	}
	start := p.pos
	for p.pos < len(p.s) {
		c := p.s[p.pos]
		if (c >= '0' && c <= '9') || c == '.' {
			p.pos++
			continue
		}
		break
	}
	if start == p.pos {
		return 0, fmt.Errorf("非法字符 %q", p.s[p.pos:])
	}
	return strconv.ParseFloat(p.s[start:p.pos], 64)
}

func toolNews(ctx context.Context, deps ToolDeps, args map[string]any) string {
	cat, _ := args["category"].(string)
	if strings.TrimSpace(cat) == "" {
		cat = "both"
	}
	if deps.News == nil {
		return "错误：新闻服务未就绪"
	}
	loc := geo.Location{City: deps.City, CountryCode: "CN", Source: "default"}
	if deps.Geo != nil {
		if resolved := deps.Geo.Resolve(ctx, deps.City); resolved.City != "" {
			loc = resolved
		}
	}
	items, err := deps.News.FetchHeadlines(ctx, cat, 5, false, loc)
	if err != nil {
		return "新闻获取失败：" + err.Error()
	}
	return "新闻头条：\n" + news.FormatHeadlines(items)
}

func toolMemoryRead(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	key, _ := args["key"].(string)
	v, ok := deps.Memory.Read(deps.PeerID, key)
	if !ok {
		return "未找到 key=" + key
	}
	return fmt.Sprintf("%s = %s", key, v)
}

func toolMemoryWrite(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	key, _ := args["key"].(string)
	value, _ := args["value"].(string)
	global, _ := args["global"].(bool)
	if err := deps.Memory.Write(deps.PeerID, key, value, "agent", global); err != nil {
		return "写入失败：" + err.Error()
	}
	scope := "peer"
	if global || deps.PeerID == "" {
		scope = "global"
	}
	return fmt.Sprintf("已记住[%s] %s = %s", scope, key, value)
}

func toolMemoryDelete(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	key, _ := args["key"].(string)
	global, _ := args["global"].(bool)
	if err := deps.Memory.Delete(deps.PeerID, key, global); err != nil {
		return "删除失败：" + err.Error()
	}
	return "已删除 " + key
}

func toolMemoryList(_ context.Context, deps ToolDeps, _ map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	return deps.Memory.Snapshot(deps.PeerID) + "\n\n" +
		deps.Memory.DossierBrief(deps.PeerID) +
		"\n（完整档案请用 owner_dossier_get / self_dossier_get）"
}

func toolOwnerDossierGet(_ context.Context, deps ToolDeps, _ map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	return FormatOwnerDossier(deps.Memory.OwnerGet(deps.PeerID))
}

func toolOwnerDossierUpdate(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	section, _ := args["section"].(string)
	key, _ := args["key"].(string)
	value, _ := args["value"].(string)
	if err := deps.Memory.OwnerUpdateField(deps.PeerID, section, key, value); err != nil {
		return "更新失败：" + err.Error()
	}
	return fmt.Sprintf("已写入主人档案 %s.%s = %s", strings.TrimSpace(section), strings.TrimSpace(key), truncateRunes(strings.TrimSpace(value), 80))
}

func toolOwnerDossierNote(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	note, _ := args["note"].(string)
	if err := deps.Memory.OwnerAppendNote(deps.PeerID, note); err != nil {
		return "记录失败：" + err.Error()
	}
	return "已追加主人笔记：" + truncateRunes(strings.TrimSpace(note), 80)
}

func toolSelfDossierGet(_ context.Context, deps ToolDeps, _ map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	return FormatSelfDossier(deps.Memory.SelfGet())
}

func toolSelfDossierUpdate(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	section, _ := args["section"].(string)
	key, _ := args["key"].(string)
	value, _ := args["value"].(string)
	if err := deps.Memory.SelfUpdateField(section, key, value); err != nil {
		return "更新失败：" + err.Error()
	}
	return fmt.Sprintf("已写入自我档案 %s.%s = %s", strings.TrimSpace(section), strings.TrimSpace(key), truncateRunes(strings.TrimSpace(value), 80))
}

func toolSelfDossierLog(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Memory == nil {
		return "错误：memory 未就绪"
	}
	kind, _ := args["kind"].(string)
	text, _ := args["text"].(string)
	if err := deps.Memory.SelfAppend(kind, text); err != nil {
		return "记录失败：" + err.Error()
	}
	return fmt.Sprintf("已记录自我%s：%s", strings.TrimSpace(kind), truncateRunes(strings.TrimSpace(text), 80))
}

func toolLoadSkill(_ context.Context, deps ToolDeps, args map[string]any) string {
	name, _ := args["name"].(string)
	sk, ok := deps.Catalog.FindSkill(name)
	if !ok {
		return "未找到 skill：" + name + "\n可用：\n" + deps.Catalog.SkillsBrief()
	}
	return fmt.Sprintf("## Loaded Skill: %s\n%s\n\n%s", sk.Name, sk.Description, sk.Body)
}

func toolListSkills(_ context.Context, deps ToolDeps, _ map[string]any) string {
	return deps.Catalog.SkillsBrief()
}

func toolReminderList(_ context.Context, deps ToolDeps, _ map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接，无法读取提醒"
	}
	return "当前提醒状态：\n" + deps.Host.Snapshot.ReminderSummary + "\n详情：" + deps.Host.ListRemindersJSON()
}

func toolReminderSet(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接"
	}
	kind, _ := args["kind"].(string)
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return "需要 kind=water|stretch|meeting"
	}
	deps.Host.Add("reminder.set", args)
	return fmt.Sprintf("已排队开启提醒 kind=%s（桌面会立即生效）", kind)
}

func toolReminderCancel(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接"
	}
	kind, _ := args["kind"].(string)
	id, _ := args["id"].(string)
	if strings.TrimSpace(kind) == "" && strings.TrimSpace(id) == "" {
		return "需要 kind 或 id"
	}
	deps.Host.Add("reminder.cancel", args)
	return "已排队关闭提醒（桌面会立即生效）"
}

func toolScheduleList(_ context.Context, deps ToolDeps, _ map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接"
	}
	text := deps.Host.SnapshotText()
	return text + "\n详情：" + deps.Host.ListSchedulesJSON()
}

func toolScheduleUpsert(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接"
	}
	kind, _ := args["kind"].(string)
	if strings.TrimSpace(kind) == "" {
		return "需要 kind=weather_forecast|news_brief|custom_prompt"
	}
	if _, ok := args["channel"]; !ok {
		args["channel"] = "wechat"
	}
	if _, ok := args["minute"]; !ok {
		args["minute"] = 0
	}
	deps.Host.Add("schedule.upsert", args)
	hour, _ := args["hour"].(float64)
	minute, _ := args["minute"].(float64)
	title, _ := args["title"].(string)
	if title == "" {
		title = kind
	}
	return fmt.Sprintf("已排队设定时「%s」每天 %02d:%02d（桌面会立即生效）", title, int(hour), int(minute))
}

func toolScheduleCancel(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接"
	}
	id, _ := args["id"].(string)
	query, _ := args["query"].(string)
	if strings.TrimSpace(id) == "" && strings.TrimSpace(query) == "" {
		return "需要 id 或 query"
	}
	deps.Host.Add("schedule.cancel", args)
	return "已排队取消定时任务（桌面会立即生效）"
}

func toolPetNotify(_ context.Context, deps ToolDeps, args map[string]any) string {
	if deps.Host == nil {
		return "桌面主机未连接，无法冒泡"
	}
	text, _ := args["text"].(string)
	text = strings.TrimSpace(text)
	if text == "" {
		return "需要 text"
	}
	if r := []rune(text); len(r) > 120 {
		text = string(r[:117]) + "…"
		args["text"] = text
	}
	if _, ok := args["kind"]; !ok {
		args["kind"] = "agent"
	}
	if _, ok := args["behavior"]; !ok {
		args["behavior"] = "wave"
	}
	deps.Host.Add("pet.notify", args)
	return "已排队让桌宠冒泡：「" + text + "」"
}

func toolRewriteText(ctx context.Context, deps ToolDeps, args map[string]any) string {
	mode, _ := args["mode"].(string)
	text, _ := args["text"].(string)
	mode = strings.ToLower(strings.TrimSpace(mode))
	text = strings.TrimSpace(text)
	if text == "" {
		return "错误：text 为空"
	}
	if deps.LLM == nil {
		return "错误：LLM 未就绪"
	}
	target, _ := args["targetLang"].(string)
	target = strings.TrimSpace(target)
	if target == "" {
		target = "zh"
	}
	var sys, user string
	switch mode {
	case "translate":
		sys = "你是精准翻译器。只输出译文，不要解释，不要加引号。"
		user = fmt.Sprintf("请将下文翻译成「%s」：\n\n%s", target, truncateRunes(text, 3500))
	case "summarize":
		sys = "你是摘要助手。用简洁中文要点概括，3–6 条或一段短文，不要开场白。"
		user = "请摘要：\n\n" + truncateRunes(text, 3500)
	case "simplify":
		sys = "你把专业/绕口内容改成口语「说人话」。保留关键信息，短句，不要卖萌。"
		user = "请改写：\n\n" + truncateRunes(text, 3500)
	default:
		return "mode 须为 translate|summarize|simplify"
	}
	msgs := []llm.ChatMessage{
		{Role: "system", Content: sys},
		{Role: "user", Content: user},
	}
	opts := llm.CompletionOpts{MaxTokens: 400, Timeout: 14 * time.Second, Temperature: 0.3}
	res, err := deps.LLM.ChatCompletionEx(ctx, deps.LlmCfg, msgs, nil, "", opts)
	if err != nil {
		return "改写失败：" + err.Error()
	}
	out := strings.TrimSpace(res.Content)
	if out == "" {
		return "改写失败：空结果"
	}
	return out
}

func toolReadDocument(_ context.Context, deps ToolDeps, args map[string]any) string {
	path, _ := args["path"].(string)
	path = strings.TrimSpace(path)
	if path == "" {
		idx := 0
		switch v := args["index"].(type) {
		case float64:
			idx = int(v)
		case int:
			idx = v
		}
		if len(deps.Attachments) == 0 {
			return "错误：本轮没有附件。请让用户通过微信发送 PDF/Word/txt/md 文件。"
		}
		if idx < 0 || idx >= len(deps.Attachments) {
			return fmt.Sprintf("错误：附件索引 %d 越界（共 %d 个）", idx, len(deps.Attachments))
		}
		path = deps.Attachments[idx].Path
	}
	allowed := make([]string, 0, len(deps.Attachments))
	for _, a := range deps.Attachments {
		if strings.TrimSpace(a.Path) != "" {
			allowed = append(allowed, a.Path)
		}
	}
	if err := docread.AllowPath(path, allowed, deps.MediaRoot); err != nil {
		return "错误：" + err.Error()
	}
	res, err := docread.Extract(path, docread.DefaultMaxRunes)
	if err != nil {
		return "读取失败：" + err.Error()
	}
	return docread.FormatResult(res)
}


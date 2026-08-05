package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fluffnest/deskpet/backend/internal/geo"
	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/news"
	"github.com/fluffnest/deskpet/backend/internal/search"
	"github.com/fluffnest/deskpet/backend/internal/weather"
)

type ToolDeps struct {
	Search  *search.Service
	Weather *weather.Service
	News    *news.Service
	Geo     *geo.Service
	Memory  *Memory
	Catalog Catalog
	City    string
	PeerID  string
	Host    *HostBridge
}

type toolHandler func(ctx context.Context, deps ToolDeps, args map[string]any) string

func toolSpecs() []llm.ToolSpec {
	return []llm.ToolSpec{
		fnTool("web_search", "搜索互联网（百科/新闻/事实）。需要外部依据时必须调用。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "搜索词"},
			},
			"required": []string{"query"},
		}),
		fnTool("get_weather", "查询城市实时天气。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"city": map[string]any{"type": "string", "description": "城市名，可空"},
			},
		}),
		fnTool("get_news", "获取科技/娱乐头条。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"category": map[string]any{"type": "string", "description": "tech|entertainment|both"},
			},
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
		fnTool("memory_list", "列出当前可见记忆摘要。", map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		}),
		fnTool("load_skill", "加载一个专用 skill 工作流到上下文并按其 cycle 执行。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{"type": "string", "description": "skill 名，如 research / weather-care / companion / memory-keeper"},
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
		fnTool("schedule_upsert", "创建或更新定时推送。例：每天 20:00 发明日天气到微信；每天 09:00 发过去 24h 资讯简报。", map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":             map[string]any{"type": "string"},
				"title":          map[string]any{"type": "string"},
				"kind":           map[string]any{"type": "string", "description": "weather_forecast|news_brief|custom_prompt"},
				"channel":        map[string]any{"type": "string", "description": "wechat|pet，默认 wechat"},
				"hour":           map[string]any{"type": "integer", "description": "本地小时 0-23"},
				"minute":         map[string]any{"type": "integer", "description": "本地分钟 0-59"},
				"city":           map[string]any{"type": "string"},
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
		"memory_read":      toolMemoryRead,
		"memory_write":     toolMemoryWrite,
		"memory_delete":    toolMemoryDelete,
		"memory_list":      toolMemoryList,
		"load_skill":       toolLoadSkill,
		"list_skills":      toolListSkills,
		"reminder_list":    toolReminderList,
		"reminder_set":     toolReminderSet,
		"reminder_cancel":  toolReminderCancel,
		"schedule_list":    toolScheduleList,
		"schedule_upsert":  toolScheduleUpsert,
		"schedule_cancel":  toolScheduleCancel,
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
	hits, err := deps.Search.Search(ctx, q, 6)
	if err != nil {
		return "搜索失败：" + err.Error()
	}
	return "搜索「" + q + "」：\n" + search.FormatHits(hits)
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
	text, err := deps.Weather.Summary(ctx, city)
	if err != nil {
		return "天气查询失败：" + err.Error()
	}
	return "天气（" + city + "）：\n" + text
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
	return deps.Memory.Snapshot(deps.PeerID)
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


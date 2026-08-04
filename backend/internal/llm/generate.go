package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/fluffnest/deskpet/backend/internal/types"
)

func personalityBlurb(p string) string {
	switch p {
	case "calm":
		return "性格安静温柔，话不多，像轻轻陪伴；语气平和、克制，偶尔会关心主人。"
	case "lively":
		return "性格活泼开朗，爱开玩笑和用轻快语气词；容易兴奋，喜欢逗主人开心。"
	case "clingy":
		return "性格黏人撒娇，很依赖主人；会求贴贴、吃醋式关心，语气软软的。"
	default:
		return "性格温和，像一只软软的桌面小伙伴。"
	}
}

func BondLabel(bond int) string {
	switch {
	case bond >= 220:
		return "心灵相通"
	case bond >= 120:
		return "挚友"
	case bond >= 60:
		return "好友"
	case bond >= 20:
		return "熟悉"
	default:
		return "初识"
	}
}

func SystemPrompt(pet types.PetInstance) string {
	return fmt.Sprintf(
		"你是 macOS 桌面宠物「%s」。\n"+
			"- 性格标签：%s\n"+
			"- 性格表现：%s\n"+
			"- 与主人关系：%s（亲密度 %d）\n"+
			"- 当前心情 %d/100。\n"+
			"规则：\n"+
			"1. 始终用第一人称，以宠物口吻对主人说话（可叫「主人」）。\n"+
			"2. 每一句都必须鲜明体现上述性格，不要变成通用助手腔。\n"+
			"3. 默认中文；不要 markdown、不要列表、不要解释设定。\n"+
			"4. 气泡台词要短；聊天回复也要简洁。\n"+
			"5. 禁止深度思考、推理过程、分析步骤；不要输出 <think> 等内容，立刻直接给出最终台词。\n"+
			"6. 不讨论政治敏感与成人内容；新闻吐槽保持轻松无害。\n"+
			"7. 今日运势是轻松娱乐向，可温暖鼓励，不要吓人、不要宿命论恐吓。",
		pet.Name, pet.Personality, personalityBlurb(pet.Personality),
		BondLabel(pet.Bond), pet.Bond, pet.Mood,
	)
}

func msg(role, content string) map[string]string {
	return map[string]string{"role": role, "content": content}
}

func (c *Client) GenerateBubble(ctx context.Context, llm types.LlmSettings, pet types.PetInstance, kind, action string, extra *string) (string, error) {
	extraVal := action
	if extra != nil && *extra != "" {
		extraVal = *extra
	}
	var task string
	switch kind {
	case "click", "interact":
		task = fmt.Sprintf("主人刚刚对你做了「%s」。请按你的性格说一句很短的反应（不超过 28 字）。只输出这一句，必须能听出是「%s」性格。", action, pet.Personality)
	case "idle":
		task = fmt.Sprintf("你正在自己玩「%s」。偶尔轻声嘀咕一句很短的话（不超过 24 字），贴合「%s」性格。只输出这一句。", action, pet.Personality)
	case "reminder":
		task = fmt.Sprintf("到了提醒时间：%s。请用你的「%s」性格温柔提醒主人一句（不超过 30 字）。只输出这一句。口语化，适合朗读。", action, pet.Personality)
	case "care_voice":
		task = fmt.Sprintf("你正在边跳舞边提醒主人「%s」。请用「%s」性格说一句很口语、适合朗读的提醒（不超过 26 字）。可撒娇/俏皮/温柔，不要像播报。只输出这一句。", action, pet.Personality)
	case "weather":
		task = fmt.Sprintf("根据天气信息，用「%s」性格说一句关心主人的话（不超过 32 字）。天气：%s\n只输出这一句。", pet.Personality, extraVal)
	case "joke":
		task = fmt.Sprintf("用「%s」性格讲一句适合桌宠说的冷笑话或小俏皮话（不超过 32 字）。只输出笑话本身。", pet.Personality)
	case "news":
		task = fmt.Sprintf("下面是一条科技或娱乐圈新闻（国内外都有可能）。用「%s」性格缩成一句轻松吐槽（不超过 32 字，不要吓人、不要政治）：\n%s\n只输出这一句。", pet.Personality, extraVal)
	case "fortune_teaser":
		task = fmt.Sprintf("你刚给主人讲完今日运势。用「%s」性格再补一句很短的鼓励或俏皮收尾（不超过 28 字）。只输出这一句。", pet.Personality)
	default:
		task = fmt.Sprintf("用「%s」性格说一句很短的话（不超过 28 字），情境：%s。只输出这一句。", pet.Personality, action)
	}
	raw, err := c.ChatCompletion(ctx, llm, []map[string]string{
		msg("system", SystemPrompt(pet)),
		msg("user", task+"\n（直接输出最终一句话，不要思考过程）"),
	}, BubbleOpts())
	if err != nil {
		return "", err
	}
	return CleanLine(raw, MaxBubbleChars), nil
}

func (c *Client) GenerateChat(ctx context.Context, llm types.LlmSettings, pet types.PetInstance, history []types.ChatMessage, userMessage string) (string, error) {
	messages := []map[string]string{
		msg("system", fmt.Sprintf("%s\n聊天时回复不超过 %d 字，像桌宠在气泡/面板里说话，可分两句但保持口语。", SystemPrompt(pet), MaxChatChars)),
	}
	start := 0
	if len(history) > 12 {
		start = len(history) - 12
	}
	for _, m := range history[start:] {
		role := "user"
		if m.Role == "assistant" {
			role = "assistant"
		}
		messages = append(messages, msg(role, m.Content))
	}
	messages = append(messages, msg("user", userMessage+"\n（直接回复，不要思考过程）"))
	raw, err := c.ChatCompletion(ctx, llm, messages, ChatOpts())
	if err != nil {
		return "", err
	}
	return CleanLine(raw, MaxChatChars), nil
}

func (c *Client) GenerateFortune(ctx context.Context, llm types.LlmSettings, pet types.PetInstance, dateLabel, weekday, city string, weather *string) (string, error) {
	if err := EnsureConfigured(llm); err != nil {
		return "", err
	}
	weatherLine := "天气未知，穿搭可给通用建议。"
	if weather != nil && strings.TrimSpace(*weather) != "" {
		weatherLine = "参考天气：" + *weather
	}
	var style string
	switch pet.Personality {
	case "lively":
		style = "活泼俏皮，像分享小八卦一样讲运势，可带轻快语气词"
	case "clingy":
		style = "软软撒娇，像黏着主人叮嘱今天要注意什么"
	case "calm":
		style = "温柔克制，像轻轻递上一杯茶时说的话"
	default:
		style = "温和口语，像桌面小伙伴陪主人看运势"
	}
	system := SystemPrompt(pet) + "\n补充（仅本任务）：允许分节与换行输出运势卡片正文；不要 markdown 的 # 标题或代码块。"
	user := fmt.Sprintf(
		"请以桌宠「%s」的口吻，为主人写一份「今日运势」详细分析。\n"+
			"日期：%s（%s），城市参考：%s。\n%s\n性格要求：鲜明体现「%s」——%s。\n\n"+
			"必须按下面结构输出纯文本（可用换行与「·」分隔，不要 markdown 标题符号 #，不要代码块）：\n"+
			"【今日运势 · 评级】（评级用 大吉/吉/中吉/平/小吉 之一）\n"+
			"综合指数：用 1～5 个★表示，其余用☆补齐\n\n"+
			"宜：列出 2～4 件今天适合做的事（学习/工作/社交/休息等，具体一点）\n"+
			"忌：列出 2～3 件今天不太适合做的事（温和提醒，不要恐吓）\n\n"+
			"穿搭建议：颜色、风格、单品或材质，可结合天气\n幸运色：……\n幸运数字：……\n\n"+
			"详细分析：用 3～5 句连贯口语，讲清整体运势、人际/效率/心情侧重点，并给一句鼓励收尾。\n\n"+
			"总字数约 220～420 字。第一人称。直接输出正文，不要思考过程。",
		pet.Name, dateLabel, weekday, city, weatherLine, pet.Personality, style,
	)
	raw, err := c.ChatCompletion(ctx, llm, []map[string]string{
		msg("system", system),
		msg("user", user),
	}, FortuneOpts())
	if err != nil {
		return "", err
	}
	text := CleanFortune(raw)
	if utf8.RuneCountInString(text) < 40 {
		return "", fmt.Errorf("运势内容太短，请稍后重试")
	}
	return text, nil
}

func (c *Client) GenerateCareVoice(ctx context.Context, llm types.LlmSettings, pet types.PetInstance, kind string, count int, avoid []string) ([]string, error) {
	if err := EnsureConfigured(llm); err != nil {
		return nil, err
	}
	if count < 4 {
		count = 4
	}
	if count > 12 {
		count = 12
	}
	topic := "该喝水了，补水休息一下"
	if kind == "stretch" {
		topic = "久坐太久，起来活动 / 伸懒腰 / 走动"
	}
	var style string
	switch pet.Personality {
	case "lively":
		style = "活泼跳脱，爱用轻快语气词，像边跳边喊主人"
	case "clingy":
		style = "黏人撒娇，软软的，求关注式提醒"
	case "calm":
		style = "温柔克制，轻声提醒，不催促"
	default:
		style = "温和口语"
	}
	avoidBlock := ""
	if len(avoid) > 0 {
		listed := avoid
		if len(listed) > 16 {
			listed = listed[len(listed)-16:]
		}
		var b strings.Builder
		b.WriteString("\n5. 严禁重复或改写下列已说过的句子（意思接近也不行）：\n")
		for _, s := range listed {
			b.WriteString("- ")
			b.WriteString(s)
			b.WriteByte('\n')
		}
		avoidBlock = b.String()
	}
	user := fmt.Sprintf(
		"你要边跳舞边连续提醒主人「%s」。\n请一口气写出 %d 句互不重复的口语台词，供语音朗读。\n要求：\n"+
			"1. 每句 8～24 个字，像真人随口说，不要播报腔、不要编号。\n"+
			"2. 鲜明体现「%s」性格：%s\n"+
			"3. 内容都围绕这个提醒主题，但每句角度/措辞必须不同（例如关心、撒娇、俏皮、比喻各用一次）。\n"+
			"4. 只输出 JSON 字符串数组，例如 [\"…\",\"…\"]，不要其它文字。%s\n（直接输出 JSON，不要思考过程）",
		topic, count, pet.Personality, style, avoidBlock,
	)
	raw, err := c.ChatCompletion(ctx, llm, []map[string]string{
		msg("system", SystemPrompt(pet)),
		msg("user", user),
	}, CareVoiceOpts())
	if err != nil {
		return nil, err
	}
	lines, err := parseLineList(raw, count)
	if err != nil {
		return nil, err
	}
	return filterFreshLines(lines, avoid), nil
}

func filterFreshLines(lines, avoid []string) []string {
	seen := make(map[string]struct{}, len(avoid)+len(lines))
	for _, s := range avoid {
		if k := NormalizeSpeechKey(s); k != "" {
			seen[k] = struct{}{}
		}
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		k := NormalizeSpeechKey(line)
		if k == "" {
			continue
		}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, line)
	}
	return out
}

func parseLineList(raw string, want int) ([]string, error) {
	trimmed := strings.TrimSpace(raw)
	jsonSlice := trimmed
	if a, b := strings.IndexByte(trimmed, '['), strings.LastIndexByte(trimmed, ']'); a >= 0 && b > a {
		jsonSlice = trimmed[a : b+1]
	}
	var arr []string
	if err := json.Unmarshal([]byte(jsonSlice), &arr); err == nil {
		lines := make([]string, 0, len(arr))
		for _, s := range arr {
			if line := CleanLine(s, 28); line != "" {
				lines = append(lines, line)
			}
		}
		if len(lines) > 0 {
			return lines, nil
		}
	}
	var lines []string
	for _, l := range strings.Split(trimmed, "\n") {
		l = strings.TrimLeft(l, "0123456789.-、）)】 ")
		line := CleanLine(l, 28)
		if utf8.RuneCountInString(line) >= 4 {
			lines = append(lines, line)
			if len(lines) >= want {
				break
			}
		}
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("未能解析提醒台词")
	}
	return lines, nil
}

// ProactiveBehavior maps kind → pet animation id.
func ProactiveBehavior(kind string) string {
	switch kind {
	case "weather":
		return "look"
	case "joke":
		return "cheer"
	case "news":
		return "wave"
	case "fortune":
		return "magic"
	case "reminder":
		return "react"
	default:
		return "wave"
	}
}

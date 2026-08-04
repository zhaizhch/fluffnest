package llm

import (
	"fmt"
	"strings"

	"github.com/fluffnest/deskpet/backend/internal/news"
	"github.com/fluffnest/deskpet/backend/internal/weather"
)

// QuickWeatherTip builds an instant personality tip from numeric weather (no LLM).
func QuickWeatherTip(personality string, snap weather.Snapshot) string {
	cond := snap.Condition
	temp := fmt.Sprintf("%.0f℃", snap.TempC)
	uvBit := ""
	if snap.HasUV {
		uvBit = fmt.Sprintf("，紫外线%s", snap.UVLevel)
	}
	protect := firstHint(snap.Hints)

	switch personality {
	case "lively":
		return fmt.Sprintf("外面%s、%s%s诶！%s走起～", cond, temp, uvBit, protect)
	case "clingy":
		return fmt.Sprintf("主人～今天%s、%s%s，%s好不好嘛。", cond, temp, uvBit, protect)
	case "tsundere":
		return fmt.Sprintf("才、才不是特意提醒！今天%s、%s%s，%s……笨蛋。", cond, temp, uvBit, protect)
	case "clever":
		return fmt.Sprintf("速报：%s / %s%s。建议：%s。", cond, temp, uvBit, protect)
	case "calm":
		return fmt.Sprintf("今天%s，气温%s%s。%s，慢慢来。", cond, temp, uvBit, protect)
	default:
		return fmt.Sprintf("今天%s，%s%s。%s", cond, temp, uvBit, protect)
	}
}

// QuickNewsTip picks one headline and roasts it with personality (no LLM).
func QuickNewsTip(personality string, items []news.Headline) string {
	if len(items) == 0 {
		return "暂时没刷到新鲜事，待会再翻翻～"
	}
	h := items[0]
	title := truncateRunes(h.Title, 18)
	tag := h.Category
	if h.Local {
		tag = "本地·" + h.Category
	}

	switch personality {
	case "lively":
		return fmt.Sprintf("吃瓜！【%s】%s……绝了哈哈哈。", tag, title)
	case "clingy":
		return fmt.Sprintf("主人看这个【%s】%s，陪我一起八卦嘛～", tag, title)
	case "tsundere":
		return fmt.Sprintf("哼，【%s】%s……才不是特意说给你听的。", tag, title)
	case "clever":
		return fmt.Sprintf("短讯【%s】：%s。有点意思。", tag, title)
	case "calm":
		return fmt.Sprintf("看到一条【%s】：%s。慢慢看就好。", tag, title)
	default:
		return fmt.Sprintf("【%s】%s", tag, title)
	}
}

func firstHint(hints string) string {
	hints = strings.TrimSpace(hints)
	if hints == "" {
		return "按体感增减衣就好"
	}
	if i := strings.Index(hints, "；"); i >= 0 {
		return strings.TrimSpace(hints[:i])
	}
	return hints
}

func truncateRunes(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= max {
		return string(r)
	}
	return string(r[:max]) + "…"
}

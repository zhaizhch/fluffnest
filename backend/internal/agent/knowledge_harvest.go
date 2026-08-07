package agent

import (
	"regexp"
	"strings"
	"time"
	"unicode"
)

// Automatic knowledge harvest from WeChat chitchat.
// Fast-path companion turns skip tools, so personal facts must be captured here
// or they never land in the owner dossier / knowledge base.

var (
	reFavPerson = regexp.MustCompile(`(?i)(?:我)?最喜欢的人(?:是|叫)?\s*([^\n，。！？,.!?;；]{1,40})`)
	reFavThing  = regexp.MustCompile(`(?i)(?:我)?最喜欢(?:的)?(?:事|东西|游戏|歌|电影|动漫|剧|番|选手|球员|明星|球队|角色)?(?:是|叫)?\s*([^\n，。！？,.!?;；]{1,40})`)
	reZuiAi     = regexp.MustCompile(`(?i)(?:我)?最爱(?:的)?(?:人|事|东西)?(?:是|叫)?\s*([^\n，。！？,.!?;；]{1,40})`)
	reLike      = regexp.MustCompile(`(?i)(?:我)?(?:超|挺|特别|非常|真的)?喜欢\s*([^\n，。！？,.!?;；]{1,40})`)
	reLoveDo    = regexp.MustCompile(`(?i)(?:我|还|也)?爱(?:看|听|玩|吃|追)\s*([^\n，。！？,.!?;；]{1,40})`)
	reAlsoLike  = regexp.MustCompile(`(?i)还(?:超|挺|特别)?喜欢\s*([^\n，。！？,.!?;；]{1,40})`)
	reIsFav     = regexp.MustCompile(`(?i)([^\n，。！？,.!?;；]{1,24})(?:是我的最爱|是我最喜欢的)`)
	reDislike   = regexp.MustCompile(`(?i)(?:我)?(?:不喜欢|讨厌|烦|受不了)\s*([^\n，。！？,.!?;；]{1,40})`)
	reRelation  = regexp.MustCompile(`(?i)我(?:的)?(对象|女朋友|男朋友|老婆|老公|闺蜜|兄弟|同事|老板|导师|爸|妈|妈妈|爸爸|儿子|女儿|偶像|宠物|猫|狗)(?:是|叫|名叫)?\s*([^\n，。！？,.!?;；]{1,40})`)
	reCallMe    = regexp.MustCompile(`(?i)(?:以后)?(?:叫我|称呼我)\s*([^\p{P}\n]{1,16})`)
	reMyName    = regexp.MustCompile(`(?i)我(?:的名字|叫|是)\s*([^\p{P}\n]{2,16})`)
	reLiveIn    = regexp.MustCompile(`(?i)(?:我)?(?:住在|住|家在|在)\s*([^\n，。！？,.!?;；]{2,20}?)(?:市|区)?(?:上班|工作|生活|定居)?(?:[，。！？\s]|$)`)
	reHomeCity  = regexp.MustCompile(`(?i)(?:我家|常住|定居)(?:在|于)\s*([^\n，。！？,.!?;；]{2,16})`)
	reWorkAt    = regexp.MustCompile(`(?i)(?:我)?(?:在|于)\s*([^\n，。！？,.!?;；]{2,24}?)(?:公司|集团|工作室|厂|医院|学校)?(?:上班|工作|任职)`)
	reJobTitle  = regexp.MustCompile(`(?i)我(?:是|做)\s*([^\n，。！？,.!?;；]{2,24}?)(?:工程师|开发|程序员|产品|设计|运营|老师|医生|学生|律师|会计)?`)
	reStudy     = regexp.MustCompile(`(?i)我(?:在|就读于|读)\s*([^\n，。！？,.!?;；]{2,24}?)(?:大学|学院|学校|高中)?(?:上学|读书)?`)
	reBirthday  = regexp.MustCompile(`(?i)(?:我)?(?:生日|诞辰)(?:是|在)?\s*([0-9]{1,2}\s*[月./-]\s*[0-9]{1,2}日?|[0-9]{4}\s*[年./-]\s*[0-9]{1,2}\s*[月./-]\s*[0-9]{1,2}日?)`)
	reAllergy   = regexp.MustCompile(`(?i)我对\s*([^\n，。！？,.!?;；]{1,20})过敏|过敏\s*([^\n，。！？,.!?;；]{1,20})`)
	reBoundary  = regexp.MustCompile(`(?i)(?:别|不要|别再|千万别)(?:跟我)?(?:提|说|聊|问)\s*([^\n，。！？,.!?;；]{1,40})`)
	reQuiet     = regexp.MustCompile(`(?i)(?:我)?(?:一般|通常)?(?:晚上|夜里)?\s*([0-2]?\d\s*[点:：]\s*[0-5]?\d?)\s*(?:之后)?(?:别|不要)?(?:打扰|找我|叫我)`)
	reSleep     = regexp.MustCompile(`(?i)(?:我)?(?:一般|通常)?(?:晚上|夜里)?\s*([0-2]?\d)\s*点(?:多)?(?:睡|睡觉|休息)`)
	reGoal      = regexp.MustCompile(`(?i)(?:我)?(?:最近)?(?:想|打算|计划|目标是|要准备)\s*([^\n，。！？,.!?;；]{2,40})`)
	rePetName   = regexp.MustCompile(`(?i)我(?:的)?(猫|狗|宠物)(?:叫|名叫)\s*([^\n，。！？,.!?;；]{1,20})`)
	reTimezone  = regexp.MustCompile(`(?i)(?:我)?(?:时区|在)\s*(UTC[+\-]?\d{1,2}|北京时间|上海时间|东京时间|美西|美东)`)
	reTone      = regexp.MustCompile(`(?i)(?:回复|说话|聊天)?(?:请)?(?:用|要)?(简洁|短一点|详细一点|正经|温柔|少卖萌|别卖萌|多卖萌)`)
)

type knowledgeHit struct {
	Section string
	Key     string
	Value   string
	Mode    string // append (list merge) | set (overwrite)
}

// HarvestOwnerKnowledge extracts durable personal facts from one user utterance
// and merges them into the owner dossier. Safe every turn (incl. fast path).
func (m *Memory) HarvestOwnerKnowledge(peerID, utterance string) int {
	if m == nil {
		return 0
	}
	peerID = strings.TrimSpace(peerID)
	utterance = strings.TrimSpace(utterance)
	if peerID == "" || utterance == "" {
		return 0
	}
	hits := extractKnowledgeHits(utterance)
	if len(hits) == 0 {
		return 0
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	d := m.getOwnerLocked(peerID)
	changed := 0
	for _, h := range hits {
		sec, ok := ownerSectionMap(&d, h.Section)
		if !ok {
			continue
		}
		if looksSecret(h.Key, h.Value) {
			continue
		}
		prev := sec[h.Key]
		var next string
		if h.Mode == "set" {
			next = truncateRunes(h.Value, 320)
			if next == "" || next == prev {
				continue
			}
		} else {
			next = mergeUniqueList(prev, h.Value, 10)
			if next == "" || next == prev {
				continue
			}
			next = truncateRunes(next, 320)
		}
		sec[h.Key] = next
		changed++
	}
	if changed == 0 {
		return 0
	}
	d.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	d.OpenQuestions = pruneAnsweredOpenQuestions(d)
	m.OwnerProfiles[peerID] = d

	// Mirror common keys into peer KV for legacy tool consumers.
	if city := firstMap(d.Identity, "home_city", "city"); city != "" {
		m.Peers[peerID] = ensurePeerMap(m.Peers, peerID)
		m.Peers[peerID]["home_city"] = MemoryItem{Value: city, UpdatedAt: d.UpdatedAt, Source: "harvest"}
	}
	_ = m.saveLocked()
	return changed
}

func ensurePeerMap(peers map[string]map[string]MemoryItem, peerID string) map[string]MemoryItem {
	if peers[peerID] == nil {
		peers[peerID] = map[string]MemoryItem{}
	}
	return peers[peerID]
}

func pruneAnsweredOpenQuestions(d OwnerDossier) []string {
	var remain []string
	for _, q := range d.OpenQuestions {
		ql := strings.ToLower(q)
		answered := false
		switch {
		case strings.Contains(ql, "称呼") || strings.Contains(ql, "nickname"):
			answered = firstMap(d.Identity, "nickname", "name", "call_me") != ""
		case strings.Contains(ql, "城市") || strings.Contains(ql, "city"):
			answered = firstMap(d.Identity, "home_city", "city") != ""
		case strings.Contains(ql, "工作"):
			answered = firstMap(d.Work, "role", "focus", "company", "project") != ""
		case strings.Contains(ql, "风格") || strings.Contains(ql, "tone"):
			answered = firstMap(d.Preferences, "tone", "reply_style", "length") != ""
		case strings.Contains(ql, "兴趣") || strings.Contains(ql, "爱好") || strings.Contains(ql, "游戏"):
			answered = firstMap(d.Preferences, "favorites", "likes") != "" ||
				firstMap(d.Lifestyle, "hobbies", "favorite_games", "favorites") != ""
		case strings.Contains(ql, "目标"):
			answered = firstMap(d.Goals, "focus", "habit", "goal") != ""
		case strings.Contains(ql, "边界"):
			answered = firstMap(d.Boundaries, "no_go", "quiet_hours") != ""
		case strings.Contains(ql, "作息"):
			answered = firstMap(d.Lifestyle, "sleep_time", "schedule") != ""
		}
		if !answered {
			remain = append(remain, q)
		}
	}
	if len(remain) > 8 {
		remain = remain[:8]
	}
	return remain
}

func extractKnowledgeHits(text string) []knowledgeHit {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	var hits []knowledgeHit
	add := func(section, key, raw, mode string) {
		v := cleanKnowledgeValue(raw)
		if v == "" || isWeakKnowledgeValue(v) {
			return
		}
		if mode == "" {
			mode = "append"
		}
		hits = append(hits, knowledgeHit{Section: section, Key: key, Value: v, Mode: mode})
	}

	// --- identity ---
	if m := reCallMe.FindStringSubmatch(text); len(m) > 1 {
		nick := cleanKnowledgeValue(m[1])
		if nick != "" && utf8SafeLen(nick) <= 12 && !strings.Contains(nick, "喜欢") {
			add("identity", "nickname", nick, "set")
		}
	}
	if m := reMyName.FindStringSubmatch(text); len(m) > 1 {
		name := cleanKnowledgeValue(m[1])
		// Avoid "我是学生/工程师" caught as name — those go to work.
		if name != "" && utf8SafeLen(name) <= 12 && !looksLikeJobWord(name) && !strings.Contains(name, "喜欢") {
			if strings.Contains(text, "我叫") || strings.Contains(text, "名字") {
				add("identity", "name", name, "set")
				add("identity", "nickname", name, "set")
			}
		}
	}
	if m := reHomeCity.FindStringSubmatch(text); len(m) > 1 {
		add("identity", "home_city", stripPlaceSuffix(m[1]), "set")
	} else if m := reLiveIn.FindStringSubmatch(text); len(m) > 1 {
		city := stripPlaceSuffix(m[1])
		if looksLikeCity(city) {
			add("identity", "home_city", city, "set")
		}
	}
	if m := reTimezone.FindStringSubmatch(text); len(m) > 1 {
		add("identity", "timezone", m[1], "set")
	}
	if m := reBirthday.FindStringSubmatch(text); len(m) > 1 {
		add("identity", "birthday", strings.ReplaceAll(m[1], " ", ""), "set")
	}

	// --- work / study ---
	if m := reWorkAt.FindStringSubmatch(text); len(m) > 1 {
		add("work", "company", m[1], "set")
	}
	if m := reJobTitle.FindStringSubmatch(text); len(m) > 1 {
		role := strings.TrimSpace(m[1])
		// reJobTitle may capture trailing title in group — keep full phrase from match area
		if full := extractJobPhrase(text); full != "" {
			role = full
		}
		if role != "" && !strings.Contains(role, "喜欢") {
			add("work", "role", role, "set")
		}
	}
	if m := reStudy.FindStringSubmatch(text); len(m) > 1 {
		add("work", "school", m[1], "set")
		add("work", "role", "学生", "set")
	}

	// --- lifestyle / favorites ---
	if m := reFavPerson.FindStringSubmatch(text); len(m) > 1 {
		add("relationships", "favorite_people", m[1], "append")
	}
	if m := reFavThing.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		key := classifyFavoriteKey(text, v)
		if key == "favorite_people" {
			add("relationships", key, v, "append")
		} else {
			add("preferences", "favorites", v, "append")
			add("lifestyle", key, v, "append")
		}
	}
	if m := reZuiAi.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		if looksLikePersonName(v) {
			add("relationships", "favorite_people", v, "append")
		} else {
			add("preferences", "favorites", v, "append")
			add("lifestyle", classifyFavoriteKey(text, v), v, "append")
		}
	}
	if m := reIsFav.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		if looksLikePersonName(v) {
			add("relationships", "favorite_people", v, "append")
		} else {
			add("preferences", "favorites", v, "append")
		}
	}
	if m := reLike.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		if !isPetRoleplayLike(v) {
			if looksLikePersonName(v) {
				add("relationships", "favorite_people", v, "append")
			} else {
				add("preferences", "likes", v, "append")
				add("preferences", "favorites", v, "append")
			}
		}
	}
	if m := reLoveDo.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		low := text
		switch {
		case strings.Contains(low, "爱看"), strings.Contains(low, "爱追"):
			add("lifestyle", "favorite_shows", v, "append")
		case strings.Contains(low, "爱听"):
			add("lifestyle", "favorite_music", v, "append")
		case strings.Contains(low, "爱玩"):
			add("lifestyle", "favorite_games", v, "append")
		case strings.Contains(low, "爱吃"):
			add("lifestyle", "favorite_food", v, "append")
		}
		add("preferences", "favorites", v, "append")
	}
	if m := reAlsoLike.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		if !isPetRoleplayLike(v) {
			add("preferences", "likes", v, "append")
			add("preferences", "favorites", v, "append")
		}
	}
	if m := reDislike.FindStringSubmatch(text); len(m) > 1 {
		add("preferences", "dislikes", m[1], "append")
	}
	if m := reSleep.FindStringSubmatch(text); len(m) > 1 {
		add("lifestyle", "sleep_time", strings.TrimSpace(m[1])+"点", "set")
	}
	if m := reAllergy.FindStringSubmatch(text); len(m) > 1 {
		v := m[1]
		if v == "" && len(m) > 2 {
			v = m[2]
		}
		if strings.TrimSpace(v) != "" {
			add("lifestyle", "allergies", v, "append")
			add("boundaries", "allergies", v, "append")
		}
	}

	// --- relationships ---
	if m := rePetName.FindStringSubmatch(text); len(m) > 2 {
		add("relationships", m[1], m[2], "set")
		add("relationships", "pets", m[1]+"·"+cleanKnowledgeValue(m[2]), "append")
	}
	if m := reRelation.FindStringSubmatch(text); len(m) > 2 {
		rel := strings.TrimSpace(m[1])
		name := cleanKnowledgeValue(m[2])
		if name != "" && rel != "猫" && rel != "狗" && rel != "宠物" {
			add("relationships", rel, name, "set")
			add("relationships", "important_people", rel+"·"+name, "append")
		}
	}

	// --- goals / boundaries / prefs ---
	if m := reGoal.FindStringSubmatch(text); len(m) > 1 {
		g := m[1]
		if !isWeakGoal(g) {
			add("goals", "focus", g, "append")
		}
	}
	if m := reBoundary.FindStringSubmatch(text); len(m) > 1 {
		add("boundaries", "no_go", m[1], "append")
	}
	if m := reQuiet.FindStringSubmatch(text); len(m) > 1 {
		add("boundaries", "quiet_hours", m[1]+"后勿扰", "set")
	}
	if m := reTone.FindStringSubmatch(text); len(m) > 1 {
		add("preferences", "tone", m[1], "set")
	}

	// Freeform durable self-statement → notes (last resort, short).
	if len(hits) == 0 && looksLikePersonalStatement(text) {
		add("context", "recent_note", truncateRunes(text, 80), "append")
	}

	return dedupeHits(hits)
}

func extractJobPhrase(text string) string {
	re := regexp.MustCompile(`我(?:是|做)\s*([^\n，。！？,.!?;；]{2,30})`)
	m := re.FindStringSubmatch(text)
	if len(m) < 2 {
		return ""
	}
	v := cleanKnowledgeValue(m[1])
	if looksLikeJobWord(v) || utf8SafeLen(v) <= 16 {
		return v
	}
	return ""
}

func looksLikeJobWord(v string) bool {
	keys := []string{"工程", "开发", "程序", "产品", "设计", "运营", "老师", "医生", "学生", "律师", "会计", "研究", "实习", "经理", "老板"}
	for _, k := range keys {
		if strings.Contains(v, k) {
			return true
		}
	}
	return false
}

func looksLikeCity(v string) bool {
	v = strings.TrimSpace(v)
	n := utf8SafeLen(v)
	if n < 2 || n > 12 {
		return false
	}
	weak := []string{
		"公司", "家里", "外面", "这里", "那里", "学校", "单位",
		"吃饭", "开会", "上班", "想", "忙", "玩", "看", "听", "等",
	}
	for _, w := range weak {
		if strings.Contains(v, w) {
			return false
		}
	}
	return true
}

func stripPlaceSuffix(s string) string {
	s = cleanKnowledgeValue(s)
	for _, suf := range []string{"市", "区", "县", "省"} {
		s = strings.TrimSuffix(s, suf)
	}
	return s
}

func isWeakGoal(v string) bool {
	v = strings.TrimSpace(v)
	if utf8SafeLen(v) < 2 {
		return true
	}
	weak := []string{"一下", "看看", "说说", "聊聊", "睡觉", "吃饭", "回家"}
	for _, w := range weak {
		if v == w {
			return true
		}
	}
	return false
}

func looksLikePersonalStatement(text string) bool {
	text = strings.TrimSpace(text)
	n := utf8SafeLen(text)
	if n < 6 || n > 60 {
		return false
	}
	if !strings.Contains(text, "我") {
		return false
	}
	// Avoid questions and pure chitchat.
	if strings.ContainsAny(text, "？?") || hasFactSeekingShape(text) {
		return false
	}
	cues := []string{
		"我", "住", "在", "工作", "上班", "学", "养", "过敏", "习惯", "一般",
		"最近", "正在", "准备", "喜欢", "讨厌", "叫",
	}
	hits := 0
	for _, c := range cues {
		if strings.Contains(text, c) {
			hits++
		}
	}
	return hits >= 2
}

func classifyFavoriteKey(ctx, value string) string {
	low := strings.ToLower(ctx + " " + value)
	switch {
	case strings.Contains(ctx, "最喜欢的人") || strings.Contains(ctx, "最爱的人"):
		return "favorite_people"
	case strings.Contains(low, "游戏") || strings.Contains(low, "game"):
		return "favorite_games"
	case strings.Contains(low, "歌") || strings.Contains(low, "音乐"):
		return "favorite_music"
	case strings.Contains(low, "电影") || strings.Contains(low, "剧") || strings.Contains(low, "动漫") || strings.Contains(low, "番"):
		return "favorite_shows"
	case strings.Contains(low, "吃") || strings.Contains(low, "菜") || strings.Contains(low, "食物"):
		return "favorite_food"
	default:
		return "hobbies"
	}
}

func cleanKnowledgeValue(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, "《》「」『』\"'“”‘’ ")
	for _, cut := range []string{"啊", "呀", "呢", "哦", "喔", "啦", "呗", "哈", "哈哈哈"} {
		s = strings.TrimSuffix(s, cut)
	}
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "，。！？；;,.!?\n"); i > 0 {
		s = strings.TrimSpace(s[:i])
	}
	if utf8SafeLen(s) > 40 {
		s = truncateRunes(s, 40)
	}
	return s
}

func isWeakKnowledgeValue(v string) bool {
	low := strings.ToLower(v)
	weak := []string{
		"你", "我", "他", "她", "它", "这个", "那个", "这样", "那样", "什么", "谁",
		"东西", "事", "事情", "人", "哈哈", "呵呵", "嗯", "啊", "呀",
		"you", "me", "it", "this", "that",
	}
	for _, w := range weak {
		if low == w {
			return true
		}
	}
	return utf8SafeLen(v) < 1
}

func isPetRoleplayLike(v string) bool {
	v = strings.TrimSpace(v)
	switch v {
	case "你", "你们", "卡卡", "桌宠", "本宝宝", "我":
		return true
	}
	return false
}

func looksLikePersonName(v string) bool {
	v = strings.TrimSpace(v)
	n := utf8SafeLen(v)
	if n < 2 || n > 12 {
		return false
	}
	hasCJK := false
	for _, r := range v {
		if unicode.Is(unicode.Han, r) {
			hasCJK = true
			break
		}
	}
	for _, bad := range []string{
		"游戏", "电影", "音乐", "吃", "玩", "看", "听", "剧",
		"星露", "原神", "王者", "抖音", "微博", "B站", "塞尔达",
	} {
		if strings.Contains(v, bad) {
			return false
		}
	}
	return hasCJK || (n <= 20 && !strings.Contains(v, " "))
}

func mergeUniqueList(existing, add string, maxItems int) string {
	add = strings.TrimSpace(add)
	if add == "" {
		return strings.TrimSpace(existing)
	}
	parts := splitKnowledgeList(existing)
	seen := map[string]bool{}
	var out []string
	for _, p := range parts {
		k := strings.ToLower(p)
		if p == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, p)
	}
	for _, p := range splitKnowledgeList(add) {
		k := strings.ToLower(p)
		if p == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, p)
	}
	if maxItems > 0 && len(out) > maxItems {
		out = out[len(out)-maxItems:]
	}
	return strings.Join(out, "、")
}

func splitKnowledgeList(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	s = strings.ReplaceAll(s, ",", "、")
	s = strings.ReplaceAll(s, "，", "、")
	s = strings.ReplaceAll(s, "/", "、")
	s = strings.ReplaceAll(s, "|", "、")
	raw := strings.Split(s, "、")
	var out []string
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func dedupeHits(in []knowledgeHit) []knowledgeHit {
	seen := map[string]bool{}
	var out []knowledgeHit
	for _, h := range in {
		k := h.Section + "|" + h.Key + "|" + strings.ToLower(h.Value) + "|" + h.Mode
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, h)
	}
	return out
}

func utf8SafeLen(s string) int {
	return len([]rune(s))
}

// hasPersonalFactSignal: utterance states personal facts — not pure chitchat.
// Alias kept for call sites that used the narrower name.
func hasPreferenceSignal(msg string) bool {
	return hasPersonalFactSignal(msg)
}

func hasPersonalFactSignal(msg string) bool {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return false
	}
	keys := []string{
		"最喜欢", "最爱", "喜欢", "不喜欢", "讨厌", "爱好", "爱看", "爱玩", "爱听", "爱吃", "爱追",
		"我的最爱", "记住", "别忘", "我叫", "叫我", "我的名字",
		"对象", "女朋友", "男朋友", "老婆", "老公", "偶像", "闺蜜",
		"住在", "家在", "我家", "常住", "上班", "工作", "公司", "我是", "我做",
		"大学", "学校", "学生", "生日", "过敏", "别提", "不要提", "别说",
		"几点睡", "勿扰", "安静", "目标", "打算", "准备考研", "备考",
		"养猫", "养狗", "宠物", "简洁", "少卖萌", "正经",
	}
	for _, k := range keys {
		if strings.Contains(msg, k) {
			return true
		}
	}
	return false
}

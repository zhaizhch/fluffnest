---
name: research
description: Use when the user asks factual, how-to, product, game, news, or “look up” questions that need live web evidence (including 最新/新料/更新).
triggers: [搜索, 查一下, 是什么, 怎么, 为何, 新闻, 最新, 新料, 更新, 补丁, 冠军, 成绩, 结果, 谁赢, 比赛, 排名, 箱根, 驿传, who, what, how, why, news, search, update, patch, 星露谷, Stardew]
---

# Research Skill（国内+国外联邦检索）

目标：每次搜索前优化原问题 → 国内与国外引擎并行 → 合并结果，避免单源空转。

## Cycle
1. **澄清意图**（内心一句）：百科事实 / 最新动态 / 攻略怎么做。
2. **第一次 `web_search`**：
   - 直接把用户原话（或核心实体）放进 `query`，不必自己翻译；工具会改写国内+国外检索词。
   - 最新/新料/更新/补丁/成绩/冠军/区间赏 → `type=news`
   - 国内：Bing 国内 / 搜狗微信 / 搜狗；国外：Bing 国际 / DDG / 百科 / Google News；结果会合并标注。
   - 要「名单/区间赏/选手」时工具会深读前几条正文，勿只根据标题瞎编。
3. **若结果偏少或偏题**：再搜一轮（换实体写法或加年份/届次），最多 2 次工具调用。
4. 天气用 `get_weather`；泛热点用 `get_news`；本 skill 专注具体实体检索。
5. **作答**：短结论 → 1–2 条依据（可带来源名，国内/国外都可）→ 不确定就说不确定。
6. 真的全空：说明优化后的国内外关键词，请用户给英文名或更具体版本号——**禁止**假装「网上没有」。

## Anti-patterns
- 只靠模型记忆答「最近更新」。
- 同一废话口语连调多次 `web_search` 却不换实体关键词。
- 把原始链接墙贴进微信。
- 结果里明显跑题（无关城市水电费等）却当依据。
- 只采信单边来源、忽略另一侧已搜到的矛盾信息。

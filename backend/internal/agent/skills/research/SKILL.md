---
name: research
description: Use when the user asks factual, how-to, product, game, news, sports, or “look up” questions that need live web evidence (including 最新/新料/更新/世界杯/驿传).
triggers: [搜索, 查一下, 是什么, 怎么, 为何, 新闻, 最新, 新料, 更新, 补丁, 冠军, 成绩, 结果, 谁赢, 比赛, 排名, 本届, 本赛季, 世界杯, 入选, 国家队, 选手, 球员, who, what, how, why, news, search, update, patch, world cup]
---

# Research Skill（多 agent 并行检索）

目标：需要联网证据时才检索；国内 agent ∥ 国际 agent，够用即停。近期事实必须以检索为准。

## Cycle
1. 系统可能已预取「本轮检索结果」（与 prompt/记忆组装并行）；先读再答。
2. 天气/时间/计算/翻译/记忆/提醒 → 用专用工具，不要网页搜索。
3. 预取不够可再 `web_search` 一次（换英文/日文或加年份）。
4. 作答：短结论 → 依据 → 不确定就说不确定。

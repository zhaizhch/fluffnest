---
name: journal
description: Use when the master writes diary/thoughts/mood/reflections, or asks to recall past journal entries by date or topic.
triggers: [日记, 想法, 心情, 感悟, 反思, 写日记, 记到日记, 今天日记, 翻日记, 看看日记, journal, diary, mood]
---

# Journal（个人日记 / 想法）

按 **月 → 日** 存主人的想法、日记、心情、感悟。稳定事实（城市/工作/喜好）仍走 owner-dossier；这里只存带时间的心声与叙事。

## Cycle
1. **写入**：明确「写日记/记想法/心情：…」时系统会自动入库；也可 `journal_write`（kind=`thought|diary|mood|reflection`，可选 date/tags）。
2. **按时间回顾**：问某月/某天/最近几天 → `journal_list`（`month=YYYY-MM` / `date=YYYY-MM-DD` / `recentDays`）。
3. **按话题回忆**：「上次写过…吗」→ `journal_search`。
4. 回复先确认已记下或给出时间线摘要，口语短聊；不要整段复读。
5. 绝不存密码、证件、精确住址等敏感信息。

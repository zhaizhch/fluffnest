---
name: tool-discipline
priority: 8
always: true
---

# Tool Discipline

1. **时间敏感**：问几点/今天星期几/能不能赶上某时 → 先 `get_local_time`。
2. **天气**：问今天/明天/后天/周末天气 → `get_weather`，用 `forTomorrow` 或 `dayOffset`；勿凭感觉报气温。
3. **新闻热点**：问头条/热点/科技娱乐资讯 → `get_news`；要深挖某条或游戏/产品「最新新料」→ `web_search`（可 `type=news`）。工具会优化原问题并国内+国外并行合并。
4. **计算**：加减乘除、百分比、简单换算 → `calc`，不要心算长数字。
5. **记忆**：每轮已有 Working Memory（thread/digest/近期笔记/相关回忆）。说「你还记得…吗」或指代不清时再 `memory_search` / `owner_dossier_get`；说「记住/忘记」→ memory 或 `owner_dossier_update`；「了解我/我的档案」→ owner-dossier skill。
6. **自我完善**：翻车或被纠正后 → `self_dossier_log`；主人问你成长 → `self_dossier_get`。
7. **提醒/定时**：口头答应不算生效；必须调用 `reminder_*` / `schedule_*`。
8. **桌宠状态**：问心情/亲密度/性格 → `get_pet_status`。
9. **翻译/摘要**：长文翻译、总结、说人话 → `rewrite_text`（或 `load_skill` lingua）。
10. **文档/附件**：微信发来 PDF/Word/txt/md，或问「总结这个文件」→ 先 `read_document`（或 `load_skill` documents），再作答；勿凭文件名瞎编内容。
11. **桌宠冒泡**：让 Mac 上的宠物立刻说话 → `pet_notify`（短文案）。
12. 同一轮可并行调用互不依赖的工具；有依赖则先结果后下一步。
13. 工具失败时如实告知，并给一个可执行的下一步（换城市、收窄问题、稍后再试）；同时可记一条 self lesson。
14. 短句续聊（「再来一个」「英文呢」「继续」）优先延续上一轮 skill，不要装作听不懂。

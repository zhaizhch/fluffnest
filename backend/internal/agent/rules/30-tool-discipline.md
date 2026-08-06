---
name: tool-discipline
priority: 8
always: true
---

# Tool Discipline

1. **时间敏感**：问几点/今天星期几/能不能赶上某时 → 先 `get_local_time`。
2. **天气**：问今天/明天/后天/周末天气 → `get_weather`，用 `forTomorrow` 或 `dayOffset`；勿凭感觉报气温。
3. **新闻热点**：问头条/热点/科技娱乐资讯 → `get_news`；要深挖某条再用 `web_search`。
4. **计算**：加减乘除、百分比、简单换算 → `calc`，不要心算长数字。
5. **记忆**：说「你还记得…吗」→ `memory_search` 或 `memory_list`；说「记住/忘记」→ memory 写删工具。
6. **提醒/定时**：口头答应不算生效；必须调用 `reminder_*` / `schedule_*`。
7. **桌宠状态**：问心情/亲密度/性格 → `get_pet_status`。
8. **翻译/摘要**：长文翻译、总结、说人话 → `rewrite_text`（或 `load_skill` lingua）。
9. **桌宠冒泡**：让 Mac 上的宠物立刻说话 → `pet_notify`（短文案）。
10. 同一轮可并行调用互不依赖的工具；有依赖则先结果后下一步。
11. 工具失败时如实告知，并给一个可执行的下一步（换城市、收窄问题、稍后再试）。
12. 短句续聊（「再来一个」「英文呢」「继续」）优先延续上一轮 skill，不要装作听不懂。

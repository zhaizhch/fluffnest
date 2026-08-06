---
name: planner
description: Use when the user wants to plan tasks, break down goals, set todos, or track what to do next.
triggers: [计划, 待办, 安排一下, 帮我规划, 步骤, 怎么安排, todo, plan, 清单]
---

# Planner Skill

## Cycle
1. Clarify the goal in one internal line; if too vague, ask one concrete question (or load `clarify`).
2. `get_local_time` if deadlines involve “今天/今晚/明天”.
3. Break into 3–5 actionable steps; keep WeChat-friendly short lines.
4. Durable items → `memory_write` keys like `todo_1`, `todo_focus` (short values).
5. Time-bound cares → offer `reminder_set` / `schedule_upsert` and call the tool if user agrees or clearly asks to set it.
6. Confirm what you saved vs what is just a suggestion.

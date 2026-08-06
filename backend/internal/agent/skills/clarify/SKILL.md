---
name: clarify
description: Use when the request is ambiguous, missing city/time/scope, or could mean multiple things.
triggers: [那个, 之前说的, 你懂的, 随便, 都行, 帮我弄一下]
---

# Clarify Skill

## Cycle
1. Check `memory_list` / `memory_search` and recent session notes for context.
2. If still ambiguous, ask **one** sharp clarifying question (city? today vs tomorrow? which task?).
3. If a safe default exists (home_city, default weather city), state the assumption and proceed; invite correction.
4. Do not chain multiple questions; do not stall forever—prefer a useful partial answer + assumption.

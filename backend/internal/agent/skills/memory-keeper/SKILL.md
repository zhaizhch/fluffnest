---
name: memory-keeper
description: Use when the user states lasting preferences, nickname, city, schedule habits, or asks you to remember/forget something.
triggers: [记住, 别忘, 我叫, 以后叫我, 我家在, 偏好, remember, forget, nickname]
---

# Memory Keeper Skill

## Cycle
1. Extract durable facts only (name, city, likes/dislikes, recurring schedule).
2. `memory_write` with a clear key and short value.
3. Confirm in one sentence what you remembered.
4. For “忘记/别记了”, use `memory_delete` on the matching key.
5. Never store secrets (passwords, tokens, ID numbers).

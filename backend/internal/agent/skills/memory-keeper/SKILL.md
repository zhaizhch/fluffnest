---
name: memory-keeper
description: Use when the user states lasting preferences, nickname, city, schedule habits, or asks you to remember/forget something.
triggers: [记住, 别忘, 我叫, 以后叫我, 我家在, 偏好, remember, forget, nickname]
---

# Memory Keeper Skill

## Cycle
1. Extract durable facts only (name, city, likes/dislikes, recurring schedule).
2. Prefer structured dossiers:
   - lasting personal facts → `owner_dossier_update`
   - freeform observation → `owner_dossier_note`
   - tiny flags for other tools → `memory_write`（如 `home_city`）
3. Recall：每轮已有 Working Memory；仍缺细节再用 `memory_search` / `owner_dossier_get`，不要假设整库已在上下文。
4. Confirm in one sentence what you remembered.
5. For “忘记/别记了”, use `memory_delete` or overwrite with「已清除」。
6. Never store secrets (passwords, tokens, ID numbers).

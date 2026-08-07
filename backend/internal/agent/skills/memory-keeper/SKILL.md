---
name: memory-keeper
description: Use when the user states lasting personal facts (likes, city, job, family, habits) or asks you to remember/forget something.
triggers: [记住, 别忘, 我叫, 以后叫我, 我家在, 我住, 偏好, 最喜欢, 最爱, 我是, 上班, remember, forget, nickname]
---

# Memory Keeper Skill

## Cycle
1. 个人情况优先进结构化档案（系统也会自动 harvest；工具用于确认/纠正/补充）：
   - 身份/城市/生日 → `owner_dossier_update` section=`identity`
   - 工作/学校 → `work`
   - 爱好/作息/饮食 → `lifestyle`
   - 喜恶/语气 → `preferences`
   - 家人朋友宠物 → `relationships`
   - 目标 → `goals`；禁区 → `boundaries`
   - 不好归类 → `owner_dossier_note`
   - **带时间的想法/日记/心情/感悟** → `journal_write`（或让主人用「日记：/想法：」前缀自动入库）；回顾用 `journal_list` / `journal_search`
   - 给天气等工具用的短旗标 → `memory_write`（如 `home_city`）
2. Recall：每轮已有 Essentials + Working Memory（含近日日记）；不够再用 `memory_search` / `owner_dossier_get` / `journal_*`。
3. Confirm in one sentence what you remembered.
4. For “忘记/别记了”, use `memory_delete` or overwrite with「已清除」。
5. Never store secrets (passwords, tokens, ID numbers, exact home address).

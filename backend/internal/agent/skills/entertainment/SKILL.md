---
name: entertainment
description: Use for jokes, fortune, cheer-up, playful roleplay, or “讲个笑话/今日运势”.
triggers: [笑话, 讲个笑, 段子, 运势, 今日运势, 占卜, 开心一下, 逗我, joke, fortune]
---

# Entertainment Skill

## Cycle
1. Skip research tools unless the user mixes in a factual ask.
2. Optional: `get_local_time` for “今日运势” so the date feels grounded; `get_weather` only if weaving weather into fortune.
3. Optional: `memory_read` / `memory_search` for nickname to personalize.
4. Reply in pet personality:
   - 笑话：1 个短笑话 + 一句收尾，勿连发。
   - 运势：趣味向 3–5 句（心情/小建议/忌一小事），声明纯属娱乐。
5. Never claim supernatural certainty or medical/financial prediction.
6. Optional: `pet_notify` with a one-line punchline so the desktop pet bubbles too.

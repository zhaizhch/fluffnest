---
name: research
description: Use when the user asks factual, how-to, product, news, or “look up” questions that need web evidence.
triggers: [搜索, 查一下, 是什么, 怎么, 为何, 新闻, 最新, who, what, how, why, news, search]
---

# Research Skill

## When to use
Any question where correctness depends on external facts or current events.

## Cycle
1. Clarify the real question in one line (internally).
2. Call `web_search` with a sharp query (Chinese or English as needed).
3. If weather-related, also call `get_weather`. If “头条/热点”, also call `get_news`.
4. Cross-check: prefer consistent snippets; discard outliers.
5. Reply with: short answer → 1–2 supporting points → optional caveat.
6. If results are empty, say you couldn't verify and ask a narrower question.

## Anti-patterns
- Answering from memory alone for news/prices/schedules.
- Dumping raw search snippets into WeChat.

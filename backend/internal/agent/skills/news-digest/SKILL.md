---
name: news-digest
description: Use for headlines, hot topics, tech/entertainment news digests, or “今天有什么新闻”.
triggers: [新闻, 头条, 热点, 资讯, 科技新闻, 娱乐新闻, 八卦, headlines, news]
---

# News Digest Skill

## Cycle
1. Call `get_news` with category=`tech`|`entertainment`|`both`（默认 both）。
2. If user asks about a specific story/company, also `web_search` that entity.
3. Pick 2–3 items max; one-line each in pet voice + optional soft opinion.
4. Do not invent headlines. If empty, say so and offer a narrower topic.
5. Optional: `memory_write` preference like `news_pref=tech` when user states a lasting preference.

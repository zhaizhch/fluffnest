---
name: lingua
description: Use for translation (中英互译等), summarizing long text, or simplifying jargon into plain Chinese.
triggers: [翻译, 译成, 翻成英文, 翻成中文, 总结, 摘要, 概括一下, 精简, 说人话, translate, summarize, summary]
---

# Lingua Skill（翻译 / 摘要）

## Cycle
1. 若正文很长或夹杂多段，优先调用 `rewrite_text`：
   - 翻译：`mode=translate`，`targetLang=en|zh|ja|…`
   - 摘要：`mode=summarize`（默认中文要点）
   - 说人话：`mode=simplify`
2. 若用户只给了一句短词，可直接口译，不必强行调工具。
3. 微信回复：先给结果，再可选一句极短说明；不要贴原文墙。
4. 用户说「也让桌宠念一下/冒个泡」→ 再调 `pet_notify`，text 用精炼后的短句。

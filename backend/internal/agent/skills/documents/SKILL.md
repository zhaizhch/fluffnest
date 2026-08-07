---
name: documents
description: Use when the user sends a WeChat file (PDF/Word/txt/md) or asks to summarize, extract, or answer questions about an attached document.
triggers: [文件, 文档, PDF, pdf, Word, word, docx, 总结文件, 读一下, 看看这个文件, 附件, 合同, 简历]
---

# Documents Skill（读文档）

## Cycle
1. 若系统提示里有「本轮微信附件」，**必须先**调用 `read_document`（可省略 path，默认第一个附件）。
2. 根据抽出的正文回答：摘要、要点、答问、翻译（长文可再调 `rewrite_text`）。
3. 扫描件/加密/抽不出字时，如实说明，并建议发可复制文本或可抽取文字的 PDF/docx。
4. 图片/视频本轮不识读；旧版 `.doc` 请用户另存为 `.docx`。
5. 微信回复：短聊风格，先给结论/要点，不要贴原文墙。

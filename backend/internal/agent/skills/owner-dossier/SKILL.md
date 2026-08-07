---
name: owner-dossier
description: Use when learning durable facts about the master, reviewing their profile, or when they ask what you know about them / 了解我 / 我的档案.
triggers: [了解我, 我的档案, 你记得我, 记住我, 我是谁, 关于我, 资料库, dossier, profile, who am i]
---

# Owner Dossier（主人资料库）

目标：建立并持续完善主人的详尽档案，而不是零散 key-value。

## 分区
- `identity`：称呼、姓名、生日、时区、城市…
- `work`：职业、项目、技能、常用工具、忙闲节奏…
- `lifestyle`：作息、饮食、运动、爱好、在玩游戏…
- `preferences`：回复长短/语气、喜欢的话题…
- `relationships`：家人/朋友/宠物等重要关系（非隐私窥探）
- `goals`：近期目标、想养成的习惯
- `boundaries`：禁区话题、安静时段、不要做的事
- `context`：当前出差/考试/压力等近况

## Cycle
0. 默认 context 只有主人要点；需要细节时再 `owner_dossier_get`（不要假设整档已在 prompt）。
1. 先看已有内容，避免重复问。
2. 对话里出现稳定事实 → 立刻 `owner_dossier_update`（section+key+value）。
3. 观察性材料（非字段）→ `owner_dossier_note`。
4. 档案空时：每轮最多温柔追问 **1** 个 OpenQuestion，答完就写入。
5. 主人问「你了解我吗/我的档案」→ 用工具拉完整档后摘要回答。
6. 绝不存密码、证件号、精确住址、银行卡等敏感信息。

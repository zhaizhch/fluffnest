---
name: owner-dossier
description: Use when learning durable facts about the master, reviewing their profile, or when they ask what you know about them / 了解我 / 我的档案.
triggers: [了解我, 我的档案, 你记得我, 记住我, 我是谁, 关于我, 资料库, dossier, profile, who am i]
---

# Owner Dossier（主人知识库）

目标：把与主人相关的个人情况持续写入结构化档案，供每轮 Essentials 快速调用。

## 分区
- `identity`：称呼、姓名、生日、时区、城市…
- `work`：职业、公司、学校、项目、技能…
- `lifestyle`：作息、饮食、运动、爱好、游戏、过敏…
- `preferences`：喜恶、回复长短/语气、话题…
- `relationships`：家人/朋友/宠物/最爱的人…
- `goals`：近期目标、想养成的习惯
- `boundaries`：禁区话题、安静时段、不要做的事
- `context`：当前出差/考试/压力等近况

## Cycle
0. 闲聊自述会自动 harvest；默认 context 有要点，细节不够再 `owner_dossier_get`。
1. 先看已有内容，避免重复问。
2. 稳定事实 → `owner_dossier_update`（纠正/补充自动结果）。
3. 观察性材料 → `owner_dossier_note`。
4. 档案空时：每轮最多温柔追问 **1** 个 OpenQuestion。
5. 主人问「你了解我吗/我的档案」→ 拉完整档后摘要回答。
6. 绝不存密码、证件号、精确住址、银行卡等敏感信息。

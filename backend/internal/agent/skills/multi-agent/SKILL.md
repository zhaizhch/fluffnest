---
name: multi-agent
description: Use when the main agent should hire a persistent specialist crew to decide/debate together — with inbox messaging and a shared board.
triggers: [多智能体, 多角度, 一起讨论, 会诊, 利弊, 权衡, 帮我决策, 优缺点, 正反方, 多方意见, 辩论, council, debate, tradeoff, pros and cons]
---

# Multi-Agent Skill（持久 Agent + Crew）

设计参考：OpenAI Agents SDK（经理综合、专家当工具）、CrewAI（角色/任务）、Swarm（concurrent / sequential / handoff）。
微信场景默认 **concurrent**（并行最快）；避免 AutoGen 式长群聊。

## 核心能力
1. **持久记忆**：子 Agent 有 `messages`，多次 `agent_chat` 记得上文
2. **生命周期**：`hire → 协作 → disband`（`multi_agent_run`；`keep_alive` 可暂不解散）
3. **通信**：`agent_send` / `agent_broadcast` → 对方 `inbox`；共享白板可 `agent_board_read`

## 何时开会
- 决策/取舍、利弊、多视角权衡
- 单角色容易漏反方或风险

## 何时不要开
- 闲聊、天气、时间、计算、翻译、纯检索事实 → 用专用工具 / `research`

## Cycle
1. 主智能体判断：一人够不够？
2. 缺事实可先 `web_search`，摘要放 `shared_context`
3. `multi_agent_run`（默认 concurrent；复杂流水用 sequential；单专家+审查用 handoff）
4. 需要续聊：`keep_alive=true` 后 `agent_chat` / `agent_send`
5. 综合白板 → 一条微信口语结论（共识+分歧+建议）

## 模式
| mode | 行为 |
|------|------|
| concurrent | 全员并行 → 广播摘要 → 末位审查（默认） |
| sequential | 依次执行，每人结束后广播 |
| handoff | 主办人做完再交给 reviewer |

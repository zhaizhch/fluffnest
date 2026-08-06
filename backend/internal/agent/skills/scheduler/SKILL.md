---
name: scheduler
description: Use when the user wants reminders (water/stretch), to cancel/check them, or to set recurring pushes like evening weather or morning news briefing to WeChat.
triggers: [提醒, 取消提醒, 喝水, 久坐, 定时, 每天, 每晚, 早上, 天气预报, 资讯简报, 推送到微信, schedule, remind]
---

# Scheduler Skill

## Care reminders (桌面)
- 查询：`reminder_list`
- 开启：`reminder_set` kind=`water`|`stretch`，可带 `intervalMinutes`
- 关闭：`reminder_cancel` kind=`water`|`stretch`
- 会议：`reminder_set` kind=`meeting` + `title` + `at`(RFC3339)

## Timed WeChat pushes (自定义行为)
Kinds:
- `weather_forecast` — 天气预报（默认明日）；params: city, forTomorrow
- `news_brief` — 资讯简报；params: lookbackHours（默认 24）
- `custom_prompt` — 自由说明；params: prompt

Channel 默认 `wechat`（也可 `pet` 仅桌面气泡）。

Examples:
1. 「每天晚上八点把明天天气发到微信」
   → `schedule_upsert` kind=`weather_forecast` hour=20 minute=0 channel=`wechat` forTomorrow=true title=`晚间天气预报`
   （禁止用 `reminder_set` / meeting；口头答应不算生效，必须调用本工具）
2. 「每天晚上八点把北京、天津、南皮明天天气发到微信」
   → `schedule_upsert` kind=`weather_forecast` hour=20 city=`北京,天津,南皮` forTomorrow=true
3. 「每天早上九点发过去24小时资讯简报」
   → `schedule_upsert` kind=`news_brief` hour=9 minute=0 lookbackHours=24 title=`早间资讯简报`
4. 取消：`schedule_cancel` query=`天气` 或 id
5. 查看：`schedule_list`

## Cycle
1. 先 `reminder_list` / `schedule_list` 若用户在询问状态。
2. 变更用对应 set/cancel/upsert 工具（会排队到桌面立即生效）。
3. 用一句口语确认结果；若微信推送未绑定会话，提醒主人先给 ClawBot 发一条消息。

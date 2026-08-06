---
name: weather-care
description: Use for weather, clothing, travel, UV, rain, temperature questions.
triggers: [天气, 气温, 下雨, 下雪, 穿什么, 紫外线, 风力, 出门, weather]
---

# Weather Care Skill

## Cycle
1. Detect city from user text; else use default city / memory `home_city`.
2. Call `get_weather`：今天默认；「明天」设 `forTomorrow=true`；「后天」设 `dayOffset=2`。
3. Optional: `get_local_time` if user asks about going out “现在/今晚”.
4. Optional: `web_search` if user asks about a specific alert/typhoon.
5. Reply with: current/forecast condition → comfort tip (clothes/umbrella) → one caring line in pet voice.
6. If user states a home city, `memory_write` key `home_city`.

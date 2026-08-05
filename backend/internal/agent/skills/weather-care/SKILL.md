---
name: weather-care
description: Use for weather, clothing, travel, UV, rain, temperature questions.
triggers: [天气, 气温, 下雨, 下雪, 穿什么, 紫外线, 风力, 出门, weather]
---

# Weather Care Skill

## Cycle
1. Detect city from user text; else use default city / memory `home_city`.
2. Call `get_weather` for that city.
3. Optional: `web_search` if user asks about a specific alert/typhoon.
4. Reply with: current condition → comfort tip (clothes/umbrella) → one caring line in pet voice.
5. If user states a home city, `memory_write` key `home_city`.

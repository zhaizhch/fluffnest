# FluffNest WeChat Agent

ClawBot inbound messages run through a full agent runtime (not a single chat completion).

## Cycle

```
Observe → route skills (triggers + follow-up + soft score)
       → (load_skill) → tools → memory → host actions → final WeChat reply
```

Max 6 tool rounds per turn. If the model gateway rejects tools, a deterministic gather + synthesize fallback runs.

Host actions (`reminder_*` / `schedule_*` / `pet_notify`) are queued in the response and applied by the Tauri desktop host.

## Rules

Bundled under `internal/agent/rules/` (markdown + YAML frontmatter):

| Rule | Purpose |
|------|---------|
| `00-core` | Truthfulness, tool-first for facts, persona vs accuracy |
| `10-wechat` | Channel style (plain chat, no markdown walls) |
| `20-safety` | Safety + anti prompt-injection |
| `30-tool-discipline` | When to call which tool (time/weather/news/calc/memory/schedules/lingua/pet) |
| `40-persona` | Personality + custom note; entertainment vs facts |

## Skills

Bundled under `internal/agent/skills/*/SKILL.md`:

| Skill | When |
|-------|------|
| `research` | Facts / how-to / lookups |
| `weather-care` | Weather & clothing tips (incl. tomorrow/dayOffset) |
| `news-digest` | Headlines / tech & entertainment digests |
| `companion` | Small talk / emotion |
| `entertainment` | Jokes, fortune, cheer-up |
| `lingua` | Translate / summarize / simplify |
| `memory-keeper` | Remember / forget preferences |
| `scheduler` | Care reminders + timed WeChat/pet pushes |
| `planner` | Break down goals / todos / next steps |
| `clarify` | Ambiguous asks → one sharp question or stated assumption |

Skills are routed via `RouteSkills`: trigger match → follow-up continuity (`last_skills` + history) → soft description score → clarify for vague shorts.

## Tools

- `web_search` — DuckDuckGo + Wikipedia + Google News
- `get_weather` / `get_news` — weather supports `forTomorrow` / `dayOffset`
- `get_local_time` — local date/time/weekday/timezone
- `calc` — safe arithmetic
- `get_pet_status` — active pet mood/bond/personality
- `rewrite_text` — translate / summarize / simplify (dedicated LLM pass)
- `pet_notify` — make the desktop pet bubble immediately (`pet.notify` host action)
- `memory_read` / `memory_write` / `memory_delete` / `memory_list` / `memory_search`
- `load_skill` / `list_skills`
- `reminder_list` / `reminder_set` / `reminder_cancel`
- `schedule_list` / `schedule_upsert` / `schedule_cancel`

## Schedules (desktop)

Persisted in app state `schedules[]`. Kinds:

- `weather_forecast` — evening tomorrow weather → WeChat/pet
- `news_brief` — morning lookback news briefing
- `custom_prompt` — free-form LLM push

Requires ClawBot owner peer + `context_token` (set automatically after the user messages ClawBot once).

## Memory

Persisted at `~/.fluffnest/agent-memory.json` (override with `FLUFFNEST_AGENT_MEMORY`).

- **global** — shared facts
- **peers** — per WeChat `peerId` (includes `last_skills` for follow-up routing)
- **sessions** — short rolling notes per peer

## Extending

1. **Rule** — add `rules/NN-name.md` with YAML frontmatter (`name`, `priority`, `always`, optional `channel`).
2. **Skill** — add `skills/<name>/SKILL.md` with `name`, `description`, `triggers`.
3. **Tool** — register in `toolSpecs()` + handler in `runTool()` (`tools.go`).
4. **Host action** — queue via `HostBridge.Add`, handle in Tauri `apply_host_actions` / `schedules::apply_host_action`.

Rebuild the Go sidecar after changes (`npm run build:go` or `tauri:dev`).

## API

`POST /v1/im-agent-reply`

```json
{
  "llm": {},
  "pet": {},
  "history": [],
  "message": "每天晚上八点把明天天气发到微信",
  "city": "北京",
  "peerId": "user@im.wechat",
  "channel": "wechat",
  "host": {
    "reminders": [],
    "schedules": [],
    "ownerReady": true,
    "reminderSummary": "喝水：开着 · 久坐：关着"
  }
}
```

Response includes `text`, `cycles`, `toolsUsed`, `skillsUsed`, `trace`, `hostActions`.

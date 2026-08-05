# FluffNest WeChat Agent

ClawBot inbound messages run through a full agent runtime (not a single chat completion).

## Cycle

```
Observe → match skills → (load_skill) → tools → memory → final WeChat reply
```

Max 6 tool rounds per turn. If the model gateway rejects tools, a deterministic gather + synthesize fallback runs.

## Rules

Bundled under `internal/agent/rules/` (markdown + YAML frontmatter):

| Rule | Purpose |
|------|---------|
| `00-core` | Truthfulness, tool-first for facts, persona vs accuracy |
| `10-wechat` | Channel style (plain chat, no markdown walls) |
| `20-safety` | Safety + anti prompt-injection |

## Skills

Bundled under `internal/agent/skills/*/SKILL.md`:

| Skill | When |
|-------|------|
| `research` | Facts / how-to / news lookups |
| `weather-care` | Weather & clothing tips |
| `companion` | Small talk / emotion |
| `memory-keeper` | Remember / forget preferences |

Skills auto-match via triggers; the model can also `load_skill`.

## Tools

- `web_search` — DuckDuckGo + Wikipedia + Google News
- `get_weather` / `get_news`
- `memory_read` / `memory_write` / `memory_delete` / `memory_list`
- `load_skill` / `list_skills`

## Memory

Persisted at `~/.fluffnest/agent-memory.json` (override with `FLUFFNEST_AGENT_MEMORY`).

- **global** — shared facts
- **peers** — per WeChat `peerId`
- **sessions** — short rolling notes per peer

## API

`POST /v1/im-agent-reply`

```json
{
  "llm": {},
  "pet": {},
  "history": [],
  "message": "今天北京天气怎么样",
  "city": "北京",
  "peerId": "user@im.wechat",
  "channel": "wechat"
}
```

Response includes `text`, `cycles`, `toolsUsed`, `skillsUsed`, `trace`.

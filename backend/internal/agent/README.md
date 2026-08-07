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
| `documents` | WeChat file attachments (PDF/docx/txt/md) |
| `memory-keeper` | Remember / forget preferences |
| `owner-dossier` | Living structured profile of the master |
| `self-growth` | Agent self-improvement log |
| `scheduler` | Care reminders + timed WeChat/pet pushes |
| `planner` | Break down goals / todos / next steps |
| `multi-agent` | Main agent convenes specialists + shared board for decisions |
| `clarify` | Ambiguous asks → one sharp question or stated assumption |

Skills are routed via `RouteSkills`: trigger match → follow-up continuity (`last_skills` + history) → soft description score → clarify for vague shorts.

## Tools

- `web_search` — 国内/国际双 agent 并行（够用即停）；scope=cn|intl|both；启发式优化 CN+intl 词；`type=news|web`。时事类会在 prompt/记忆组装同时预取。
- `get_weather` / `get_news` — weather supports `forTomorrow` / `dayOffset`
- `get_local_time` — local date/time/weekday/timezone
- `calc` — safe arithmetic
- `get_pet_status` — active pet mood/bond/personality
- `rewrite_text` — translate / summarize / simplify (dedicated LLM pass)
- `read_document` — extract text from WeChat file attachments (pdf/docx/txt/md)
- `pet_notify` — make the desktop pet bubble immediately (`pet.notify` host action)
- `memory_read` / `memory_write` / `memory_delete` / `memory_list` / `memory_search`
- `owner_dossier_get` / `owner_dossier_update` / `owner_dossier_note`
- `self_dossier_get` / `self_dossier_update` / `self_dossier_log`
- `multi_agent_run` — 组建持久 Crew（concurrent|sequential|handoff）；子 Agent 有 messages+inbox
- `agent_send` / `agent_broadcast` / `agent_chat` / `team_status` — 团队通信与续聊（keep_alive）
- `agent_board_post` / `agent_board_read` — 共享白板
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

Layered like common agent memory stacks (working / episodic / long-term):

| Layer | What | Injected every turn? |
|-------|------|----------------------|
| **Essentials** | owner/self dossier highlights | yes (compact) |
| **Working Memory** | open thread + episodic digest + hot session notes + query-relevant recalls | yes |
| **Recent chat** | last ~5 turns, lightly truncated | yes (as chat msgs) |
| **Episodic summary** | older turns folded into one summary block | yes (when history is long) |
| **Long-term store** | global/peer KV, full dossiers | on demand via tools |

Store shape:

- **global** — shared facts
- **peers** — per WeChat `peerId` (includes `last_skills` for follow-up routing)
- **sessions** — hot notes + digest + open thread (refined after turns)
- **ownerProfiles** — structured living dossier per peer
- **self** — agent self-improvement dossier

Do **not** dump the whole knowledge base into every prompt. History compression keeps recent messages readable and rolls older chat into an episodic summary (not ultra-short stubs).

**Auto harvest:** WeChat chitchat that states personal facts (likes, city, job, family, sleep, goals, boundaries…) is parsed into the owner dossier every turn—even on fast-path—so later questions can answer from Essentials without re-asking.

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
  "message": "帮我总结这个文件",
  "city": "北京",
  "peerId": "user@im.wechat",
  "channel": "wechat",
  "attachments": [
    { "path": "/…/wechat-media/123_report.pdf", "name": "report.pdf", "mime": "application/pdf" }
  ],
  "host": {
    "reminders": [],
    "schedules": [],
    "ownerReady": true,
    "reminderSummary": "喝水：开着 · 久坐：关着"
  }
}
```

Response includes `text`, `cycles`, `toolsUsed`, `skillsUsed`, `trace`, `hostActions`.

### Manual check (WeChat files)

1. ClawBot logged in + auto-reply on → send PDF/docx/txt/md with「帮我总结」.
2. Expect a real summary; file lands under `~/Library/Application Support/com.fluffnest.deskpet/wechat-media/`.
3. Image-only message → polite「暂不支持识读」; oversized (>10MB) → error text, no crash.

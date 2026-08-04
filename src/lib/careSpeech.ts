/** Care-alert speech: Edge neural TTS via Rust afplay + unique LLM lines. */

import { invoke } from "@tauri-apps/api/core";

type SpeechSession = {
  gen: number;
  queue: string[];
  /** Already spoken or queued — never play these again this session */
  used: Set<string>;
  playing: boolean;
  personality: string;
  kind: "water" | "stretch";
};

let session: SpeechSession | null = null;
let generation = 0;

function normKey(s: string): string {
  return s
    .replace(/[\s，,。.!！？?～~…、；;：:"'「」『』]/g, "")
    .toLowerCase();
}

async function speakNative(text: string, personality: string): Promise<void> {
  await invoke("speak_speech", { text, personality });
}

function speakWebFallback(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 0.95;
      u.pitch = 1.02;
      const voices = window.speechSynthesis.getVoices();
      const zh =
        voices.find((v) => /zh[-_]?CN/i.test(v.lang) && /ting|晓|mei|婷/i.test(v.name)) ??
        voices.find((v) => /zh[-_]?CN|Chinese/i.test(v.lang));
      if (zh) u.voice = zh;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

async function playOne(s: SpeechSession, text: string): Promise<void> {
  try {
    await speakNative(text, s.personality);
  } catch (err) {
    console.warn("[careSpeech] Edge TTS failed, fallback to Web Speech", err);
    await speakWebFallback(text);
  }
}

/** Push only fresh copy — skip duplicates already used/queued. */
function enqueueUnique(s: SpeechSession, line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const key = normKey(trimmed);
  if (!key || s.used.has(key)) return false;
  s.used.add(key);
  s.queue.push(trimmed);
  return true;
}

function avoidList(s: SpeechSession): string[] {
  return [...s.used];
}

async function drainQueue(s: SpeechSession) {
  if (s.playing) return;
  s.playing = true;
  try {
    while (s.gen === generation) {
      const next = s.queue.shift();
      if (!next) break;
      try {
        await playOne(s, next);
      } catch {
        /* keep going */
      }
      if (s.gen !== generation) break;
      await new Promise((r) => window.setTimeout(r, 220 + Math.random() * 180));
    }
  } finally {
    s.playing = false;
    if (s.gen === generation && s.queue.length) {
      void drainQueue(s);
    }
  }
}

/** Local variety bank — only unused lines, never recycle the same seed. */
function localFreshLines(kind: "water" | "stretch", used: Set<string>, n: number): string[] {
  const bank =
    kind === "water"
      ? [
          "欸，喝一小口水好不好？",
          "喉咙有点干了吧，先润润。",
          "水杯在哪儿呢，找一找嘛。",
          "补点水，眼睛也会舒服一点。",
          "忙归忙，别把水给忘了哦。",
          "来，跟我咕咚一口。",
          "休息三秒，先把水喝了。",
          "今天水分达标了吗？还差一点。",
          "我陪你，喝完再继续干活。",
          "水比咖啡更救命，信我。",
        ]
      : [
          "坐太久啦，站起来扭两下。",
          "肩膀酸不酸？伸个懒腰呗。",
          "离开椅子走两步好不好？",
          "脖子转一圈，世界都亮了。",
          "血流通通，别窝成一团。",
          "起来活动下，我陪你晃一圈。",
          "腰在抗议了，站一站嘛。",
          "深呼吸，再轻轻转转肩。",
          "久坐警报解除方式：走动。",
          "给腿松松绑，走几步就好。",
        ];
  const out: string[] = [];
  for (const line of bank) {
    if (out.length >= n) break;
    const key = normKey(line);
    if (!used.has(key)) {
      used.add(key);
      out.push(line);
    }
  }
  return out;
}

export function stopCareSpeech() {
  generation += 1;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
  if (session) {
    session.gen = generation;
    session.queue = [];
    session = null;
  }
}

export function speakCareAlert(
  text: string,
  muted: boolean,
  personality = "clingy",
) {
  if (muted) return;
  const line = text.trim();
  if (!line) return;

  if (!session || session.gen !== generation) {
    generation += 1;
    const used = new Set<string>();
    session = {
      gen: generation,
      queue: [],
      used,
      playing: false,
      personality,
      kind: "water",
    };
    enqueueUnique(session, line);
    void drainQueue(session);
    return;
  }

  session.personality = personality;
  if (enqueueUnique(session, line)) void drainQueue(session);
}

export function startCareSpeechLoop(opts: {
  kind: "water" | "stretch";
  personality: string;
  muted: boolean;
  seedLines: string[];
  durationMs: number;
}) {
  if (opts.muted) return;

  stopCareSpeech();
  const gen = generation;
  const used = new Set<string>();
  session = {
    gen,
    queue: [],
    used,
    playing: false,
    personality: opts.personality,
    kind: opts.kind,
  };

  // At most one seed opener — never replay it later
  const seed = opts.seedLines.find((s) => s.trim());
  if (seed) enqueueUnique(session, seed);
  void drainQueue(session);

  const deadline = Date.now() + opts.durationMs;

  const fetchFresh = async (count: number) => {
    if (gen !== generation || !session) return;
    try {
      const lines = await invoke<string[]>("generate_care_voice_lines", {
        kind: opts.kind,
        count,
        avoid: avoidList(session),
      });
      if (gen !== generation || !session) return;
      let added = 0;
      for (const line of lines) {
        if (enqueueUnique(session, line)) added += 1;
      }
      if (added === 0) {
        for (const line of localFreshLines(opts.kind, session.used, count)) {
          session.queue.push(line);
          added += 1;
        }
      }
      if (added > 0) void drainQueue(session);
    } catch {
      if (gen !== generation || !session) return;
      const fallback = localFreshLines(opts.kind, session.used, count);
      if (fallback.length) {
        session.queue.push(...fallback);
        void drainQueue(session);
      }
    }
  };

  void (async () => {
    await fetchFresh(8);
    while (gen === generation && Date.now() < deadline - 2500) {
      await new Promise((r) => window.setTimeout(r, 7000));
      if (gen !== generation || !session) return;
      if (session.queue.length >= 2) continue;
      await fetchFresh(5);
    }
  })();
}

export function enqueueCareSpeech(text: string) {
  if (!session || session.gen !== generation) return;
  if (enqueueUnique(session, text)) void drainQueue(session);
}

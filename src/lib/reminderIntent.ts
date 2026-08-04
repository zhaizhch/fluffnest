/** Parse casual Chinese reminder phrases from quick-chat input. */

export type ReminderIntent =
  | { kind: "water"; intervalMinutes: number }
  | { kind: "stretch"; intervalMinutes: number }
  | { kind: "meeting"; title: string; at: Date };

function looksLikeReminder(text: string): boolean {
  return /提醒|开会|会议|喝水|喝杯水|久坐|起身|伸懒腰|伸展|活动一下|别忘了|叫我/.test(
    text,
  );
}

/** Parse "今天/明天/后天 HH:mm" / "HH:mm" / "下午3点" etc. */
export function parseLocalDateTime(text: string, now = new Date()): Date | null {
  const t = text.trim();

  // ISO-ish or datetime-local fragments
  const iso = t.match(
    /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/,
  );
  if (iso) {
    const d = new Date(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4]),
      Number(iso[5]),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let dayOffset = 0;
  if (/后天/.test(t)) dayOffset = 2;
  else if (/明天|明日/.test(t)) dayOffset = 1;
  else if (/今天|今日/.test(t)) dayOffset = 0;

  // 下午3点 / 晚上8点半 / 上午10:30 / 15:00
  let hour: number | null = null;
  let minute = 0;

  const hm = t.match(/(?:^|[^\d])(\d{1,2})\s*[:：点]\s*(\d{1,2})?/);
  if (hm) {
    hour = Number(hm[1]);
    minute = hm[2] ? Number(hm[2]) : /半/.test(t) ? 30 : 0;
  } else {
    const hOnly = t.match(/(\d{1,2})\s*点半?/);
    if (hOnly) {
      hour = Number(hOnly[1]);
      minute = /半/.test(t) ? 30 : 0;
    }
  }

  if (hour === null) return null;
  if (/下午|晚上|傍晚/.test(t) && hour < 12) hour += 12;
  if (/中午/.test(t) && hour < 11) hour = 12;
  if (/凌晨|早上|上午/.test(t) && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) return null;

  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);

  // If only time given and already passed today, roll to tomorrow
  if (dayOffset === 0 && !/今天|今日/.test(t) && d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function parseInterval(text: string, fallback: number): number {
  const m =
    text.match(/每\s*(\d{1,3})\s*(分钟|分|小时|时)/) ||
    text.match(/(\d{1,3})\s*(分钟|分|小时|时)\s*(一次|提醒)?/);
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  if (m[2].startsWith("小时") || m[2] === "时") return Math.min(24 * 60, n * 60);
  return Math.min(24 * 60, Math.max(5, n));
}

export function parseReminderIntent(text: string): ReminderIntent | null {
  const raw = text.trim();
  if (!raw || !looksLikeReminder(raw)) return null;

  if (/喝水|喝杯水|补水|喝一口/.test(raw)) {
    return { kind: "water", intervalMinutes: parseInterval(raw, 60) };
  }

  if (/久坐|起身|伸懒腰|伸展|活动一下|站起来|走动/.test(raw)) {
    return { kind: "stretch", intervalMinutes: parseInterval(raw, 45) };
  }

  if (/会议|开会|站会|约见|面试/.test(raw)) {
    const at = parseLocalDateTime(raw);
    if (!at) return null;
    let title = "会议";
    const named = raw.match(
      /(?:提醒我)?(?:去)?(.{1,16}?)(?:会议|开会|站会)/,
    );
    if (named?.[1] && !/^(明天|今天|后天|下午|上午|晚上)/.test(named[1].trim())) {
      title = named[1].trim() || "会议";
    }
    const quoted = raw.match(/[「『"“](.+?)[」』"”]/);
    if (quoted?.[1]) title = quoted[1].trim();
    return { kind: "meeting", title, at };
  }

  // Generic "提醒我 … 在时间"
  if (/提醒/.test(raw)) {
    const at = parseLocalDateTime(raw);
    if (at) {
      const title =
        raw
          .replace(/提醒我?/, "")
          .replace(/明天|今天|后天|上午|下午|晚上|凌晨|中午/g, "")
          .replace(/\d{1,2}\s*[:：点]\s*\d{0,2}|半/g, "")
          .replace(/[，。！？\s]+/g, " ")
          .trim()
          .slice(0, 20) || "提醒";
      return { kind: "meeting", title, at };
    }
  }

  return null;
}

export function reminderConfirmText(intent: ReminderIntent): string {
  if (intent.kind === "water") {
    return `好，每 ${intent.intervalMinutes} 分钟提醒你喝水～`;
  }
  if (intent.kind === "stretch") {
    return `好，每 ${intent.intervalMinutes} 分钟叫你起来活动～`;
  }
  const t = intent.at;
  const stamp = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return `记下了：「${intent.title}」· ${stamp}`;
}

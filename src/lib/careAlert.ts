import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import {
  buildCareDanceRoutine,
  type CareDancePhrase,
  type CareDanceRoutine,
  type CareRoamStyle,
  type DancePose,
} from "./careDance";

export type CareAlertKind = "water" | "stretch";
export type { CareRoamStyle, CareDancePhrase, CareDanceRoutine, DancePose };

export type CareAlertPlan = {
  kind: CareAlertKind;
  headline: string;
  subline: string;
  speakText: string;
  accent: string;
  dance: CareDanceRoutine;
  /** How long the performance lasts */
  durationMs: number;
  /** Window size while alerting (bigger presence) */
  windowSize: { w: number; h: number };
};

const ALERT_LINES: Record<
  CareAlertKind,
  { headlines: string[]; sublines: string[]; speak: string[] }
> = {
  water: {
    headlines: ["该喝水啦！", "咕咚时间到！", "水杯呢水杯呢！", "补水警报～"],
    sublines: [
      "站起来喝一大口，宠物陪你跳一曲",
      "眼睛干了？先润润喉咙",
      "水才是今日主打歌",
    ],
    speak: [
      "欸，忙了这么久，先喝一口水吧。我陪你一起动一动。",
      "喝点水好不好？别把自己渴着了哦。",
      "来，起来喝一小口。嗯，这样就舒服多了。",
    ],
  },
  stretch: {
    headlines: ["久坐警报！", "起来活动啦！", "伸个懒腰！", "走动时间～"],
    sublines: [
      "肩颈在抗议，跟宠物一起热热身",
      "离开椅子转一圈，世界更大一点",
      "站起来扭两下，血流通通畅畅",
    ],
    speak: [
      "坐太久啦，起来活动一下吧。跟我一起伸个懒腰。",
      "肩膀是不是有点僵？走走也好，扭一扭也好。",
      "先离开椅子转一圈，好不好？我陪着你。",
    ],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function buildCareAlertPlan(
  kind: CareAlertKind,
  speciesId: string,
  _petName: string,
): CareAlertPlan {
  const pack = ALERT_LINES[kind];
  const dance = buildCareDanceRoutine(kind, speciesId);
  const headline = pick(pack.headlines);
  const subline = pick(pack.sublines);
  const speakText = pick(pack.speak);

  return {
    kind,
    headline,
    subline,
    speakText,
    accent: kind === "water" ? "#6eb5c0" : "#d4a06a",
    dance,
    durationMs: dance.totalMs + 800,
    windowSize: { w: 380, h: 460 },
  };
}

export function resolveCareAlertKind(
  typeOrTitle: string,
): CareAlertKind | null {
  const t = typeOrTitle.toLowerCase();
  if (t.includes("water") || t.includes("喝水") || t.includes("补水")) {
    return "water";
  }
  if (
    t.includes("stretch") ||
    t.includes("久坐") ||
    t.includes("起身") ||
    t.includes("伸")
  ) {
    return "stretch";
  }
  return null;
}

type ScreenRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Pt = { x: number; y: number };

async function screenPlayArea(
  winW: number,
  winH: number,
): Promise<ScreenRect> {
  const margin = 24;
  try {
    const mon = await currentMonitor();
    if (mon) {
      const scale = mon.scaleFactor;
      const x = mon.position.x / scale;
      const y = mon.position.y / scale;
      const w = mon.size.width / scale;
      const h = mon.size.height / scale;
      return {
        minX: x + margin,
        minY: y + margin + 28,
        maxX: x + w - winW - margin,
        maxY: y + h - winH - margin,
      };
    }
  } catch {
    /* fall through */
  }
  return {
    minX: margin,
    minY: margin + 40,
    maxX: 1280 - winW,
    maxY: 800 - winH,
  };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Smoother than cubic easeInOut — gentler acceleration / deceleration. */
function smootherstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

/** Style-tuned travel distance for one glide/arc phrase. */
function travelDist(
  style: CareRoamStyle,
  locomotion: CareDancePhrase["locomotion"],
) {
  if (locomotion === "arc") {
    switch (style) {
      case "dash":
        return 220;
      case "orbit":
        return 280;
      case "weave":
        return 240;
      default:
        return 200;
    }
  }
  switch (style) {
    case "dash":
      return 560;
    case "weave":
      return 380;
    case "orbit":
      return 320;
    default:
      return 300;
  }
}

function phraseTarget(
  x: number,
  y: number,
  heading: number,
  area: ScreenRect,
  style: CareRoamStyle,
  phrase: CareDancePhrase,
  turnSign: number,
  orbitAngle: number,
): {
  target: Pt;
  control: Pt;
  heading: number;
  turnSign: number;
  orbitAngle: number;
} {
  const spanX = Math.max(80, area.maxX - area.minX);
  const spanY = Math.max(60, area.maxY - area.minY);
  const cx = (area.minX + area.maxX) / 2;
  const cy = (area.minY + area.maxY) / 2;

  if (phrase.locomotion === "hold") {
    return {
      target: { x, y },
      control: { x, y },
      heading,
      turnSign,
      orbitAngle,
    };
  }

  if (phrase.locomotion === "arc" || style === "orbit") {
    const rx = spanX * (phrase.locomotion === "arc" ? 0.22 : 0.36);
    const ry = spanY * (phrase.locomotion === "arc" ? 0.18 : 0.3);
    const sweep = turnSign * (phrase.locomotion === "arc" ? 1.1 : 0.85);
    const nextAng = orbitAngle + sweep;
    const tx = clamp(cx + Math.cos(nextAng) * rx, area.minX, area.maxX);
    const ty = clamp(cy + Math.sin(nextAng) * ry, area.minY, area.maxY);
    const mid = orbitAngle + sweep / 2;
    const control = {
      x: clamp(cx + Math.cos(mid) * rx * 1.08, area.minX, area.maxX),
      y: clamp(cy + Math.sin(mid) * ry * 1.08, area.minY, area.maxY),
    };
    return {
      target: { x: tx, y: ty },
      control,
      heading: Math.atan2(ty - y, tx - x),
      turnSign,
      orbitAngle: nextAng,
    };
  }

  // Glide: keep heading, gentle S-curve
  let sign = turnSign;
  if (Math.random() < 0.22) sign *= -1;
  const flatBias = style === "dash" ? 0.75 : style === "amble" ? 0.45 : 0.3;
  let h = wrapAngle(heading + sign * (0.2 + Math.random() * 0.45));
  if (flatBias > 0) {
    const flat = Math.abs(h) < Math.PI / 2 ? 0 : Math.PI;
    h = wrapAngle(lerp(h, flat, flatBias * 0.5));
  }

  const dist = travelDist(style, "glide");
  let tx = x + Math.cos(h) * dist;
  let ty = y + Math.sin(h) * dist * (style === "dash" ? 0.22 : 0.4);
  tx = lerp(tx, cx, 0.1);
  ty = lerp(ty, cy, 0.14);
  tx = clamp(tx, area.minX, area.maxX);
  ty = clamp(ty, area.minY, area.maxY);

  if (tx <= area.minX + 2 || tx >= area.maxX - 2) {
    h = wrapAngle(Math.PI - h);
    sign *= -1;
    tx = clamp(x + Math.cos(h) * dist * 0.8, area.minX, area.maxX);
    ty = clamp(y + Math.sin(h) * dist * 0.3, area.minY, area.maxY);
  }

  const mx = (x + tx) / 2;
  const my = (y + ty) / 2;
  const px = -(ty - y);
  const py = tx - x;
  const plen = Math.hypot(px, py) || 1;
  const bulge = (style === "weave" ? 0.3 : 0.14) * dist * sign;
  const control = {
    x: clamp(mx + (px / plen) * bulge, area.minX, area.maxX),
    y: clamp(my + (py / plen) * bulge, area.minY, area.maxY),
  };

  return {
    target: { x: tx, y: ty },
    control,
    heading: Math.atan2(ty - y, tx - x),
    turnSign: sign,
    orbitAngle,
  };
}

/**
 * Follow a bezier using wall-clock timing (rAF) so motion stays smooth
 * even if a frame is late — no stepped sleep jitter.
 */
async function followBezierTimed(
  win: Awaited<ReturnType<typeof getCurrentWindow>>,
  from: Pt,
  control: Pt,
  to: Pt,
  durationMs: number,
  cancelled: () => boolean,
  onFacing?: (f: "left" | "right") => void,
): Promise<Pt> {
  const duration = Math.max(800, durationMs);
  const start = performance.now();
  let cur: Pt = { ...from };
  let lastFacing: "left" | "right" | null = null;
  let facingHoldUntil = 0;

  const sample = (t: number): Pt => {
    const e = smootherstep(t);
    const u = 1 - e;
    return {
      x: u * u * from.x + 2 * u * e * control.x + e * e * to.x,
      y: u * u * from.y + 2 * u * e * control.y + e * e * to.y,
    };
  };

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (cancelled()) {
        resolve();
        return;
      }
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const next = sample(t);
      const dx = next.x - cur.x;

      // Facing hysteresis — avoid left/right flicker on tiny deltas
      if (Math.abs(dx) > 2.5 && now >= facingHoldUntil) {
        const face: "left" | "right" = dx >= 0 ? "right" : "left";
        if (face !== lastFacing) {
          lastFacing = face;
          facingHoldUntil = now + 480;
          onFacing?.(face);
        }
      }

      cur = next;
      void win.setPosition(new LogicalPosition(next.x, next.y)).catch(() => undefined);

      if (t >= 1) {
        resolve();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });

  return { ...to };
}

/**
 * Perform a choreographed care dance: each phrase drives pose + optional travel.
 * Returns a cancel function.
 */
export function startCareRoam(opts: {
  durationMs: number;
  windowSize: { w: number; h: number };
  style?: CareRoamStyle;
  phrases: CareDancePhrase[];
  onPhrase?: (phrase: CareDancePhrase, index: number) => void;
  onStep?: (facing: "left" | "right") => void;
  onDone?: () => void;
}): () => void {
  let cancelled = false;
  const win = getCurrentWindow();
  let restore: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null = null;

  const run = async () => {
    try {
      const scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      const size = await win.outerSize();
      restore = {
        x: pos.x / scale,
        y: pos.y / scale,
        w: size.width / scale,
        h: size.height / scale,
      };

      await win.setSize(new LogicalSize(opts.windowSize.w, opts.windowSize.h));
      const area = await screenPlayArea(opts.windowSize.w, opts.windowSize.h);
      const style = opts.style ?? "amble";

      let x = clamp(restore.x, area.minX, area.maxX);
      let y = clamp(restore.y, area.minY, area.maxY);
      await win.setPosition(new LogicalPosition(x, y));

      const midX = (area.minX + area.maxX) / 2;
      let heading = x < midX ? 0 : Math.PI;
      let turnSign = Math.random() < 0.5 ? 1 : -1;
      let orbitAngle = Math.atan2(y - (area.minY + area.maxY) / 2, x - midX);

      for (let i = 0; i < opts.phrases.length; i++) {
        if (cancelled) break;
        const phrase = opts.phrases[i]!;
        opts.onPhrase?.(phrase, i);

        // Soft settle between phrases so pose changes don't feel abrupt
        if (i > 0) await sleep(180);

        const next = phraseTarget(
          x,
          y,
          heading,
          area,
          style,
          phrase,
          turnSign,
          orbitAngle,
        );
        heading = next.heading;
        turnSign = next.turnSign;
        orbitAngle = next.orbitAngle;

        if (phrase.locomotion === "hold") {
          await sleep(Math.max(400, phrase.durationMs - (i > 0 ? 180 : 0)));
        } else {
          opts.onStep?.(next.target.x >= x ? "right" : "left");
          const end = await followBezierTimed(
            win,
            { x, y },
            next.control,
            next.target,
            Math.max(800, phrase.durationMs - (i > 0 ? 180 : 0)),
            () => cancelled,
            opts.onStep,
          );
          x = end.x;
          y = end.y;
        }
      }
    } catch {
      /* ignore */
    } finally {
      if (restore) {
        try {
          await win.setSize(new LogicalSize(restore.w, restore.h));
          await win.setPosition(new LogicalPosition(restore.x, restore.y));
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) opts.onDone?.();
    }
  };

  void run();
  return () => {
    cancelled = true;
  };
}

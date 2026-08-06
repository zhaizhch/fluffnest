/**
 * Live2D cats — Tororo (白) & Hijiki (黑)
 * Framing uses Cubism canvas size + drawable bounds (two-pass) so the full
 * body (head / tail) stays inside the transparent pet window.
 * https://www.live2d.com/en/learn/sample/tororo-hijiki/
 */
import { Application, extensions } from "pixi.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

const CUBISM_CORE_URL = "/vendor/live2dcubismcore.min.js";

/** Logical canvas size for the Live2D stage (fits in 340×420 pet window). */
const VIEW_W = 300;
const VIEW_H = 340;

const MODEL_BY_SPECIES: Record<string, { url: string; label: string }> = {
  tororo: {
    url: "/pets/tororo/runtime/tororo.model3.json",
    label: "とろろ",
  },
  hijiki: {
    url: "/pets/hijiki/runtime/hijiki.model3.json",
    label: "ひじき",
  },
  nuotuan: {
    url: "/pets/tororo/runtime/tororo.model3.json",
    label: "とろろ",
  },
};

type Props = {
  species?: string;
  behavior: string;
  facing?: "left" | "right";
  /** Ignored — Live2D uses a fixed view size for stable framing. */
  size?: number;
};

type Live2DModelInstance = {
  anchor: { set: (x: number, y?: number) => void };
  position: { set: (x: number, y: number) => void };
  scale: { set: (x: number, y?: number) => void; x: number; y: number };
  rotation: number;
  width: number;
  height: number;
  internalModel?: {
    originalWidth?: number;
    originalHeight?: number;
    width?: number;
    height?: number;
  };
  getBounds: (skipUpdate?: boolean) => {
    width: number;
    height: number;
    x: number;
    y: number;
  };
  destroy: (opts?: boolean | { children?: boolean; texture?: boolean }) => void;
  motion: (
    group: string,
    index?: number,
    priority?: number,
    opts?: { loop?: boolean },
  ) => Promise<unknown>;
  focus: (x: number, y: number, instant?: boolean) => void;
};

let pluginReady: Promise<void> | null = null;
let cubismReady: Promise<void> | null = null;
let pluginRegistered = false;

function ensureCubismCore(): Promise<void> {
  if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
    return Promise.resolve();
  }
  if (cubismReady) return cubismReady;
  cubismReady = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CUBISM_CORE_URL}"]`,
    );
    if (existing) {
      if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Cubism core load failed")),
      );
      return;
    }
    const s = document.createElement("script");
    s.src = CUBISM_CORE_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Cubism core load failed"));
    document.head.appendChild(s);
  });
  return cubismReady;
}

async function ensureLive2DPlugin(): Promise<void> {
  if (pluginReady) return pluginReady;
  pluginReady = (async () => {
    await ensureCubismCore();
    const { Live2DPlugin } = await import("untitled-pixi-live2d-engine/cubism");
    if (!pluginRegistered) {
      extensions.add(Live2DPlugin);
      pluginRegistered = true;
    }
  })().catch((err) => {
    pluginReady = null;
    throw err;
  });
  return pluginReady;
}

function motionFor(behavior: string): {
  group: string;
  index?: number;
  loop?: boolean;
} {
  switch (behavior) {
    case "sleep":
    case "yawn":
      return { group: "Idle", index: 0, loop: true };
    case "wave":
    case "cheer":
    case "encore":
    case "pat":
    case "poke":
    case "tickle":
    case "hug":
    case "nuzzle":
    case "react":
      return { group: "Tap", index: 0 };
    case "spin":
    case "dance":
    case "magic":
    case "ultimate":
    case "sparkle":
      return { group: "FlickUp", index: 0 };
    case "feed":
    case "drink":
    case "tea":
      return { group: "FlickDown", index: 0 };
    case "walk":
    case "run":
      return { group: "Flick", index: 0 };
    default:
      return { group: "Idle", index: 0, loop: true };
  }
}

function readSize(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) && n > 1 ? n : fallback;
}

/**
 * Fit the whole cat into the view.
 * Tororo/Hijiki often report tiny early drawable bounds → old code overscaled
 * and clipped the head against the transparent window's overflow:hidden.
 */
function layoutModel(
  model: Live2DModelInstance,
  viewW: number,
  viewH: number,
  facing: "left" | "right",
) {
  const im = model.internalModel;
  const canvasW = readSize(
    im?.originalWidth ?? im?.width,
    readSize(model.width, 1000),
  );
  const canvasH = readSize(
    im?.originalHeight ?? im?.height,
    readSize(model.height, 1000),
  );

  model.anchor.set(0.5, 0.5);
  model.rotation = 0;
  model.scale.set(1, 1);
  model.position.set(viewW / 2, viewH / 2);

  // Pass 1: fit by Cubism canvas (stable for these sample models).
  let fit = Math.min((viewW * 0.9) / canvasW, (viewH * 0.9) / canvasH);

  // Cap absurd scales if canvas metadata is missing/wrong.
  fit = Math.min(fit, 1.2);

  const face = facing === "left" ? -1 : 1;
  model.scale.set(fit * face, fit);
  model.position.set(viewW / 2, viewH * 0.55);

  // Pass 2: if drawable still overflows the view, shrink until it fits.
  const bounds = model.getBounds(true);
  const bw = Math.max(Math.abs(bounds.width) || 0, 1);
  const bh = Math.max(Math.abs(bounds.height) || 0, 1);
  const overflowX = bw / (viewW * 0.92);
  const overflowY = bh / (viewH * 0.92);
  const overflow = Math.max(overflowX, overflowY, 1);
  if (overflow > 1.02) {
    fit /= overflow;
    model.scale.set(fit * face, fit);
    model.position.set(viewW / 2, viewH * 0.55);
  }
}

export function Live2DPet({
  species = "tororo",
  behavior,
  facing = "right",
}: Props) {
  const meta = MODEL_BY_SPECIES[species] ?? MODEL_BY_SPECIES.tororo!;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const behaviorRef = useRef(behavior);
  const facingRef = useRef(facing);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState("");

  behaviorRef.current = behavior;
  facingRef.current = facing;

  const applyLayout = useCallback(() => {
    const model = modelRef.current;
    if (!model) return;
    layoutModel(model, VIEW_W, VIEW_H, facingRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvasHost = canvasHostRef.current;
    if (!canvasHost) return;

    setStatus("loading");
    setDetail("");
    const app = new Application();
    appRef.current = app;

    (async () => {
      try {
        await ensureLive2DPlugin();
        if (cancelled) return;

        await app.init({
          width: VIEW_W,
          height: VIEW_H,
          backgroundAlpha: 0,
          antialias: true,
          preference: "webgl",
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });
        if (cancelled) {
          app.destroy(true);
          return;
        }

        canvasHost.replaceChildren(app.canvas);

        const { Live2DModel } = await import(
          "untitled-pixi-live2d-engine/cubism"
        );
        const model = (await Live2DModel.from(meta.url, {
          autoHitTest: false,
          autoFocus: false,
          // canvas anchor matches Cubism layout; more stable for Tororo/Hijiki
          anchorMode: "canvas",
        })) as unknown as Live2DModelInstance;
        if (cancelled) {
          model.destroy(true);
          return;
        }

        app.stage.addChild(model as never);
        modelRef.current = model;

        // Settle meshes, then frame; re-frame a few times as bounds warm up.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (cancelled) return;
        applyLayout();

        const pose = motionFor(behaviorRef.current);
        void model.motion(pose.group, pose.index, 2, { loop: pose.loop });

        for (const ms of [50, 150, 400]) {
          await new Promise<void>((r) => setTimeout(r, ms));
          if (cancelled) return;
          applyLayout();
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        console.error("[Live2DPet]", err);
        if (!cancelled) {
          setStatus("error");
          setDetail(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      modelRef.current = null;
      try {
        app.destroy(true, { children: true });
      } catch {
        /* ignore */
      }
      appRef.current = null;
      canvasHost.replaceChildren();
    };
  }, [meta.url, applyLayout]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || status !== "ready") return;
    const pose = motionFor(behavior);
    void model.motion(pose.group, pose.index, 2, { loop: pose.loop });
  }, [behavior, status]);

  useEffect(() => {
    if (status !== "ready") return;
    applyLayout();
  }, [facing, status, applyLayout]);

  const onPointerMove = (e: ReactPointerEvent) => {
    const model = modelRef.current;
    const host = hostRef.current;
    if (!model || !host) return;
    const rect = host.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    model.focus(x, -y);
  };

  return (
    <div
      ref={hostRef}
      className={`live2d-pet live2d-pet--${status}`}
      style={{ width: VIEW_W, height: VIEW_H }}
      onPointerMove={onPointerMove}
      role="img"
      aria-label={meta.label}
    >
      <div ref={canvasHostRef} className="live2d-pet-canvas" />
      {status !== "ready" && (
        <div className="live2d-pet-status" aria-live="polite">
          {status === "loading"
            ? `${meta.label}加载中…`
            : `加载失败\n${detail}`}
        </div>
      )}
    </div>
  );
}

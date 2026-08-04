import { useEffect, useRef, useState } from "react";
import {
  ANIM_ROWS,
  COLS,
  FRAME_H,
  FRAME_W,
  behaviorToAnim,
  type AtlasAnim,
} from "../lib/codexAtlas";
import { spriteFor } from "../lib/petCatalog";
import { nextBlinkDelayMs } from "./quietSchedule";

type Props = {
  species: string;
  behavior: string;
  facing?: "left" | "right";
  size?: number;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sprite load failed: ${src}`));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function resolveAnim(
  anim: AtlasAnim,
  version: number,
): { row: number; frames: number } {
  const meta = ANIM_ROWS[anim] ?? ANIM_ROWS.idle;
  const maxRows = version >= 2 ? 11 : 9;
  if (meta.row >= maxRows) return ANIM_ROWS.idle;
  return { row: meta.row, frames: Math.min(meta.frames, COLS) };
}

function paint(
  canvas: HTMLCanvasElement | null,
  img: HTMLImageElement,
  version: number,
  anim: AtlasAnim,
  frame: number,
  drawW: number,
  drawH: number,
) {
  if (!canvas) return;
  // Reuse the same 2d context — recreating every frame is expensive.
  let ctx = (canvas as HTMLCanvasElement & {
    __petCtx?: CanvasRenderingContext2D | null;
  }).__petCtx;
  if (!ctx) {
    ctx = canvas.getContext("2d", { alpha: true });
    (canvas as HTMLCanvasElement & {
      __petCtx?: CanvasRenderingContext2D | null;
    }).__petCtx = ctx;
  }
  if (!ctx) return;
  const { row, frames } = resolveAnim(anim, version);
  const col = ((frame % frames) + frames) % frames;
  if (canvas.width !== drawW || canvas.height !== drawH) {
    canvas.width = drawW;
    canvas.height = drawH;
    // resizing clears the cached context binding on some engines
    ctx = canvas.getContext("2d", { alpha: true });
    (canvas as HTMLCanvasElement & {
      __petCtx?: CanvasRenderingContext2D | null;
    }).__petCtx = ctx;
    if (!ctx) return;
  }
  ctx.clearRect(0, 0, drawW, drawH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    img,
    col * FRAME_W,
    row * FRAME_H,
    FRAME_W,
    FRAME_H,
    0,
    0,
    drawW,
    drawH,
  );
}

/** Canvas 2D Codex-atlas pet. */
export function PixiPet({
  species,
  behavior,
  facing = "right",
  size = 192,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef(0);
  const animRef = useRef<AtlasAnim>("idle");
  const versionRef = useRef(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const face = spriteFor(species);
  const anim = behaviorToAnim(behavior, facing);
  const isIdle = behavior === "idle";
  const drawW = Math.max(48, size);
  const drawH = Math.round(drawW * (FRAME_H / FRAME_W));

  animRef.current = anim;

  useEffect(() => {
    let alive = true;
    const version = face.spriteVersionNumber ?? 1;
    versionRef.current = version;
    frameRef.current = 0;
    setStatus("loading");

    loadImage(face.src)
      .then((img) => {
        if (!alive) return;
        imgRef.current = img;
        setStatus("ready");
        requestAnimationFrame(() => {
          paint(canvasRef.current, img, version, animRef.current, 0, drawW, drawH);
        });
      })
      .catch((e) => {
        console.error(e);
        if (alive) setStatus("error");
      });

    return () => {
      alive = false;
    };
  }, [face.src, face.spriteVersionNumber, drawW, drawH]);

  // Reset frame when the atlas row changes, without tearing down the timer.
  useEffect(() => {
    if (status !== "ready" || isIdle) return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    frameRef.current = 0;
    paint(canvas, img, versionRef.current, animRef.current, 0, drawW, drawH);
  }, [anim, status, isIdle, drawW, drawH]);

  /**
   * Idle: hold eyes-open (frame 0) ~1.4–2.1s, then play one idle atlas cycle.
   * Soft hops / walks are driven by PetApp, not this loop.
   * Interval only restarts on idle↔action mode switch — not every behavior tick.
   */
  useEffect(() => {
    if (status !== "ready") return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    if (!isIdle) {
      frameRef.current = 0;
      paint(canvas, img, versionRef.current, animRef.current, 0, drawW, drawH);
      const id = window.setInterval(() => {
        const sheet = imgRef.current;
        const c = canvasRef.current;
        if (!sheet || !c) return;
        const { frames } = resolveAnim(animRef.current, versionRef.current);
        frameRef.current = (frameRef.current + 1) % frames;
        paint(
          c,
          sheet,
          versionRef.current,
          animRef.current,
          frameRef.current,
          drawW,
          drawH,
        );
      }, 120);
      return () => window.clearInterval(id);
    }

    // Quiet idle with natural blinks from idle row
    let phase: "hold" | "blink" = "hold";
    let holdUntil = Date.now() + nextBlinkDelayMs();
    frameRef.current = 0;
    paint(canvas, img, versionRef.current, "idle", 0, drawW, drawH);

    const BLINK_FRAME_MS = 90;
    const id = window.setInterval(() => {
      const sheet = imgRef.current;
      const c = canvasRef.current;
      if (!sheet || !c) return;
      const { frames } = resolveAnim("idle", versionRef.current);
      const now = Date.now();

      if (phase === "hold") {
        if (now < holdUntil) {
          if (frameRef.current !== 0) {
            frameRef.current = 0;
            paint(c, sheet, versionRef.current, "idle", 0, drawW, drawH);
          }
          return;
        }
        phase = "blink";
        frameRef.current = 0;
      }

      frameRef.current += 1;
      if (frameRef.current >= frames) {
        phase = "hold";
        frameRef.current = 0;
        holdUntil = now + nextBlinkDelayMs();
        paint(c, sheet, versionRef.current, "idle", 0, drawW, drawH);
        return;
      }
      paint(
        c,
        sheet,
        versionRef.current,
        "idle",
        frameRef.current,
        drawW,
        drawH,
      );
    }, BLINK_FRAME_MS);

    return () => window.clearInterval(id);
  }, [status, drawW, drawH, isIdle]);

  const mirror = facing === "left" && anim !== "runningLeft";

  return (
    <div
      className={`pixi-pet behavior-${behavior}`}
      title={face.label}
      data-species={species}
      data-status={status}
      data-idle={isIdle ? "1" : "0"}
      style={{
        width: drawW,
        height: drawH,
        transform: mirror ? "scaleX(-1)" : undefined,
        position: "relative",
      }}
    >
      {status !== "ready" && (
        <div
          className={`pixi-pet-fallback${status === "error" ? " error" : ""}`}
          aria-hidden
        >
          {status === "error" ? "!" : "…"}
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={drawW}
        height={drawH}
        style={{
          width: drawW,
          height: drawH,
          display: "block",
          opacity: status === "ready" ? 1 : 0,
        }}
      />
    </div>
  );
}

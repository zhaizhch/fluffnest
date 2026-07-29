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
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const { row, frames } = resolveAnim(anim, version);
  const col = ((frame % frames) + frames) % frames;
  if (canvas.width !== drawW || canvas.height !== drawH) {
    canvas.width = drawW;
    canvas.height = drawH;
  }
  ctx.clearRect(0, 0, drawW, drawH);
  ctx.imageSmoothingEnabled = true;
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

/**
 * Quiet idle must NOT loop the atlas idle row — those sheets usually embed
 * blinks every ~0.7s. Hold frame 0 with eyes open; only animate on actions.
 */
function shouldHold(behavior: string): boolean {
  return behavior === "idle";
}

/** Canvas 2D Codex-atlas pet (no skin / growth). */
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
  const holdRef = useRef(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const face = spriteFor(species);
  const anim = behaviorToAnim(behavior, facing);
  const hold = shouldHold(behavior);
  const drawW = Math.max(48, size);
  const drawH = Math.round(drawW * (FRAME_H / FRAME_W));

  animRef.current = anim;
  holdRef.current = hold;

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

  useEffect(() => {
    if (status !== "ready") return;

    // Quiet idle: paint once and stop the interval so atlas blinks don't loop.
    if (hold) {
      const img = imgRef.current;
      if (img) {
        frameRef.current = 0;
        paint(canvasRef.current, img, versionRef.current, anim, 0, drawW, drawH);
      }
      return;
    }

    const tickMs = behavior === "look" ? 160 : 120;
    const id = window.setInterval(() => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas || holdRef.current) return;
      const { frames } = resolveAnim(animRef.current, versionRef.current);
      frameRef.current = (frameRef.current + 1) % frames;
      paint(
        canvas,
        img,
        versionRef.current,
        animRef.current,
        frameRef.current,
        drawW,
        drawH,
      );
    }, tickMs);
    return () => window.clearInterval(id);
  }, [status, drawW, drawH, anim, hold, behavior]);

  useEffect(() => {
    frameRef.current = 0;
    const img = imgRef.current;
    if (img && status === "ready") {
      paint(canvasRef.current, img, versionRef.current, anim, 0, drawW, drawH);
    }
  }, [anim, drawW, drawH, status, hold]);

  const mirror = facing === "left" && anim !== "runningLeft";

  return (
    <div
      className={`pixi-pet behavior-${behavior}`}
      title={face.label}
      data-species={species}
      data-status={status}
      data-hold={hold ? "1" : "0"}
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

import { useEffect } from "react";
import type { CSSProperties } from "react";
import { playRisingSound, stopRisingSound } from "./risingKakaAudio";

type Props = {
  behavior: string;
  /** Explicit Rising action (Dragging / RbtnClk / …); overrides behavior map */
  actionOverride?: string | null;
  facing?: "left" | "right";
  size?: number;
};

/** Map FluffNest behaviors → original Rising KaKa APNG action names. */
const ACTION_BY_BEHAVIOR: Record<string, string> = {
  idle: "Stand",
  walk: "Stand",
  sleep: "Sleeping",
  sit: "Sleeping",
  yawn: "StaSleep",
  tea: "Eatwm",
  drink: "Eatwm",
  feed: "Eatwm",
  eat: "Eatwm",
  cheer: "Gally",
  play: "Gally",
  dance: "Gally",
  jump_rope: "Gally",
  spin: "Gally",
  wiggle: "Gally",
  roll: "Gally",
  swing: "Gally",
  encore: "Gally",
  stretch: "hands",
  soccer: "Gally",
  react: "DblClk",
  pat: "DblClk",
  poke: "DblClk",
  hug: "Hello",
  nod: "Hello",
  bow: "Bye",
  look: "Hello",
  phone: "dialog",
  read: "dialog",
  float: "Stand",
  magic: "Scanning",
  hex: "Scanning",
  sparkle: "StarScan",
  paint: "hands",
  beam: "Findv",
  slash: "Killv",
  ultimate: "Killv",
  warp: "showup",
  switch: "smog",
  hum: "Hello",
};

function actionFor(behavior: string): string {
  return ACTION_BY_BEHAVIOR[behavior] ?? "Stand";
}

export function RisingKakaPet({
  behavior,
  actionOverride = null,
  facing = "right",
  size = 192,
}: Props) {
  const action = actionOverride || actionFor(behavior);
  const src = `/pets/rising-kaka/apng/${action}.png`;
  const style: CSSProperties = {
    width: size,
    height: size,
    transform: facing === "left" ? "scaleX(-1)" : undefined,
    filter: "drop-shadow(0 8px 12px rgba(40, 28, 16, 0.18))",
  };

  useEffect(() => {
    const loop = action === "Sleeping";
    playRisingSound(action, { loop, volume: loop ? 0.65 : 0.8 });
    return () => {
      stopRisingSound();
    };
  }, [action]);

  return (
    <div
      className={`rising-kaka behavior-${behavior}`}
      data-action={action}
      style={style}
      title={`瑞星小狮子 · ${action}`}
    >
      <img
        key={src}
        src={src}
        alt="瑞星小狮子卡卡"
        width={size}
        height={size}
        draggable={false}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

/** Codex pet atlas (192×208 cells, 8 columns). */

export const FRAME_W = 192;
export const FRAME_H = 208;
export const COLS = 8;

export type AtlasAnim =
  | "idle"
  | "runningRight"
  | "runningLeft"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

/** row index + typical non-empty frame count */
export const ANIM_ROWS: Record<AtlasAnim, { row: number; frames: number }> = {
  idle: { row: 0, frames: 6 },
  runningRight: { row: 1, frames: 8 },
  runningLeft: { row: 2, frames: 8 },
  waving: { row: 3, frames: 4 },
  jumping: { row: 4, frames: 5 },
  failed: { row: 5, frames: 8 },
  waiting: { row: 6, frames: 6 },
  running: { row: 7, frames: 6 },
  review: { row: 8, frames: 6 },
};

export type FacePack = {
  src: string;
  spriteVersionNumber?: number;
  label: string;
  isEgg?: boolean;
};

export function behaviorToAnim(
  behavior: string,
  facing: "left" | "right",
): AtlasAnim {
  switch (behavior) {
    case "walk":
      return facing === "left" ? "runningLeft" : "runningRight";
    case "jump_rope":
    case "play":
    case "soccer":
    case "dance":
    case "stretch":
    case "spin":
    case "switch":
    case "cheer":
    case "swing":
    case "roll":
    case "wiggle":
    case "encore":
    case "warp":
      return "jumping";
    case "sleep":
    case "sit":
    case "yawn":
    case "tea":
    case "drink":
    case "read":
    case "phone":
    case "look":
    case "float":
      return "waiting";
    case "react":
    case "slash":
    case "beam":
    case "ultimate":
      return "failed";
    case "magic":
    case "paint":
    case "bow":
    case "nod":
    case "hum":
    case "hex":
    case "sparkle":
    case "bubble":
      return "review";
    case "wave":
    case "pat":
    case "hug":
    case "poke":
    case "tickle":
    case "feed":
    case "nuzzle":
      return "waving";
    case "idle":
    default:
      return "idle";
  }
}

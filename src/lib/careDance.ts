import { petDef, type PetCategoryId } from "./petCatalog";
import type { PetBehavior } from "./types";

type CareAlertKind = "water" | "stretch";
export type CareRoamStyle = "dash" | "weave" | "orbit" | "amble";

/** Named body poses for the care-dance CSS choreography. */
export type DancePose =
  | "prelude"
  | "sway"
  | "glide"
  | "turn"
  | "lift"
  | "ripple"
  | "flourish"
  | "spark"
  | "bow";

export type CareDancePhrase = {
  /** Spritesheet / soft-pet behavior */
  behavior: PetBehavior;
  /** Rising KaKa APNG (must exist under public/pets/rising-kaka/apng/) */
  risingAction: string;
  /** CSS pose class: care-pose-${pose} */
  pose: DancePose;
  durationMs: number;
  /**
   * hold — stage center, dance in place
   * glide — soft travel along a curved path
   * arc — small circular waltz step
   */
  locomotion: "hold" | "glide" | "arc";
};

export type CareDanceRoutine = {
  style: CareRoamStyle;
  phrases: CareDancePhrase[];
  totalMs: number;
};

function sumMs(phrases: CareDancePhrase[]) {
  return phrases.reduce((s, p) => s + p.durationMs, 0);
}

function routine(style: CareRoamStyle, phrases: CareDancePhrase[]): CareDanceRoutine {
  return { style, phrases, totalMs: sumMs(phrases) };
}

/**
 * Idol — ~45s stage piece: greeting, two waltz verses, turn, climax, encore, bow.
 */
function idolRoutine(kind: CareAlertKind): CareDanceRoutine {
  if (kind === "water") {
    return routine("weave", [
      { behavior: "wave", risingAction: "Hello", pose: "prelude", durationMs: 2400, locomotion: "hold" },
      { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 5200, locomotion: "glide" },
      { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 3600, locomotion: "hold" },
      { behavior: "spin", risingAction: "Gally", pose: "turn", durationMs: 2200, locomotion: "hold" },
      { behavior: "encore", risingAction: "Gally", pose: "flourish", durationMs: 4200, locomotion: "hold" },
      { behavior: "dance", risingAction: "Gally", pose: "glide", durationMs: 5600, locomotion: "glide" },
      { behavior: "sparkle", risingAction: "StarScan", pose: "spark", durationMs: 3800, locomotion: "arc" },
      { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 4800, locomotion: "glide" },
      { behavior: "wave", risingAction: "Hello", pose: "ripple", durationMs: 2800, locomotion: "hold" },
      { behavior: "bow", risingAction: "Bye", pose: "bow", durationMs: 2800, locomotion: "hold" },
    ]);
  }
  return routine("weave", [
    { behavior: "stretch", risingAction: "hands", pose: "prelude", durationMs: 2600, locomotion: "hold" },
    { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 5000, locomotion: "glide" },
    { behavior: "wiggle", risingAction: "Gally", pose: "ripple", durationMs: 3200, locomotion: "hold" },
    { behavior: "dance", risingAction: "Gally", pose: "glide", durationMs: 4800, locomotion: "glide" },
    { behavior: "spin", risingAction: "Gally", pose: "turn", durationMs: 2200, locomotion: "hold" },
    { behavior: "encore", risingAction: "Gally", pose: "flourish", durationMs: 4000, locomotion: "hold" },
    { behavior: "jump_rope", risingAction: "Gally", pose: "lift", durationMs: 3600, locomotion: "arc" },
    { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 4400, locomotion: "glide" },
    { behavior: "bow", risingAction: "Bye", pose: "bow", durationMs: 2800, locomotion: "hold" },
  ]);
}

/** Companion — lyrical ~45s. */
function companionRoutine(kind: CareAlertKind): CareDanceRoutine {
  return routine("weave", [
    { behavior: "wave", risingAction: "Hello", pose: "prelude", durationMs: 2400, locomotion: "hold" },
    { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 5600, locomotion: "glide" },
    { behavior: "hum", risingAction: "Hello", pose: "ripple", durationMs: 3600, locomotion: "hold" },
    { behavior: "dance", risingAction: "Gally", pose: "glide", durationMs: 5000, locomotion: "glide" },
    { behavior: "spin", risingAction: "Gally", pose: "turn", durationMs: 2000, locomotion: "hold" },
    { behavior: "cheer", risingAction: "Gally", pose: "lift", durationMs: 3000, locomotion: "hold" },
    {
      behavior: kind === "water" ? "wave" : "wiggle",
      risingAction: "Gally",
      pose: "sway",
      durationMs: 4800,
      locomotion: "glide",
    },
    { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 4000, locomotion: "hold" },
    { behavior: "bow", risingAction: "Bye", pose: "bow", durationMs: 2600, locomotion: "hold" },
  ]);
}

/** Lion / runner — long elegant dashes. */
function dashRoutine(kind: CareAlertKind): CareDanceRoutine {
  return routine("dash", [
    { behavior: "wave", risingAction: "Hello", pose: "prelude", durationMs: 2200, locomotion: "hold" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 6200, locomotion: "glide" },
    { behavior: "cheer", risingAction: "Gally", pose: "lift", durationMs: 2800, locomotion: "hold" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 5800, locomotion: "glide" },
    {
      behavior: kind === "water" ? "jump_rope" : "stretch",
      risingAction: kind === "water" ? "Gally" : "hands",
      pose: kind === "water" ? "flourish" : "ripple",
      durationMs: 3600,
      locomotion: "hold",
    },
    { behavior: "walk", risingAction: "StatDrag", pose: "sway", durationMs: 5200, locomotion: "glide" },
    { behavior: "cheer", risingAction: "Gally", pose: "lift", durationMs: 2600, locomotion: "hold" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 5600, locomotion: "glide" },
    { behavior: "wave", risingAction: "Hello", pose: "bow", durationMs: 2400, locomotion: "hold" },
  ]);
}

/** Digi — crisp but sustained. */
function digiRoutine(_kind: CareAlertKind): CareDanceRoutine {
  return routine("dash", [
    { behavior: "wave", risingAction: "Hello", pose: "prelude", durationMs: 2000, locomotion: "hold" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 4800, locomotion: "glide" },
    { behavior: "beam", risingAction: "Findv", pose: "spark", durationMs: 2800, locomotion: "hold" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 4600, locomotion: "glide" },
    { behavior: "spin", risingAction: "Gally", pose: "turn", durationMs: 1800, locomotion: "hold" },
    { behavior: "warp", risingAction: "showup", pose: "flourish", durationMs: 3200, locomotion: "arc" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 5200, locomotion: "glide" },
    { behavior: "cheer", risingAction: "Gally", pose: "lift", durationMs: 2800, locomotion: "hold" },
    { behavior: "walk", risingAction: "StatDrag", pose: "sway", durationMs: 4400, locomotion: "glide" },
    { behavior: "cheer", risingAction: "Gally", pose: "bow", durationMs: 2400, locomotion: "hold" },
  ]);
}

/** Fantasy — floating waltz. */
function fantasyRoutine(_kind: CareAlertKind): CareDanceRoutine {
  return routine("orbit", [
    { behavior: "float", risingAction: "Stand", pose: "prelude", durationMs: 2800, locomotion: "hold" },
    { behavior: "float", risingAction: "Stand", pose: "sway", durationMs: 5600, locomotion: "arc" },
    { behavior: "hex", risingAction: "Scanning", pose: "ripple", durationMs: 3600, locomotion: "hold" },
    { behavior: "sparkle", risingAction: "StarScan", pose: "spark", durationMs: 4000, locomotion: "arc" },
    { behavior: "magic", risingAction: "Scanning", pose: "flourish", durationMs: 3600, locomotion: "hold" },
    { behavior: "float", risingAction: "Stand", pose: "glide", durationMs: 5200, locomotion: "glide" },
    { behavior: "float", risingAction: "Stand", pose: "sway", durationMs: 4800, locomotion: "arc" },
    { behavior: "sparkle", risingAction: "StarScan", pose: "spark", durationMs: 3200, locomotion: "hold" },
    { behavior: "wave", risingAction: "Hello", pose: "bow", durationMs: 2600, locomotion: "hold" },
  ]);
}

/** Star — sparkle-forward. */
function starRoutine(_kind: CareAlertKind): CareDanceRoutine {
  return routine("orbit", [
    { behavior: "sparkle", risingAction: "StarScan", pose: "prelude", durationMs: 2400, locomotion: "hold" },
    { behavior: "float", risingAction: "Stand", pose: "sway", durationMs: 5200, locomotion: "arc" },
    { behavior: "dance", risingAction: "Gally", pose: "glide", durationMs: 4800, locomotion: "glide" },
    { behavior: "spin", risingAction: "Gally", pose: "turn", durationMs: 2000, locomotion: "hold" },
    { behavior: "sparkle", risingAction: "StarScan", pose: "spark", durationMs: 4000, locomotion: "hold" },
    { behavior: "dance", risingAction: "Gally", pose: "sway", durationMs: 5000, locomotion: "glide" },
    { behavior: "cheer", risingAction: "Gally", pose: "flourish", durationMs: 3400, locomotion: "arc" },
    { behavior: "float", risingAction: "Stand", pose: "glide", durationMs: 4200, locomotion: "arc" },
    { behavior: "bow", risingAction: "Bye", pose: "bow", durationMs: 2600, locomotion: "hold" },
  ]);
}

/** Fluff — cute bobbing. */
function fluffRoutine(kind: CareAlertKind): CareDanceRoutine {
  return routine("amble", [
    { behavior: "wave", risingAction: "Hello", pose: "prelude", durationMs: 2200, locomotion: "hold" },
    { behavior: "wiggle", risingAction: "Gally", pose: "sway", durationMs: 4200, locomotion: "glide" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 5000, locomotion: "glide" },
    { behavior: "roll", risingAction: "Gally", pose: "turn", durationMs: 2800, locomotion: "hold" },
    {
      behavior: kind === "water" ? "cheer" : "jump_rope",
      risingAction: "Gally",
      pose: "lift",
      durationMs: 3400,
      locomotion: "hold",
    },
    { behavior: "wiggle", risingAction: "Gally", pose: "ripple", durationMs: 4000, locomotion: "glide" },
    { behavior: "walk", risingAction: "Dragging", pose: "glide", durationMs: 4800, locomotion: "glide" },
    { behavior: "cheer", risingAction: "Gally", pose: "flourish", durationMs: 3000, locomotion: "hold" },
    { behavior: "wave", risingAction: "Hello", pose: "bow", durationMs: 2400, locomotion: "hold" },
  ]);
}

export function buildCareDanceRoutine(
  kind: CareAlertKind,
  speciesId: string,
): CareDanceRoutine {
  if (speciesId === "rising" || speciesId === "leo") {
    return dashRoutine(kind);
  }
  const category: PetCategoryId = petDef(speciesId)?.category ?? "fluff";
  switch (category) {
    case "idol":
      return idolRoutine(kind);
    case "companion":
      return companionRoutine(kind);
    case "digi":
      return digiRoutine(kind);
    case "fantasy":
      return fantasyRoutine(kind);
    case "star":
      return starRoutine(kind);
    case "fluff":
    default:
      return fluffRoutine(kind);
  }
}

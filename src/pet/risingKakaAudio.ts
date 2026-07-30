/** Rising KaKa SFX extracted from original SWF DefineSound (PCM → MP3). */

const BASE = "/pets/rising-kaka/sounds";

/** Actions that have an extracted .mp3 */
const SOUND_FILES = new Set([
  "Sleeping",
  "RbtnClk",
  "DblClk",
  "Eatwm",
  "Ignorev",
  "Killv",
  "Deletef",
]);

let current: HTMLAudioElement | null = null;

export function risingSoundAvailable(action: string): boolean {
  return SOUND_FILES.has(action);
}

export function stopRisingSound() {
  if (!current) return;
  try {
    current.pause();
    current.currentTime = 0;
  } catch {
    /* ignore */
  }
  current = null;
}

export function playRisingSound(
  action: string,
  opts?: { loop?: boolean; volume?: number },
) {
  if (!SOUND_FILES.has(action)) {
    if (!opts?.loop) stopRisingSound();
    return;
  }
  stopRisingSound();
  const audio = new Audio(`${BASE}/${action}.mp3`);
  audio.loop = Boolean(opts?.loop);
  audio.volume = opts?.volume ?? 0.75;
  current = audio;
  void audio.play().catch(() => {
    /* autoplay / missing file */
  });
}

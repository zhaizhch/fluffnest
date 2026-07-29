import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api } from "../lib/api";
import {
  BUBBLES,
  DEFAULT_PALETTE,
  type PetBehavior,
  type PetInstance,
} from "../lib/types";
import { getCatalogAction, resolveVisualBehavior } from "../lib/actions";
import {
  buildBlinkStep,
  buildClickReaction,
  buildMinuteFidget,
  pickClingyLine,
  stepDuration,
  type BehaviorStep,
} from "./behaviorEngine";
import {
  msUntilNext,
  nextBlinkDelayMs,
  nextFidgetDelayMs,
  pickQuietEvent,
} from "./quietSchedule";
import { PetFigure } from "./PetFigure";
import "./pet.css";

function pickBubble(_speciesId: string, behavior: PetBehavior): string | null {
  const cat = getCatalogAction(behavior);
  if (cat?.bubbles?.length) {
    return cat.bubbles[Math.floor(Math.random() * cat.bubbles.length)] ?? null;
  }
  const pool = BUBBLES[behavior] ?? BUBBLES.idle ?? [];
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function PetApp() {
  const [pet, setPet] = useState<PetInstance | null>(null);
  const [behavior, setBehavior] = useState<PetBehavior>("idle");
  const [bubble, setBubble] = useState<string | null>(null);
  const [facing, setFacing] = useState<"left" | "right">("right");
  const dragRef = useRef(false);
  const walkDir = useRef(1);
  const busyUntil = useRef(0);
  const sequenceGen = useRef(0);
  const userSeqActive = useRef(false);
  const bubbleTimer = useRef<number | null>(null);
  const petRef = useRef<PetInstance | null>(null);
  /** True only when pointer moved enough to count as a window drag. */
  const suppressClick = useRef(false);
  const ptrDownPos = useRef<{ x: number; y: number } | null>(null);
  const DRAG_THRESHOLD_PX = 6;

  const palette = DEFAULT_PALETTE;

  useEffect(() => {
    petRef.current = pet;
  }, [pet]);

  const showBubble = useCallback((text: string, ms = 2400) => {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  const maybeMove = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const scale = await win.scaleFactor();
      const logicalX = pos.x / scale;
      const logicalY = pos.y / scale;
      if (Math.random() < 0.4) walkDir.current *= -1;
      setFacing(walkDir.current > 0 ? "right" : "left");
      const nx = Math.max(
        24,
        Math.min(1180, logicalX + walkDir.current * (24 + Math.random() * 56)),
      );
      const ny = Math.max(
        48,
        Math.min(720, logicalY + (Math.random() - 0.5) * 28),
      );
      await win.setPosition(new LogicalPosition(nx, ny));
    } catch {
      /* ignore */
    }
  }, []);

  const maybeWarp = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const scale = await win.scaleFactor();
      const logicalX = pos.x / scale;
      const logicalY = pos.y / scale;
      walkDir.current = Math.random() < 0.5 ? -1 : 1;
      setFacing(walkDir.current > 0 ? "right" : "left");
      const nx = Math.max(
        40,
        Math.min(1100, logicalX + walkDir.current * (120 + Math.random() * 220)),
      );
      const ny = Math.max(
        60,
        Math.min(680, logicalY + (Math.random() - 0.5) * 160),
      );
      await win.setPosition(new LogicalPosition(nx, ny));
    } catch {
      /* ignore */
    }
  }, []);

  const runSequence = useCallback(
    async (
      steps: BehaviorStep[],
      speciesId: string,
      opts?: { userInitiated?: boolean; preferClingyBubble?: boolean },
    ) => {
      const gen = ++sequenceGen.current;
      if (opts?.userInitiated) userSeqActive.current = true;

      for (let i = 0; i < steps.length; i++) {
        if (gen !== sequenceGen.current) return;
        const step = steps[i]!;
        const ms = stepDuration(step);
        busyUntil.current = Date.now() + ms;
        setBehavior(step.behavior);

        if (opts?.userInitiated) {
          // Clicks always get dialogue
          if (step.bubble) {
            showBubble(step.bubble, Math.min(ms, 2800));
          } else if (i === 0 || Math.random() < (step.bubbleChance ?? 0.7)) {
            const line =
              (opts.preferClingyBubble && i === 0
                ? pickClingyLine()
                : null) ??
              pickBubble(speciesId, step.behavior) ??
              pickClingyLine();
            showBubble(line, Math.min(ms, 2800));
          }
        } else {
          // Idle: almost never talk
          const chance = step.bubbleChance ?? 0;
          if (step.bubble) {
            showBubble(step.bubble, Math.min(ms, 2800));
          } else if (chance > 0 && Math.random() < chance) {
            const line = pickBubble(speciesId, step.behavior);
            if (line) showBubble(line, Math.min(ms, 2800));
          }
        }

        if (step.warp || step.behavior === "warp") {
          await sleep(Math.min(420, ms * 0.35));
          if (gen !== sequenceGen.current) return;
          void maybeWarp();
          await sleep(Math.max(0, ms - Math.min(420, ms * 0.35)));
        } else {
          if (step.move || step.behavior === "walk") {
            void maybeMove();
          }
          await sleep(ms);
        }
      }

      if (gen === sequenceGen.current) {
        setBehavior("idle");
        busyUntil.current = Date.now() + 200;
        if (opts?.userInitiated) userSeqActive.current = false;
      }
    },
    [maybeMove, maybeWarp, showBubble],
  );

  useEffect(() => {
    api.getActivePet().then(setPet).catch(console.error);

    const unsubs = [
      listen<PetInstance>("pet-updated", (e) => setPet(e.payload)),
      listen<{ action: string; speciesId: string }>("pet-action", (e) => {
        // Panel/API interact — treat as user interaction with talk
        if (userSeqActive.current) return;
        const a = e.payload.action as PetBehavior;
        const visual = a === ("pet" as PetBehavior) ? "pat" : a;
        void runSequence(
          [{ behavior: visual, bubbleChance: 1 }],
          e.payload.speciesId,
          { userInitiated: true, preferClingyBubble: true },
        );
      }),
      listen<{ id: string; title: string }>("reminder-fired", (e) => {
        const species = petRef.current?.speciesId ?? "mochi";
        void runSequence(
          [
            {
              behavior: "react",
              durationMs: 1400,
              bubble: `⏰ ${e.payload.title}`,
              bubbleChance: 1,
            },
            { behavior: "wave", durationMs: 1600, bubbleChance: 0.5 },
          ],
          species,
          { userInitiated: true },
        );
      }),
    ];
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
    };
  }, [runSequence]);

  // Quiet life: freeze idle → rare blink (35–55s) → fidget ~every minute
  useEffect(() => {
    let cancelled = false;

    const waitWhileBusy = async () => {
      while (
        !cancelled &&
        (dragRef.current ||
          userSeqActive.current ||
          Date.now() < busyUntil.current)
      ) {
        await sleep(400);
      }
    };

    const loop = async () => {
      let nextBlinkAt = Date.now() + nextBlinkDelayMs();
      let nextFidgetAt = Date.now() + nextFidgetDelayMs();

      while (!cancelled) {
        await waitWhileBusy();
        if (cancelled) return;

        try {
          const state = await api.getState();
          if (state.settings.focusMode) {
            setBehavior("sleep");
            setBubble(null);
            await sleep(15000);
            continue;
          }

          const active =
            state.pets.find((p) => p.isActive && p.unlocked) ?? null;
          if (!active) {
            await sleep(4000);
            continue;
          }
          setPet(active);
          setBehavior("idle");
          setBubble(null);

          const now = Date.now();
          const waitMs = msUntilNext(now, nextBlinkAt, nextFidgetAt);
          const wakeAt = now + waitMs;
          while (!cancelled && Date.now() < wakeAt) {
            if (userSeqActive.current || dragRef.current) break;
            await sleep(400);
          }
          if (cancelled) return;
          await waitWhileBusy();
          if (userSeqActive.current) {
            // After user interact, push timers forward so we don't immediately fidget
            nextBlinkAt = Date.now() + nextBlinkDelayMs();
            nextFidgetAt = Date.now() + nextFidgetDelayMs();
            continue;
          }

          const event = pickQuietEvent(Date.now(), nextBlinkAt, nextFidgetAt);
          if (event === "fidget") {
            await runSequence(
              [buildMinuteFidget(active.speciesId)],
              active.speciesId,
            );
            nextFidgetAt = Date.now() + nextFidgetDelayMs();
            // Keep blink cadence independent
            if (nextBlinkAt <= Date.now()) {
              nextBlinkAt = Date.now() + nextBlinkDelayMs();
            }
            if (Math.random() < 0.35) {
              try {
                await api.tickIdle();
              } catch {
                /* ignore */
              }
            }
          } else {
            await runSequence([buildBlinkStep()], active.speciesId);
            nextBlinkAt = Date.now() + nextBlinkDelayMs();
          }

          setBehavior("idle");
        } catch {
          await sleep(5000);
        }
      }
    };

    void loop();
    return () => {
      cancelled = true;
      sequenceGen.current += 1;
    };
  }, [runSequence]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    ptrDownPos.current = { x: e.screenX, y: e.screenY };
    dragRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = ptrDownPos.current;
    if (!start || suppressClick.current) return;
    const dx = Math.abs(e.screenX - start.x);
    const dy = Math.abs(e.screenY - start.y);
    if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
      // Real drag: hand window to OS; skip the following click
      suppressClick.current = true;
      ptrDownPos.current = null;
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined)
        .finally(() => {
          dragRef.current = false;
        });
    }
  };

  const onPointerUp = () => {
    if (!suppressClick.current) dragRef.current = false;
    ptrDownPos.current = null;
  };

  const clickCount = useRef(0);
  const clickTimer = useRef<number | null>(null);

  const onClick = async () => {
    // Bugfix: previously always set didDrag after startDragging() on every
    // pointerdown, which swallowed all left-clicks. Now only suppress after
    // actual movement past DRAG_THRESHOLD_PX.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    clickCount.current += 1;
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(async () => {
      const n = clickCount.current;
      clickCount.current = 0;
      if (n >= 2) return;
      const speciesId = petRef.current?.speciesId ?? "mochi";
      const reaction = buildClickReaction(speciesId);
      sequenceGen.current += 1;
      void runSequence(reaction.steps, speciesId, {
        userInitiated: true,
        preferClingyBubble: true,
      });
      try {
        await api.interact(reaction.apiAction);
      } catch (err) {
        console.error(err);
      }
    }, 220);
  };

  const openPanel = () => {
    WebviewWindow.getByLabel("panel").then((w) => {
      w?.show();
      w?.setFocus();
    });
  };

  const species = pet?.speciesId ?? "mochi";
  const visual = resolveVisualBehavior(behavior);

  return (
    <div
      className={`pet-root species-${species} behavior-${visual} action-${behavior} face-${facing}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        openPanel();
      }}
      onDoubleClick={() => {
        clickCount.current = 0;
        openPanel();
      }}
      style={
        {
          "--body": palette.body,
          "--blush": palette.blush,
          "--ear": palette.ear,
          "--accent": palette.accent,
          "--ink": palette.ink,
        } as React.CSSProperties
      }
    >
      {bubble && <div className="bubble">{bubble}</div>}
      <div className="stage">
        <div className="prop prop-swing" aria-hidden />
        <div className="prop prop-rope" aria-hidden />
        <div className="prop prop-cup" aria-hidden />
        <div className="fx fx-bubbles" aria-hidden>
          <span /><span /><span /><span />
        </div>
        <div className="fx fx-warp" aria-hidden />
        <div className="fx fx-ultimate" aria-hidden />
        <div className="fx fx-beam" aria-hidden />
        <div className="fx fx-slash" aria-hidden />
        <div className="fx fx-sparkle" aria-hidden>
          <i /><i /><i /><i /><i />
        </div>
        <div className="fx fx-hex" aria-hidden />
        <div className="figure-wrap">
          <PetFigure
            key={pet?.id ?? species}
            species={species}
            behavior={visual}
            facing={facing}
          />
        </div>
      </div>
      <div className="name-tag">{pet?.name ?? "绒窝"}</div>
    </div>
  );
}

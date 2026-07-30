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
  buildClickReaction,
  buildSoftIdleAction,
  pickClingyLine,
  stepDuration,
  type BehaviorStep,
} from "./behaviorEngine";
import { nextSoftActionDelayMs } from "./quietSchedule";
import {
  buildRisingClickAction,
  buildRisingFocusSleep,
  buildRisingIdleAction,
  nextRisingActionDelayMs,
  type RisingStep,
} from "./risingKakaBehavior";
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
  /** Rising KaKa explicit APNG action (Dragging / RbtnClk / StopDrag…) */
  const [risingAction, setRisingAction] = useState<string | null>(null);
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

  const maybeMove = useCallback(async (tiny = false) => {
    try {
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const scale = await win.scaleFactor();
      const logicalX = pos.x / scale;
      const logicalY = pos.y / scale;
      if (Math.random() < 0.4) walkDir.current *= -1;
      setFacing(walkDir.current > 0 ? "right" : "left");
      const stepX = tiny
        ? 6 + Math.random() * 12
        : 24 + Math.random() * 56;
      const stepY = tiny
        ? (Math.random() - 0.5) * 10
        : (Math.random() - 0.5) * 28;
      const nx = Math.max(
        24,
        Math.min(1180, logicalX + walkDir.current * stepX),
      );
      const ny = Math.max(48, Math.min(720, logicalY + stepY));
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
            void maybeMove(Boolean(step.moveTiny));
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

  /** Rising KaKa: drive original APNG actions (no FluffNest behavior remap). */
  const runRisingSteps = useCallback(
    async (steps: RisingStep[], opts?: { userInitiated?: boolean }) => {
      const gen = ++sequenceGen.current;
      if (opts?.userInitiated) userSeqActive.current = true;
      setBubble(null);

      for (const step of steps) {
        if (gen !== sequenceGen.current) return;
        busyUntil.current = Date.now() + step.durationMs;
        setRisingAction(step.action);
        if (step.action === "Sleeping" || step.action === "StaSleep") {
          setBehavior("sleep");
        } else if (step.warp) {
          setBehavior("warp");
        } else {
          setBehavior("idle");
        }

        if (step.warp) {
          await sleep(Math.min(280, step.durationMs * 0.4));
          if (gen !== sequenceGen.current) return;
          void maybeWarp();
          await sleep(
            Math.max(0, step.durationMs - Math.min(280, step.durationMs * 0.4)),
          );
        } else {
          await sleep(step.durationMs);
        }
      }

      if (gen === sequenceGen.current) {
        setRisingAction("Stand");
        setBehavior("idle");
        busyUntil.current = Date.now() + 200;
        if (opts?.userInitiated) userSeqActive.current = false;
      }
    },
    [maybeWarp],
  );

  useEffect(() => {
    api.getActivePet().then(setPet).catch(console.error);

    const unsubs = [
      listen<PetInstance>("pet-updated", (e) => setPet(e.payload)),
      listen<{ action: string; speciesId: string }>("pet-action", (e) => {
        if (userSeqActive.current) return;
        if (e.payload.speciesId === "rising") {
          void runRisingSteps(buildRisingClickAction(), { userInitiated: true });
          return;
        }
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
        if (species === "rising") {
          void runRisingSteps(
            [
              { action: "Hello", durationMs: 2000 },
              { action: "Stand", durationMs: 1600 },
            ],
            { userInitiated: true },
          );
          return;
        }
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
  }, [runSequence, runRisingSteps]);

  // Quiet life / Rising KaKa original schedule
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
      let nextSoftAt = Date.now() + nextSoftActionDelayMs();

      while (!cancelled) {
        await waitWhileBusy();
        if (cancelled) return;

        try {
          const state = await api.getState();
          const active =
            state.pets.find((p) => p.isActive && p.unlocked) ?? null;
          const isRising = active?.speciesId === "rising";

          if (state.settings.focusMode) {
            setBubble(null);
            if (isRising && active) {
              setPet(active);
              await runRisingSteps(buildRisingFocusSleep());
            } else {
              setBehavior("sleep");
              setRisingAction(null);
              await sleep(15000);
            }
            continue;
          }

          if (!active) {
            await sleep(4000);
            continue;
          }
          setPet(active);
          if (!userSeqActive.current) {
            setBehavior("idle");
            setBubble(null);
            if (isRising) setRisingAction("Stand");
            else setRisingAction(null);
          }

          const delayMs = isRising
            ? nextRisingActionDelayMs()
            : nextSoftActionDelayMs();
          // align next tick if species just switched
          if (nextSoftAt < Date.now() - 60_000) nextSoftAt = Date.now() + delayMs;

          const waitMs = Math.max(0, nextSoftAt - Date.now());
          const wakeAt = Date.now() + waitMs;
          while (!cancelled && Date.now() < wakeAt) {
            if (userSeqActive.current || dragRef.current) break;
            await sleep(500);
          }
          if (cancelled) return;
          await waitWhileBusy();
          if (userSeqActive.current) {
            nextSoftAt =
              Date.now() +
              (isRising ? nextRisingActionDelayMs() : nextSoftActionDelayMs());
            continue;
          }

          if (isRising) {
            await runRisingSteps(buildRisingIdleAction());
            nextSoftAt = Date.now() + nextRisingActionDelayMs();
          } else {
            await runSequence(
              buildSoftIdleAction(active.speciesId, active.bond),
              active.speciesId,
            );
            nextSoftAt = Date.now() + nextSoftActionDelayMs();
          }

          if (Math.random() < 0.55) {
            try {
              await api.tickIdle();
            } catch {
              /* ignore */
            }
          }

          if (!userSeqActive.current) {
            setBehavior("idle");
            if (isRising) setRisingAction("Stand");
          }
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
  }, [runSequence, runRisingSteps]);

  const risingActionTimer = useRef<number | null>(null);
  const risingDragPhase = useRef(false);

  const clearRisingActionSoon = useCallback((ms: number) => {
    if (risingActionTimer.current) window.clearTimeout(risingActionTimer.current);
    risingActionTimer.current = window.setTimeout(() => {
      setRisingAction(null);
      risingActionTimer.current = null;
    }, ms);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    suppressClick.current = false;
    ptrDownPos.current = { x: e.screenX, y: e.screenY };
    dragRef.current = true;
    risingDragPhase.current = false;
    if (petRef.current?.speciesId === "rising") {
      sequenceGen.current += 1;
      userSeqActive.current = false;
      setRisingAction("StatDrag");
    }
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
      if (petRef.current?.speciesId === "rising") {
        risingDragPhase.current = true;
        sequenceGen.current += 1;
        setRisingAction("Dragging");
      }
      void getCurrentWindow()
        .startDragging()
        .catch(() => undefined)
        .finally(() => {
          dragRef.current = false;
          if (petRef.current?.speciesId === "rising" && risingDragPhase.current) {
            risingDragPhase.current = false;
            setRisingAction("StopDrag");
            clearRisingActionSoon(750);
          }
        });
    }
  };

  const onPointerUp = () => {
    if (!suppressClick.current) {
      dragRef.current = false;
      if (petRef.current?.speciesId === "rising" && !risingDragPhase.current) {
        setRisingAction(null);
      }
    }
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
      if (speciesId === "rising") {
        void runRisingSteps(buildRisingClickAction(), { userInitiated: true });
        try {
          await api.interact("pat");
        } catch (err) {
          console.error(err);
          showBubble(
            String(err).replace(/^.*Error:\s*/i, "") || "体力不足",
            2200,
          );
        }
        return;
      }
      const bond = petRef.current?.bond ?? 0;
      const reaction = buildClickReaction(speciesId, bond);
      sequenceGen.current += 1;
      void runSequence(reaction.steps, speciesId, {
        userInitiated: true,
        preferClingyBubble: true,
      });
      try {
        await api.interact(reaction.apiAction);
      } catch (err) {
        console.error(err);
        showBubble(
          String(err).replace(/^.*Error:\s*/i, "") || "体力不足",
          2200,
        );
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
        if (petRef.current?.speciesId === "rising") {
          sequenceGen.current += 1;
          userSeqActive.current = false;
          setRisingAction("RbtnClk");
          clearRisingActionSoon(1400);
          window.setTimeout(() => openPanel(), 500);
          return;
        }
        openPanel();
      }}
      onDoubleClick={() => {
        clickCount.current = 0;
        if (petRef.current?.speciesId === "rising") {
          sequenceGen.current += 1;
          userSeqActive.current = false;
          setRisingAction("DblClk");
          clearRisingActionSoon(1100);
          window.setTimeout(() => openPanel(), 400);
          return;
        }
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
            risingAction={species === "rising" ? risingAction : null}
          />
        </div>
      </div>
      <div className="name-tag">{pet?.name ?? "绒窝"}</div>
    </div>
  );
}

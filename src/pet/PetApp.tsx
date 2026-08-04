import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { api } from "../lib/api";
import {
  buildCareAlertPlan,
  resolveCareAlertKind,
  startCareRoam,
  type CareAlertPlan,
  type DancePose,
} from "../lib/careAlert";
import {
  startCareSpeechLoop,
  stopCareSpeech,
  enqueueCareSpeech,
} from "../lib/careSpeech";
import { actionLabel, llmFromSettings } from "../lib/llm";
import {
  parseReminderIntent,
  reminderConfirmText,
} from "../lib/reminderIntent";
import {
  BUBBLES,
  DEFAULT_PALETTE,
  type PetBehavior,
  type PetInstance,
  type PetSaysPayload,
  type Settings,
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
import { QuickMenu, type QuickRemindKind } from "./QuickMenu";
import "./pet.css";

const PET_SIZE = { w: 260, h: 320 };
const MENU_SIZE = { w: 520, h: 360 };

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);
  const [careAlert, setCareAlert] = useState<CareAlertPlan | null>(null);
  const [dancePose, setDancePose] = useState<DancePose | null>(null);
  const dragRef = useRef(false);
  const walkDir = useRef(1);
  const busyUntil = useRef(0);
  const sequenceGen = useRef(0);
  const userSeqActive = useRef(false);
  const bubbleTimer = useRef<number | null>(null);
  const petRef = useRef<PetInstance | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const focusModeRef = useRef(false);
  const careAlertRef = useRef(false);
  const cancelCareRoam = useRef<(() => void) | null>(null);
  const llmReqId = useRef(0);
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

  const startCareAlert = useCallback((kind: "water" | "stretch", spokenHint?: string) => {
    if (careAlertRef.current) return;

    // Close quick menu if open (size restored by roam restore path)
    setMenuOpen(false);

    const speciesId = petRef.current?.speciesId ?? "mochi";
    const petName = petRef.current?.name ?? "绒窝";
    const plan = buildCareAlertPlan(kind, speciesId, petName);
    careAlertRef.current = true;
    userSeqActive.current = true;
    sequenceGen.current += 1;
    setCareAlert(plan);
    setDancePose(plan.dance.phrases[0]?.pose ?? "prelude");
    setBubble(null);

    const muted = Boolean(settingsRef.current?.muted);
    const personality = petRef.current?.personality ?? "clingy";
    startCareSpeechLoop({
      kind,
      personality,
      muted,
      seedLines: [spokenHint?.trim() || plan.speakText],
      durationMs: plan.durationMs,
    });

    cancelCareRoam.current?.();
    cancelCareRoam.current = startCareRoam({
      durationMs: plan.durationMs,
      windowSize: plan.windowSize,
      style: plan.dance.style,
      phrases: plan.dance.phrases,
      onPhrase: (phrase) => {
        if (!careAlertRef.current) return;
        setDancePose(phrase.pose);
        setBehavior(phrase.behavior);
        if (speciesId === "rising") {
          setRisingAction(phrase.risingAction);
        } else {
          setRisingAction(null);
        }
      },
      onStep: (face) => setFacing(face),
      onDone: () => {
        careAlertRef.current = false;
        userSeqActive.current = false;
        cancelCareRoam.current = null;
        stopCareSpeech();
        setCareAlert(null);
        setDancePose(null);
        setBehavior("idle");
        setRisingAction(speciesId === "rising" ? "Stand" : null);
      },
    });
  }, []);

  const dismissCareAlert = useCallback(() => {
    if (!careAlertRef.current) return;
    cancelCareRoam.current?.();
    cancelCareRoam.current = null;
    careAlertRef.current = false;
    userSeqActive.current = false;
    stopCareSpeech();
    setCareAlert(null);
    setDancePose(null);
    setBubble(null);
    setBehavior("idle");
    setRisingAction(null);
  }, []);

  /** Ask LLM for click/interact lines when AI dialogue is on. */
  const enrichBubbleWithLlm = useCallback(
    (
      kind: "click" | "interact" | "reminder",
      action: string,
      fallback: string | null,
      _gen: number,
      holdMs: number,
    ) => {
      if (fallback) showBubble(fallback, holdMs);
      // Refresh settings in case panel toggled AI after pet window booted
      void api
        .getState()
        .then((s) => {
          settingsRef.current = s.settings;
          focusModeRef.current = s.settings.focusMode;
          const llm = llmFromSettings(s.settings);
          if (!llm.enabled || !llm.dialogueEnabled) return;
          const req = ++llmReqId.current;
          const label = actionLabel(action);
          void api
            .generatePetLine(kind, label)
            .then((line) => {
              // Only drop if a newer click already requested a line
              if (req !== llmReqId.current) return;
              if (line?.trim()) showBubble(line.trim(), Math.max(holdMs, 4200));
            })
            .catch((err) => {
              if (req !== llmReqId.current) return;
              console.error("generatePetLine failed", err);
              // Keep fallback bubble; briefly hint failure
              showBubble(
                String(err).replace(/^.*Error:\s*/i, "").slice(0, 36) ||
                  (fallback ?? "AI 暂时没回上"),
                2800,
              );
            });
        })
        .catch(() => {
          const llm = llmFromSettings(settingsRef.current);
          if (!llm.enabled || !llm.dialogueEnabled) return;
          const req = ++llmReqId.current;
          void api
            .generatePetLine(kind, actionLabel(action))
            .then((line) => {
              if (req !== llmReqId.current) return;
              if (line?.trim()) showBubble(line.trim(), Math.max(holdMs, 4200));
            })
            .catch(console.error);
        });
    },
    [showBubble],
  );

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
      opts?: {
        userInitiated?: boolean;
        preferClingyBubble?: boolean;
        llmKind?: "click" | "interact" | "reminder";
        skipLlm?: boolean;
      },
    ) => {
      const gen = ++sequenceGen.current;
      if (opts?.userInitiated) userSeqActive.current = true;
      let askedLlm = false;

      for (let i = 0; i < steps.length; i++) {
        if (gen !== sequenceGen.current) return;
        const step = steps[i]!;
        const ms = stepDuration(step);
        busyUntil.current = Date.now() + ms;
        setBehavior(step.behavior);

        if (opts?.userInitiated) {
          if (step.bubble) {
            showBubble(step.bubble, Math.min(ms, 2800));
            if (!opts.skipLlm && !askedLlm && !step.bubble.startsWith("⏰")) {
              askedLlm = true;
              enrichBubbleWithLlm(
                opts.llmKind ?? "click",
                step.behavior,
                step.bubble,
                gen,
                Math.min(ms, 3200),
              );
            }
          } else if (i === 0 || Math.random() < (step.bubbleChance ?? 0.7)) {
            const line =
              (opts.preferClingyBubble && i === 0
                ? pickClingyLine()
                : null) ??
              pickBubble(speciesId, step.behavior) ??
              pickClingyLine();
            if (!opts.skipLlm && !askedLlm) {
              askedLlm = true;
              enrichBubbleWithLlm(
                opts.llmKind ?? "click",
                step.behavior,
                line,
                gen,
                Math.min(ms, 3200),
              );
            } else {
              showBubble(line, Math.min(ms, 2800));
            }
          }
        } else {
          // Soft idle: local bubbles only — never call LLM (keeps UI snappy).
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
    [enrichBubbleWithLlm, maybeMove, maybeWarp, showBubble],
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

  const playPetSays = useCallback(
    (payload: PetSaysPayload) => {
      const species = petRef.current?.speciesId ?? "mochi";
      const b = (payload.behavior as PetBehavior) || "wave";
      showBubble(payload.text, 4200);
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
            behavior: b,
            durationMs: 1800,
            bubble: payload.text,
            bubbleChance: 1,
          },
          { behavior: "idle", durationMs: 800, bubbleChance: 0 },
        ],
        species,
        { userInitiated: true, skipLlm: true },
      );
    },
    [runRisingSteps, runSequence, showBubble],
  );

  // Keep latest runners in refs so the idle loop never tears down on re-render.
  const runSequenceRef = useRef(runSequence);
  const runRisingStepsRef = useRef(runRisingSteps);
  const playPetSaysRef = useRef(playPetSays);
  runSequenceRef.current = runSequence;
  runRisingStepsRef.current = runRisingSteps;
  playPetSaysRef.current = playPetSays;

  useEffect(() => {
    api.getActivePet().then(setPet).catch(console.error);
    api.getState()
      .then((s) => {
        settingsRef.current = s.settings;
        focusModeRef.current = s.settings.focusMode;
      })
      .catch(() => undefined);

    const unsubs = [
      listen<PetInstance>("pet-updated", (e) => setPet(e.payload)),
      listen<Settings>("settings-updated", (e) => {
        settingsRef.current = e.payload;
        focusModeRef.current = e.payload.focusMode;
      }),
      listen<{ action: string; speciesId: string }>("pet-action", (e) => {
        if (userSeqActive.current) return;
        if (e.payload.speciesId === "rising") {
          void runRisingStepsRef.current(buildRisingClickAction(), {
            userInitiated: true,
          });
          return;
        }
        const a = e.payload.action as PetBehavior;
        const visual = a === ("pet" as PetBehavior) ? "pat" : a;
        void runSequenceRef.current(
          [{ behavior: visual, bubbleChance: 1 }],
          e.payload.speciesId,
          { userInitiated: true, preferClingyBubble: true, llmKind: "interact" },
        );
      }),
      listen<{ id: string; title: string; type?: string; bubble?: string }>(
        "reminder-fired",
        (e) => {
          const kind =
            resolveCareAlertKind(e.payload.type ?? "") ??
            resolveCareAlertKind(e.payload.title ?? "") ??
            resolveCareAlertKind(e.payload.id ?? "");

          // Water / stretch → big roaming care alert with voice
          if (kind === "water" || kind === "stretch") {
            startCareAlert(kind);
            const llm = llmFromSettings(settingsRef.current);
            if (llm.enabled && llm.dialogueEnabled) {
              void api
                .generatePetLine("care_voice", kind === "water" ? "喝水" : "久坐起身")
                .then((ai) => {
                  if (!careAlertRef.current || !ai?.trim()) return;
                  setCareAlert((prev) =>
                    prev
                      ? { ...prev, speakText: ai.trim(), headline: ai.trim() }
                      : prev,
                  );
                  if (!settingsRef.current?.muted) {
                    enqueueCareSpeech(ai.trim());
                  }
                })
                .catch(() => undefined);
            }
            return;
          }

          // Meetings etc. keep the lighter bubble path
          const species = petRef.current?.speciesId ?? "mochi";
          const line = e.payload.bubble ?? `⏰ ${e.payload.title}`;
          if (species === "rising") {
            showBubble(line, 3600);
            void runRisingStepsRef.current(
              [
                { action: "Hello", durationMs: 2000 },
                { action: "Stand", durationMs: 1600 },
              ],
              { userInitiated: true },
            );
          } else {
            void runSequenceRef.current(
              [
                {
                  behavior: "react",
                  durationMs: 1600,
                  bubble: line,
                  bubbleChance: 1,
                },
                { behavior: "wave", durationMs: 1600, bubbleChance: 0.3 },
              ],
              species,
              { userInitiated: true, skipLlm: true },
            );
          }
          const llm = llmFromSettings(settingsRef.current);
          if (llm.enabled && llm.dialogueEnabled) {
            const req = ++llmReqId.current;
            void api
              .generatePetLine("reminder", e.payload.title)
              .then((ai) => {
                if (req !== llmReqId.current) return;
                if (ai?.trim()) showBubble(ai.trim(), 3600);
              })
              .catch(() => undefined);
          }
        },
      ),
      listen<PetSaysPayload>("pet-says", (e) => {
        playPetSaysRef.current(e.payload);
      }),
    ];
    return () => {
      unsubs.forEach((p) => p.then((u) => u()));
    };
  }, [showBubble, startCareAlert]);

  // Quiet life / Rising KaKa — stable loop (deps empty via refs)
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
          if (focusModeRef.current) {
            setBubble(null);
            const species = petRef.current?.speciesId;
            if (species === "rising") {
              await runRisingStepsRef.current(buildRisingFocusSleep());
            } else {
              setBehavior("sleep");
              setRisingAction(null);
              await sleep(15000);
            }
            // Refresh focus flag occasionally without cloning full shop catalog
            try {
              const s = await api.getState();
              settingsRef.current = s.settings;
              focusModeRef.current = s.settings.focusMode;
              const active =
                s.pets.find((p) => p.isActive && p.unlocked) ?? null;
              if (active) setPet(active);
            } catch {
              /* ignore */
            }
            continue;
          }

          let active = petRef.current;
          try {
            active = await api.getActivePet();
            setPet(active);
          } catch {
            await sleep(4000);
            continue;
          }

          const isRising = active.speciesId === "rising";

          if (!userSeqActive.current) {
            setBehavior("idle");
            if (isRising) setRisingAction("Stand");
            else setRisingAction(null);
          }

          const delayMs = isRising
            ? nextRisingActionDelayMs()
            : nextSoftActionDelayMs();
          if (nextSoftAt < Date.now() - 60_000) nextSoftAt = Date.now() + delayMs;

          const waitMs = Math.max(0, nextSoftAt - Date.now());
          const wakeAt = Date.now() + waitMs;
          while (!cancelled && Date.now() < wakeAt) {
            if (userSeqActive.current || dragRef.current || focusModeRef.current)
              break;
            await sleep(500);
          }
          if (cancelled) return;
          await waitWhileBusy();
          if (userSeqActive.current || focusModeRef.current) {
            nextSoftAt =
              Date.now() +
              (isRising ? nextRisingActionDelayMs() : nextSoftActionDelayMs());
            continue;
          }

          if (isRising) {
            await runRisingStepsRef.current(buildRisingIdleAction());
            nextSoftAt = Date.now() + nextRisingActionDelayMs();
          } else {
            await runSequenceRef.current(
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
  }, []);

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
    if (menuOpen) return;
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
    if (menuOpen) {
      closeMenu();
      return;
    }
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
        const llm = llmFromSettings(settingsRef.current);
        if (llm.enabled && llm.dialogueEnabled) {
          const req = ++llmReqId.current;
          void api
            .generatePetLine("click", "摸摸")
            .then((line) => {
              if (req !== llmReqId.current) return;
              if (line?.trim()) showBubble(line.trim(), 4200);
            })
            .catch((err) => {
              if (req !== llmReqId.current) return;
              console.error(err);
              showBubble(
                String(err).replace(/^.*Error:\s*/i, "").slice(0, 36) || "AI 暂时没回上",
                2800,
              );
            });
        }
        try {
          await api.interact("pat");
        } catch (err) {
          console.error(err);
          showBubble(String(err).replace(/^.*Error:\s*/i, "") || "互动失败", 2200);
        }
        return;
      }
      const bond = petRef.current?.bond ?? 0;
      const reaction = buildClickReaction(speciesId, bond);
      sequenceGen.current += 1;
      void runSequence(reaction.steps, speciesId, {
        userInitiated: true,
        preferClingyBubble: true,
        llmKind: "click",
      });
      try {
        await api.interact(reaction.apiAction);
      } catch (err) {
        console.error(err);
        showBubble(String(err).replace(/^.*Error:\s*/i, "") || "互动失败", 2200);
      }
    }, 220);
  };

  const openPanel = useCallback(() => {
    setMenuOpen(false);
    WebviewWindow.getByLabel("panel").then((w) => {
      w?.show();
      w?.setFocus();
    });
  }, []);

  const setPetWindowSize = useCallback(async (w: number, h: number) => {
    try {
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    } catch {
      /* ignore */
    }
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
  }, [setPetWindowSize]);

  const openMenu = useCallback(() => {
    setMenuOpen(true);
    void setPetWindowSize(MENU_SIZE.w, MENU_SIZE.h);
  }, [setPetWindowSize]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, closeMenu]);

  const runQuickAction = useCallback(
    async (kind: "joke" | "news" | "weather") => {
      const llm = llmFromSettings(settingsRef.current);
      if (!llm.enabled) {
        showBubble("先去面板设置里开启 AI 哦", 2800);
        return;
      }
      setMenuBusy(true);
      showBubble(
        kind === "joke" ? "我想想笑话…" : kind === "news" ? "翻翻科技娱乐…" : "看看天气…",
        2400,
      );
      try {
        await api.triggerProactive(kind);
        closeMenu();
      } catch (err) {
        showBubble(String(err).replace(/^.*Error:\s*/i, "") || "稍后再试", 2800);
      } finally {
        setMenuBusy(false);
      }
    },
    [closeMenu, showBubble],
  );

  const runQuickChat = useCallback(
    async (text: string) => {
      // Natural-language reminders from the quick chat box
      const intent = parseReminderIntent(text);
      if (intent) {
        setMenuBusy(true);
        try {
          if (intent.kind === "meeting") {
            await api.quickSetReminder({
              kind: "meeting",
              title: intent.title,
              at: intent.at.toISOString(),
            });
          } else {
            await api.quickSetReminder({
              kind: intent.kind,
              intervalMinutes: intent.intervalMinutes,
            });
          }
          showBubble(reminderConfirmText(intent), 3600);
        } catch (err) {
          showBubble(String(err).replace(/^.*Error:\s*/i, "") || "提醒没设上", 2800);
        } finally {
          setMenuBusy(false);
        }
        return;
      }

      const llm = llmFromSettings(settingsRef.current);
      if (!llm.enabled || !llm.chatEnabled) {
        showBubble("先去面板设置里开启 AI 对话哦", 2800);
        return;
      }
      setMenuBusy(true);
      try {
        await api.chatWithPet(text);
      } catch (err) {
        showBubble(String(err).replace(/^.*Error:\s*/i, "") || "聊不了啦", 2800);
      } finally {
        setMenuBusy(false);
      }
    },
    [showBubble],
  );

  const runQuickRemind = useCallback(
    async (args: {
      kind: QuickRemindKind;
      title?: string;
      atLocal?: string;
      intervalMinutes?: number;
    }) => {
      setMenuBusy(true);
      try {
        if (args.kind === "meeting") {
          if (!args.atLocal) throw new Error("请选择会议时间");
          const at = new Date(args.atLocal);
          if (Number.isNaN(at.getTime())) throw new Error("时间格式不对");
          await api.quickSetReminder({
            kind: "meeting",
            title: args.title || "会议",
            at: at.toISOString(),
          });
          showBubble(
            reminderConfirmText({
              kind: "meeting",
              title: args.title || "会议",
              at,
            }),
            3600,
          );
        } else {
          const intervalMinutes =
            args.intervalMinutes ?? (args.kind === "water" ? 60 : 45);
          await api.quickSetReminder({
            kind: args.kind,
            intervalMinutes,
          });
          showBubble(
            reminderConfirmText({ kind: args.kind, intervalMinutes }),
            3600,
          );
        }
      } catch (err) {
        showBubble(String(err).replace(/^.*Error:\s*/i, "") || "提醒没设上", 2800);
      } finally {
        setMenuBusy(false);
      }
    },
    [showBubble],
  );

  const species = pet?.speciesId ?? "mochi";
  const visual = resolveVisualBehavior(behavior);

  return (
    <div
      className={`pet-root species-${species} behavior-${visual} action-${behavior} face-${facing}${menuOpen ? " menu-open" : ""}${careAlert ? " care-alerting care-dancing" : ""}${dancePose ? ` care-pose-${dancePose}` : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => {
        if (careAlertRef.current) {
          e.stopPropagation();
          dismissCareAlert();
          return;
        }
        void onClick();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (careAlertRef.current) {
          dismissCareAlert();
          return;
        }
        if (petRef.current?.speciesId === "rising") {
          sequenceGen.current += 1;
          userSeqActive.current = false;
          setRisingAction("RbtnClk");
          clearRisingActionSoon(1400);
        }
        if (menuOpen) closeMenu();
        else openMenu();
      }}
      onDoubleClick={() => {
        if (careAlertRef.current) {
          dismissCareAlert();
          return;
        }
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
          "--accent": careAlert?.accent ?? palette.accent,
          "--ink": palette.ink,
          "--care-accent": careAlert?.accent ?? palette.accent,
        } as React.CSSProperties
      }
    >
      <div className="pet-main">
        {careAlert ? (
          <div className={`care-alert care-alert-${careAlert.kind}`} role="alert">
            <div className="care-alert-glow" aria-hidden />
            <div className="care-alert-icon" aria-hidden>
              {careAlert.kind === "water" ? "💧" : "🏃"}
            </div>
            <div className="care-alert-copy">
              <strong className="care-alert-title">{careAlert.headline}</strong>
              <span className="care-alert-sub">{careAlert.subline}</span>
              <span className="care-alert-hint">点一下可关闭</span>
            </div>
          </div>
        ) : (
          bubble && <div className="bubble">{bubble}</div>
        )}
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
      <QuickMenu
        open={menuOpen}
        busy={menuBusy}
        petName={pet?.name ?? "绒窝"}
        onClose={closeMenu}
        onAction={(a) => void runQuickAction(a)}
        onChat={runQuickChat}
        onRemind={runQuickRemind}
      />
    </div>
  );
}

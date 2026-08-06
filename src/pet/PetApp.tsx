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

const PET_SIZE = { w: 340, h: 420 };
const MENU_SIZE = { w: 520, h: 400 };
const FORTUNE_SIZE = { w: 540, h: 460 };
const WEATHER_SIZE = { w: 540, h: 440 };
const NEWS_SIZE = { w: 540, h: 460 };
const WECHAT_SIZE = { w: 560, h: 520 };

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

/** How long a speech bubble stays — scales with text so replies stay readable. */
function bubbleDisplayMs(
  text: string,
  opts?: { min?: number; max?: number },
): number {
  const min = opts?.min ?? 5600;
  const max = opts?.max ?? 20000;
  // ~reading pace for short Chinese lines; longer replies get more time.
  const byLen = 3200 + Math.ceil(text.trim().length * 180);
  return Math.min(max, Math.max(min, byLen));
}

/** Empty / flaky LLM — keep local fallback, never surface the error as a bubble. */
function isSoftLlmFail(err: unknown): boolean {
  const msg = String(err ?? "");
  return /空内容|empty|timeout|超时|网络|429|502|503|504|abort/i.test(msg);
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
  const [fortuneText, setFortuneText] = useState<string | null>(null);
  const [infoCard, setInfoCard] = useState<{
    kind: "weather" | "news" | "wechat";
    title: string;
    summary: string;
    tip: string;
    messageId?: string;
    canSend?: boolean;
    draft?: string;
    sender?: string;
    incoming?: string;
    suggestions?: string[];
  } | null>(null);
  const [imUnread, setImUnread] = useState(0);
  const [wechatPending, setWechatPending] = useState(0);
  const [waterEnabled, setWaterEnabled] = useState(true);
  const [stretchEnabled, setStretchEnabled] = useState(true);
  const [latestImId, setLatestImIdState] = useState<string | null>(null);
  const latestImIdRef = useRef<string | null>(null);
  const setLatestImId = (id: string | null) => {
    latestImIdRef.current = id;
    setLatestImIdState(id);
  };
  const pendingWechatRef = useRef<{
    messageId: string;
    text: string;
    incoming?: string;
    sender?: string;
    error?: string;
  } | null>(null);
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

  const showBubble = useCallback((text: string, ms?: number) => {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    const hold = ms ?? bubbleDisplayMs(text);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), hold);
  }, []);

  const flushPendingWechat = useCallback(() => {
    const pending = pendingWechatRef.current;
    if (!pending) return false;
    pendingWechatRef.current = null;
    setWechatPending(0);
    setLatestImId(pending.messageId);
    setMenuOpen(false);
    setFortuneText(null);

    if (pending.error) {
      showBubble(`微信自动回复失败：${pending.error}`.slice(0, 48), 4200);
      setInfoCard({
        kind: "wechat",
        title: "微信 · 自动回复失败",
        summary: pending.incoming || pending.error,
        tip: pending.error,
        messageId: pending.messageId,
        canSend: false,
        draft: "",
        sender: pending.sender,
        incoming: pending.incoming,
        suggestions: [],
      });
    } else {
      const preview = pending.text.slice(0, 36);
      showBubble(
        preview ? `微信已自动回复：${preview}` : "微信已自动回复",
        4200,
      );
      setInfoCard({
        kind: "wechat",
        title: "微信 · 已自动回复",
        summary: pending.incoming || pending.text,
        tip: "已搜索整理并发送到微信。也可改文案后点「重新建议」。",
        messageId: pending.messageId,
        canSend: false,
        draft: pending.text,
        sender: pending.sender,
        incoming: pending.incoming,
        suggestions: pending.text ? [pending.text] : [],
      });
    }
    void getCurrentWindow()
      .setSize(new LogicalSize(WECHAT_SIZE.w, WECHAT_SIZE.h))
      .catch(() => undefined);
    return true;
  }, [showBubble]);

  const flushPendingWechatRef = useRef(flushPendingWechat);
  flushPendingWechatRef.current = flushPendingWechat;

  const startCareAlert = useCallback((kind: "water" | "stretch", spokenHint?: string) => {
    if (careAlertRef.current) return;

    // Close quick menu / fortune / weather if open (size restored by roam restore path)
    setMenuOpen(false);
    setFortuneText(null);
    setInfoCard(null);

    const speciesId = petRef.current?.speciesId ?? "kaka5";
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
              if (line?.trim()) {
                showBubble(
                  line.trim(),
                  Math.max(holdMs, bubbleDisplayMs(line.trim())),
                );
              }
              // Empty success: keep local fallback bubble (do not clear / complain).
            })
            .catch((err) => {
              if (req !== llmReqId.current) return;
              console.error("generatePetLine failed", err);
              // Soft fail: keep fallback. Never replace it with "空内容" / "AI 暂时没回上".
              if (fallback || isSoftLlmFail(err)) return;
              showBubble(
                String(err).replace(/^.*Error:\s*/i, "").slice(0, 36) ||
                  "AI 暂时没回上",
                4000,
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
              if (line?.trim()) {
                showBubble(
                  line.trim(),
                  Math.max(holdMs, bubbleDisplayMs(line.trim())),
                );
              }
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
            const hold = opts.skipLlm
              ? bubbleDisplayMs(step.bubble)
              : bubbleDisplayMs(step.bubble, { min: 4200, max: 12000 });
            showBubble(step.bubble, hold);
            if (!opts.skipLlm && !askedLlm && !step.bubble.startsWith("⏰")) {
              askedLlm = true;
              enrichBubbleWithLlm(
                opts.llmKind ?? "click",
                step.behavior,
                step.bubble,
                gen,
                hold,
              );
            }
          } else if (i === 0 || Math.random() < (step.bubbleChance ?? 0.7)) {
            const line =
              (opts.preferClingyBubble && i === 0
                ? pickClingyLine()
                : null) ??
              pickBubble(speciesId, step.behavior) ??
              pickClingyLine();
            const hold = bubbleDisplayMs(line, { min: 4200, max: 12000 });
            if (!opts.skipLlm && !askedLlm) {
              askedLlm = true;
              enrichBubbleWithLlm(
                opts.llmKind ?? "click",
                step.behavior,
                line,
                gen,
                hold,
              );
            } else {
              showBubble(line, hold);
            }
          }
        } else {
          // Soft idle: local bubbles only — never call LLM (keeps UI snappy).
          const chance = step.bubbleChance ?? 0;
          if (step.bubble) {
            showBubble(
              step.bubble,
              bubbleDisplayMs(step.bubble, { min: 3600, max: 9000 }),
            );
          } else if (chance > 0 && Math.random() < chance) {
            const line = pickBubble(speciesId, step.behavior);
            if (line) {
              showBubble(line, bubbleDisplayMs(line, { min: 3600, max: 9000 }));
            }
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
      const species = petRef.current?.speciesId ?? "kaka5";
      const b = (payload.behavior as PetBehavior) || "wave";

      if (payload.kind === "fortune") {
        setMenuOpen(false);
        setInfoCard(null);
        setFortuneText(payload.text);
        void getCurrentWindow()
          .setSize(new LogicalSize(FORTUNE_SIZE.w, FORTUNE_SIZE.h))
          .catch(() => undefined);
        showBubble("今日运势来啦～", 2800);
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
              behavior: b === "magic" ? "magic" : "cheer",
              durationMs: 2200,
              bubbleChance: 0,
            },
            { behavior: "idle", durationMs: 800, bubbleChance: 0 },
          ],
          species,
          { userInitiated: true, skipLlm: true },
        );
        return;
      }

      if (payload.kind === "weather" || payload.kind === "news") {
        const isWeather = payload.kind === "weather";
        setMenuOpen(false);
        setFortuneText(null);
        setInfoCard({
          kind: isWeather ? "weather" : "news",
          title: isWeather ? "实时天气" : "科技娱乐资讯",
          summary: (payload.detail || payload.text || "").trim(),
          tip: payload.text,
        });
        const size = isWeather ? WEATHER_SIZE : NEWS_SIZE;
        void getCurrentWindow()
          .setSize(new LogicalSize(size.w, size.h))
          .catch(() => undefined);
        showBubble(isWeather ? "天气查好啦～" : "资讯来啦～", 2800);
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
            { behavior: b, durationMs: 2200, bubbleChance: 0 },
            { behavior: "idle", durationMs: 800, bubbleChance: 0 },
          ],
          species,
          { userInitiated: true, skipLlm: true },
        );
        return;
      }

      if (payload.kind === "wechat") {
        // ClawBot auto-reply stays silent until the user opens the pet.
        if (payload.autoReplying) {
          const mid =
            (payload.messageId && payload.messageId.trim()) ||
            latestImIdRef.current;
          if (mid) setLatestImId(mid);
          return;
        }
        setMenuOpen(false);
        setFortuneText(null);
        const mid =
          (payload.messageId && payload.messageId.trim()) ||
          latestImIdRef.current;
        if (mid) setLatestImId(mid);
        setInfoCard({
          kind: "wechat",
          title: "微信来信",
          summary: (payload.detail || "").trim() || "微信",
          tip: "正在根据来信想回复建议…",
          messageId: mid ?? undefined,
          canSend: false,
          draft: "",
          incoming: (payload.detail || "").trim() || undefined,
          suggestions: [],
        });
        void getCurrentWindow()
          .setSize(new LogicalSize(WECHAT_SIZE.w, WECHAT_SIZE.h))
          .catch(() => undefined);
        showBubble(payload.text, bubbleDisplayMs(payload.text));
        if (mid) {
          void api
            .draftImReply(mid)
            .then((d) => {
              setInfoCard((c) =>
                c && c.kind === "wechat" && c.messageId === mid
                  ? {
                      ...c,
                      title: "来信 · 回复建议",
                      sender: d.sender,
                      incoming: d.incoming || c.summary,
                      summary: d.summary || d.incoming,
                      draft: d.draft,
                      suggestions: d.suggestions ?? [],
                      canSend: d.canSend,
                      tip: d.canSend
                        ? "点选建议，再点「发送」"
                        : "点选建议，再「复制并打开微信」回车发送",
                    }
                  : c,
              );
            })
            .catch((err) => {
              setInfoCard((c) =>
                c && c.kind === "wechat" && c.messageId === mid
                  ? {
                      ...c,
                      tip:
                        String(err).replace(/^.*Error:\s*/i, "") ||
                        "建议生成失败",
                    }
                  : c,
              );
            });
        }
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
              behavior: b === "react" ? "react" : "phone",
              durationMs: 2000,
              bubble: payload.text,
              bubbleChance: 1,
            },
            { behavior: "idle", durationMs: 800, bubbleChance: 0 },
          ],
          species,
          { userInitiated: true, skipLlm: true },
        );
        return;
      }

      showBubble(payload.text, bubbleDisplayMs(payload.text));
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
        const unread = (s.imInbox ?? []).filter((m) => !m.acknowledged);
        setImUnread(unread.length);
        setLatestImId(unread.length ? unread[unread.length - 1]!.id : null);
        const water = s.reminders.find((r) => r.id === "rem-water" || r.type === "water");
        const stretch = s.reminders.find(
          (r) => r.id === "rem-stretch" || r.type === "stretch",
        );
        setWaterEnabled(water?.enabled ?? true);
        setStretchEnabled(stretch?.enabled ?? true);
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
          const species = petRef.current?.speciesId ?? "kaka5";
          const line = e.payload.bubble ?? `⏰ ${e.payload.title}`;
          if (species === "rising") {
            showBubble(line, bubbleDisplayMs(line));
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
                if (ai?.trim()) showBubble(ai.trim(), bubbleDisplayMs(ai.trim()));
              })
              .catch(() => undefined);
          }
        },
      ),
      listen<PetSaysPayload>("pet-says", (e) => {
        playPetSaysRef.current(e.payload);
      }),
      listen("im-inbox-updated", () => {
        void api.getImInbox().then((inbox) => {
          const unread = inbox.filter((m) => !m.acknowledged).length;
          setImUnread(unread);
          const latest = [...inbox].reverse().find((m) => !m.acknowledged);
          setLatestImId(latest?.id ?? null);
        });
      }),
      listen<{ id?: string; messageId?: string }>("im-message", (e) => {
        const id = e.payload?.id || e.payload?.messageId;
        if (id) setLatestImId(id);
      }),
      listen<{
        messageId?: string;
        text?: string;
        incoming?: string;
        sender?: string;
        error?: string;
        pending?: boolean;
      }>("im-auto-replied", (e) => {
        const mid = e.payload?.messageId;
        if (!mid) return;
        const text = (e.payload?.text || "").trim();
        const error = (e.payload?.error || "").trim() || undefined;
        // Always queue — show only when the user opens the pet.
        pendingWechatRef.current = {
          messageId: mid,
          text,
          incoming: e.payload?.incoming,
          sender: e.payload?.sender,
          error,
        };
        setWechatPending(1);
        setLatestImId(mid);
      }),
      listen<{ kind: string; tip: string }>("info-card-tip", (e) => {
        const { kind, tip } = e.payload;
        if (!tip?.trim()) return;
        setInfoCard((card) =>
          card && card.kind === kind ? { ...card, tip: tip.trim() } : card,
        );
        if (kind === "weather" || kind === "news") {
          showBubble(tip.trim(), bubbleDisplayMs(tip.trim()));
        }
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
              buildSoftIdleAction(active.speciesId, active.bond, active.personality),
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
    if (fortuneText) {
      closeFortune();
      return;
    }
    if (menuOpen) {
      closeMenu();
      return;
    }
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (flushPendingWechatRef.current()) {
      return;
    }
    clickCount.current += 1;
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(async () => {
      const n = clickCount.current;
      clickCount.current = 0;
      if (n >= 2) return;
      const speciesId = petRef.current?.speciesId ?? "kaka5";
      if (speciesId === "rising") {
        void runRisingSteps(buildRisingClickAction(), { userInitiated: true });
        const llm = llmFromSettings(settingsRef.current);
        if (llm.enabled && llm.dialogueEnabled) {
          const req = ++llmReqId.current;
          void api
            .generatePetLine("click", "摸摸")
            .then((line) => {
              if (req !== llmReqId.current) return;
              if (line?.trim()) showBubble(line.trim(), bubbleDisplayMs(line.trim()));
            })
            .catch((err) => {
              if (req !== llmReqId.current) return;
              console.error(err);
              // Soft fail — leave rising animation / local bubble alone.
              if (isSoftLlmFail(err)) return;
              const local =
                pickBubble(speciesId, "idle") ?? pickClingyLine() ?? null;
              if (local) showBubble(local, bubbleDisplayMs(local));
            });
        }
        try {
          await api.interact("pat");
        } catch (err) {
          console.error(err);
          showBubble(String(err).replace(/^.*Error:\s*/i, "") || "互动失败", 3600);
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

  const setPetWindowSize = useCallback(async (w: number, h: number) => {
    try {
      await getCurrentWindow().setSize(new LogicalSize(w, h));
    } catch {
      /* ignore */
    }
  }, []);

  const openPanel = useCallback(() => {
    setMenuOpen(false);
    setFortuneText(null);
    setInfoCard(null);
    void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
    WebviewWindow.getByLabel("panel").then((w) => {
      w?.show();
      w?.setFocus();
    });
  }, [setPetWindowSize]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    if (!fortuneText && !infoCard) {
      void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
    }
  }, [fortuneText, infoCard, setPetWindowSize]);

  const closeFortune = useCallback(() => {
    setFortuneText(null);
    setMenuOpen(false);
    void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
  }, [setPetWindowSize]);

  const closeInfoCard = useCallback(() => {
    setInfoCard(null);
    setMenuOpen(false);
    void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
  }, [setPetWindowSize]);

  const openMenu = useCallback(() => {
    if (flushPendingWechat()) return;
    setFortuneText(null);
    setInfoCard(null);
    setMenuOpen(true);
    void setPetWindowSize(MENU_SIZE.w, MENU_SIZE.h);
  }, [flushPendingWechat, setPetWindowSize]);

  useEffect(() => {
    if (!menuOpen && !fortuneText && !infoCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fortuneText) closeFortune();
      else if (infoCard) closeInfoCard();
      else closeMenu();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, fortuneText, infoCard, closeMenu, closeFortune, closeInfoCard]);

  const runQuickAction = useCallback(
    async (kind: "joke" | "news" | "weather" | "fortune") => {
      const llm = llmFromSettings(settingsRef.current);
      if (!llm.enabled) {
        showBubble("先去面板设置里开启 AI 哦", 2800);
        return;
      }
      setMenuBusy(true);
      const thinking =
        kind === "fortune"
          ? "掐指一算今日运势…"
          : kind === "joke"
            ? "我想想笑话…"
            : kind === "news"
              ? "查实时科技娱乐…"
              : "看看天气…";
      showBubble(thinking, 60000);
      try {
        await api.triggerProactive(kind);
        setMenuOpen(false);
        // fortune / weather / news keep the enlarged window via playPetSays
        if (kind !== "fortune" && kind !== "weather" && kind !== "news") {
          void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
        }
      } catch (err) {
        showBubble(String(err).replace(/^.*Error:\s*/i, "") || "稍后再试", 2800);
      } finally {
        setMenuBusy(false);
      }
    },
    [setPetWindowSize, showBubble],
  );

  const runQuickChat = useCallback(
    async (text: string) => {
      // Natural-language reminders from the quick chat box
      const intent = parseReminderIntent(text);
      if (intent) {
        setMenuBusy(true);
        try {
          if (intent.action === "status") {
            const st = await api.reminderStatus();
            const msg = reminderConfirmText(intent, st.summary);
            showBubble(msg, bubbleDisplayMs(msg));
            setWaterEnabled(!!st.water?.enabled);
            setStretchEnabled(!!st.stretch?.enabled);
          } else if (intent.action === "cancel") {
            if (intent.kind === "meeting") {
              const st = await api.reminderStatus();
              const mid = st.meetings[0]?.id;
              if (mid) await api.quickDisableReminder("meeting", mid);
              else throw new Error("没有进行中的会议提醒");
            } else {
              await api.quickDisableReminder(intent.kind);
              if (intent.kind === "water") setWaterEnabled(false);
              if (intent.kind === "stretch") setStretchEnabled(false);
            }
            const msg = reminderConfirmText(intent);
            showBubble(msg, bubbleDisplayMs(msg));
          } else if (intent.kind === "meeting") {
            await api.quickSetReminder({
              kind: "meeting",
              title: intent.title,
              at: intent.at.toISOString(),
            });
            const msg = reminderConfirmText(intent);
            showBubble(msg, bubbleDisplayMs(msg));
          } else {
            await api.quickSetReminder({
              kind: intent.kind,
              intervalMinutes: intent.intervalMinutes,
            });
            if (intent.kind === "water") setWaterEnabled(true);
            if (intent.kind === "stretch") setStretchEnabled(true);
            const msg = reminderConfirmText(intent);
            showBubble(msg, bubbleDisplayMs(msg));
          }
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
      action?: "set" | "cancel";
      title?: string;
      atLocal?: string;
      intervalMinutes?: number;
    }) => {
      setMenuBusy(true);
      try {
        const action = args.action ?? "set";
        if (action === "cancel" && (args.kind === "water" || args.kind === "stretch")) {
          await api.quickDisableReminder(args.kind);
          if (args.kind === "water") setWaterEnabled(false);
          else setStretchEnabled(false);
          const cancelMsg = reminderConfirmText({
            action: "cancel",
            kind: args.kind,
          });
          showBubble(cancelMsg, bubbleDisplayMs(cancelMsg));
          return;
        }
        if (args.kind === "meeting") {
          if (!args.atLocal) throw new Error("请选择会议时间");
          const at = new Date(args.atLocal);
          if (Number.isNaN(at.getTime())) throw new Error("时间格式不对");
          await api.quickSetReminder({
            kind: "meeting",
            title: args.title || "会议",
            at: at.toISOString(),
          });
          const msg = reminderConfirmText({
            action: "set",
            kind: "meeting",
            title: args.title || "会议",
            at,
          });
          showBubble(msg, bubbleDisplayMs(msg));
        } else {
          const intervalMinutes =
            args.intervalMinutes ?? (args.kind === "water" ? 60 : 45);
          await api.quickSetReminder({
            kind: args.kind,
            intervalMinutes,
          });
          if (args.kind === "water") setWaterEnabled(true);
          else setStretchEnabled(true);
          const msg = reminderConfirmText({
            action: "set",
            kind: args.kind,
            intervalMinutes,
          });
          showBubble(msg, bubbleDisplayMs(msg));
        }
      } catch (err) {
        showBubble(String(err).replace(/^.*Error:\s*/i, "") || "提醒没设上", 2800);
      } finally {
        setMenuBusy(false);
      }
    },
    [showBubble],
  );

  const runQuickWechat = useCallback(async () => {
    if (flushPendingWechat()) return;
    if (!latestImId) {
      showBubble("暂时没有未读微信", 2400);
      return;
    }
    setMenuBusy(true);
    try {
      const draft = await api.draftImReply(latestImId);
      setMenuOpen(false);
      setFortuneText(null);
      setInfoCard({
        kind: "wechat",
        title: draft.canSend ? "确认发送回复" : "来信 · 回复建议",
        summary: draft.summary || draft.incoming,
        tip: draft.canSend
          ? "点选建议后点「发送」即可发出。"
          : "点选建议，再「复制并打开微信」，回车发送。",
        messageId: draft.messageId,
        canSend: draft.canSend,
        draft: draft.draft,
        sender: draft.sender,
        incoming: draft.incoming,
        suggestions: draft.suggestions ?? [],
      });
      void getCurrentWindow()
        .setSize(new LogicalSize(WECHAT_SIZE.w, WECHAT_SIZE.h))
        .catch(() => undefined);
      showBubble("草稿好了，点卡片上的按钮回复～", 3200);
    } catch (err) {
      showBubble(String(err).replace(/^.*Error:\s*/i, "") || "处理失败", 2800);
    } finally {
      setMenuBusy(false);
    }
  }, [flushPendingWechat, latestImId, showBubble]);

  const confirmWechatReply = useCallback(async () => {
    if (!infoCard?.messageId) return;
    const text = (infoCard.draft || infoCard.summary || "").trim();
    if (!text) {
      showBubble("回复内容是空的", 2200);
      return;
    }
    setMenuBusy(true);
    try {
      const result = await api.sendImReply(infoCard.messageId, text);
      if (result === "sent") {
        showBubble("已发送～", 2800);
      } else if (result === "pasted") {
        showBubble("已打开微信并粘贴，回车发送吧", 3600);
      } else {
        showBubble("已复制并打开微信，在输入框 Cmd+V 后回车", 4000);
      }
      setInfoCard(null);
      void setPetWindowSize(PET_SIZE.w, PET_SIZE.h);
      const inbox = await api.getImInbox();
      const unread = inbox.filter((m) => !m.acknowledged);
      setImUnread(unread.length);
      setLatestImId(unread.length ? unread[unread.length - 1]!.id : null);
    } catch (err) {
      showBubble(String(err).replace(/^.*Error:\s*/i, "") || "回复失败", 3000);
    } finally {
      setMenuBusy(false);
    }
  }, [infoCard, setPetWindowSize, showBubble]);

  const species = pet?.speciesId ?? "kaka5";
  const visual = resolveVisualBehavior(behavior);

  return (
    <div
      className={`pet-root species-${species} behavior-${visual} action-${behavior} face-${facing}${menuOpen ? " menu-open" : ""}${fortuneText || infoCard ? " fortune-open" : ""}${careAlert ? " care-alerting care-dancing" : ""}${dancePose ? ` care-pose-${dancePose}` : ""}`}
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
        if (fortuneText) closeFortune();
        else if (infoCard) closeInfoCard();
        else if (menuOpen) closeMenu();
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
              onTap={() => {
                if (careAlertRef.current) {
                  dismissCareAlert();
                  return;
                }
                void onClick();
              }}
            />
          </div>
        </div>
        <div className="name-tag">{pet?.name ?? "绒窝"}</div>
      </div>
      <QuickMenu
        open={menuOpen}
        busy={menuBusy}
        petName={pet?.name ?? "绒窝"}
        imUnread={imUnread + wechatPending}
        waterEnabled={waterEnabled}
        stretchEnabled={stretchEnabled}
        onClose={closeMenu}
        onAction={(a) => void runQuickAction(a)}
        onChat={runQuickChat}
        onWechat={runQuickWechat}
        onRemind={runQuickRemind}
      />
      {fortuneText && (
        <aside
          className="fortune-card"
          role="dialog"
          aria-label="今日运势"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <header className="fortune-card-head">
            <span>今日运势</span>
            <button
              type="button"
              className="quick-menu-close"
              aria-label="关闭"
              onClick={closeFortune}
            >
              ×
            </button>
          </header>
          <div className="fortune-card-body">{fortuneText}</div>
        </aside>
      )}
      {infoCard && (
        <aside
          className={`fortune-card ${
            infoCard.kind === "weather"
              ? "weather-card"
              : infoCard.kind === "news"
                ? "news-card"
                : "wechat-card"
          }`}
          role="dialog"
          aria-label={infoCard.title}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <header className="fortune-card-head">
            <span>{infoCard.title}</span>
            <button
              type="button"
              className="quick-menu-close"
              aria-label="关闭"
              onClick={closeInfoCard}
            >
              ×
            </button>
          </header>
          <div className="fortune-card-body">
            {infoCard.kind === "wechat" && infoCard.messageId ? (
              <>
                <div className="wechat-incoming">
                  <p className="wechat-incoming-label">
                    {infoCard.sender ? `${infoCard.sender} 说` : "对方说"}
                  </p>
                  <pre className="wechat-incoming-text">
                    {infoCard.incoming || infoCard.summary || "（未读到正文）"}
                  </pre>
                  {infoCard.summary &&
                  infoCard.incoming &&
                  infoCard.summary !== infoCard.incoming ? (
                    <p className="weather-tip">概括：{infoCard.summary}</p>
                  ) : null}
                </div>
                {infoCard.suggestions && infoCard.suggestions.length > 0 ? (
                  <div className="wechat-suggests" role="list">
                    {infoCard.suggestions.map((s, i) => (
                      <button
                        key={`${i}-${s.slice(0, 12)}`}
                        type="button"
                        role="listitem"
                        className={`wechat-suggest${
                          infoCard.draft === s ? " active" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setInfoCard((c) => (c ? { ...c, draft: s } : c));
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="weather-tip">
                    {infoCard.tip || "正在想回复建议…"}
                  </p>
                )}
                <textarea
                  className="wechat-reply-input"
                  rows={3}
                  value={infoCard.draft ?? ""}
                  placeholder="写回复或点选上方建议…"
                  onChange={(e) =>
                    setInfoCard((c) =>
                      c ? { ...c, draft: e.target.value } : c,
                    )
                  }
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <div className="wechat-reply-actions">
                  <button
                    type="button"
                    className="wechat-reply-btn"
                    disabled={menuBusy || !(infoCard.draft ?? "").trim()}
                    onClick={(e) => {
                      e.stopPropagation();
                      void confirmWechatReply();
                    }}
                  >
                    {infoCard.canSend ? "发送" : "复制并打开微信"}
                  </button>
                  <button
                    type="button"
                    className="wechat-reply-btn ghost"
                    disabled={menuBusy || !infoCard.messageId}
                    onClick={(e) => {
                      e.stopPropagation();
                      void (async () => {
                        const mid = infoCard.messageId;
                        if (!mid) {
                          showBubble("找不到这条消息，请从面板收件箱再试", 2800);
                          return;
                        }
                        setMenuBusy(true);
                        setInfoCard((c) =>
                          c
                            ? {
                                ...c,
                                tip: "正在重新想回复建议…",
                                suggestions: [],
                              }
                            : c,
                        );
                        try {
                          const d = await api.draftImReply(mid, true);
                          setInfoCard((c) =>
                            c && c.messageId === mid
                              ? {
                                  ...c,
                                  title: "来信 · 回复建议",
                                  sender: d.sender,
                                  incoming: d.incoming,
                                  summary: d.summary || d.incoming,
                                  draft: d.draft,
                                  suggestions: d.suggestions ?? [],
                                  canSend: d.canSend,
                                  tip: d.canSend
                                    ? "点选建议后点「发送」"
                                    : "点选建议后「复制并打开微信」",
                                }
                              : c,
                          );
                        } catch (err) {
                          showBubble(
                            String(err).replace(/^.*Error:\s*/i, "") ||
                              "重新建议失败",
                            3200,
                          );
                          setInfoCard((c) =>
                            c
                              ? {
                                  ...c,
                                  tip:
                                    String(err).replace(/^.*Error:\s*/i, "") ||
                                    "重新建议失败",
                                }
                              : c,
                          );
                        } finally {
                          setMenuBusy(false);
                        }
                      })();
                    }}
                  >
                    {menuBusy ? "生成中…" : "重新建议"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <pre className="weather-stats">{infoCard.summary}</pre>
                {infoCard.tip && infoCard.tip !== infoCard.summary ? (
                  <p className="weather-tip">{infoCard.tip}</p>
                ) : null}
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

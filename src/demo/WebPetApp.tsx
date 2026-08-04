import { useCallback, useEffect, useRef, useState } from "react";
import { resolveVisualBehavior } from "../lib/actions";
import { petDef } from "../lib/petCatalog";
import { PERSONALITIES, type PersonalityOption } from "../lib/personality";
import type { PetBehavior, Personality } from "../lib/types";
import {
  buildClickReaction,
  buildSoftIdleAction,
  pickClingyLine,
  stepDuration,
  type BehaviorStep,
} from "../pet/behaviorEngine";
import { PetFigure } from "../pet/PetFigure";
import { nextSoftActionDelayMs } from "../pet/quietSchedule";
import "../pet/pet.css";
import { DEMO_PETS, demoPetFromQuery, type DemoPet } from "./demoPets";

const DEMO_BOND = 48;

const PERSONALITY_GREET: Record<Personality, string[]> = {
  calm: ["嗯，你好。", "我在这儿陪你。", "慢慢来就好。"],
  lively: ["嗨嗨～点我呀！", "今天也要元气满满！", "嘿嘿，被发现了！"],
  clingy: ["终于点开网页了…", "贴贴～我就在这里。", "不要只顾着看博客嘛。"],
  tsundere: ["才、才不是特意等你。", "随便点点也行啦。", "哼，网页版凑合玩玩。"],
  clever: ["试玩版上线～无 Key 也能玩。", "点我互动，台词是本地的。", "想要完整版？去下 macOS App。"],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function isEmbed(): boolean {
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

export function WebPetApp() {
  const embed = isEmbed();
  const [pet, setPet] = useState<DemoPet>(() => demoPetFromQuery());
  const [personality, setPersonality] = useState<Personality>(
    () => demoPetFromQuery().personality,
  );
  const [behavior, setBehavior] = useState<PetBehavior>("idle");
  const [facing, setFacing] = useState<"left" | "right">("right");
  const [bubble, setBubble] = useState<string | null>(null);
  const [clicks, setClicks] = useState(0);

  const bubbleTimer = useRef(0);
  const seqToken = useRef(0);
  const softTimer = useRef(0);
  const busyRef = useRef(false);
  const petRef = useRef(pet);
  const personalityRef = useRef(personality);
  petRef.current = pet;
  personalityRef.current = personality;

  const showBubble = useCallback((text: string, ms = 2600) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  const runSequence = useCallback(
    async (steps: BehaviorStep[]) => {
      const token = ++seqToken.current;
      busyRef.current = true;
      for (const step of steps) {
        if (token !== seqToken.current) return;
        setBehavior(step.behavior);
        if (step.move || step.moveTiny) {
          setFacing((f) => (f === "right" ? "left" : "right"));
        }
        if (step.bubble) {
          showBubble(step.bubble, Math.min(stepDuration(step), 2800));
        } else if ((step.bubbleChance ?? 0) > Math.random()) {
          showBubble(pickClingyLine(), 2200);
        }
        await new Promise((r) => window.setTimeout(r, stepDuration(step)));
      }
      if (token !== seqToken.current) return;
      setBehavior("idle");
      busyRef.current = false;
    },
    [showBubble],
  );

  // Greet when switching pets
  useEffect(() => {
    const lines =
      PERSONALITY_GREET[pet.personality] ?? PERSONALITY_GREET.clingy;
    showBubble(pick(lines!), 3200);
  }, [pet.id, pet.personality, showBubble]);

  // Soft idle loop — skip while a click sequence is running
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      softTimer.current = window.setTimeout(() => {
        if (cancelled) return;
        if (document.hidden || busyRef.current) {
          tick();
          return;
        }
        const steps = buildSoftIdleAction(
          petRef.current.id,
          DEMO_BOND,
          personalityRef.current,
        );
        void runSequence(steps).finally(() => {
          if (!cancelled) tick();
        });
      }, nextSoftActionDelayMs());
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(softTimer.current);
    };
  }, [pet.id, personality, runSequence]);

  const onPetClick = () => {
    if (busyRef.current) return;
    setClicks((n) => n + 1);
    const { steps } = buildClickReaction(pet.id, DEMO_BOND + clicks);
    void runSequence(steps);
  };

  const switchPet = (next: DemoPet) => {
    seqToken.current += 1;
    busyRef.current = false;
    setBehavior("idle");
    setPet(next);
    setPersonality(next.personality);
    const url = new URL(window.location.href);
    url.searchParams.set("pet", next.id);
    window.history.replaceState({}, "", url);
  };

  const switchPersonality = (opt: PersonalityOption) => {
    setPersonality(opt.id);
    showBubble(`${opt.label}模式：${opt.hint}`, 2800);
  };

  const visual = resolveVisualBehavior(behavior);
  const catalogName = petDef(pet.id)?.name ?? pet.name;

  return (
    <div className={`demo-shell${embed ? " is-embed" : ""}`}>
      {!embed && (
        <header className="demo-top">
          <a className="demo-brand" href="https://virtualpet.beer/">
            绒窝 <span>FluffNest</span>
          </a>
          <p className="demo-note">网页试玩 · 本地台词 · 无需 API Key</p>
        </header>
      )}

      <div className="demo-stage-card">
        <div
          className="pet-root demo-pet-root"
          role="button"
          tabIndex={0}
          aria-label={`点击和${catalogName}互动`}
          onClick={onPetClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPetClick();
            }
          }}
        >
          <div className="pet-main">
            {bubble && <div className="bubble">{bubble}</div>}
            <div className="stage">
              <div className="fx fx-sparkle" aria-hidden>
                <i />
                <i />
                <i />
              </div>
              <div className="figure-wrap">
                <PetFigure
                  key={pet.id}
                  species={pet.id}
                  behavior={visual}
                  facing={facing}
                  size={168}
                />
              </div>
            </div>
            <div className="name-tag">{catalogName}</div>
          </div>
        </div>
        <p className="demo-hint">点一下宠物互动 · 会自己眨眼蹦跳</p>
      </div>

      {!embed && (
        <>
          <section className="demo-controls" aria-label="试玩选项">
            <div className="demo-field">
              <span className="demo-label">换一只</span>
              <div className="demo-chips">
                {DEMO_PETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={p.id === pet.id ? "is-on" : ""}
                    onClick={() => switchPet(p)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="demo-field">
              <span className="demo-label">性格</span>
              <div className="demo-chips">
                {PERSONALITIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={p.id === personality ? "is-on" : ""}
                    onClick={() => switchPersonality(p)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <footer className="demo-foot">
            <p>
              试玩版没有天气 / 新闻 / AI 对话。完整能力请下载 macOS 桌宠，在本地配置你自己的 API Key。
            </p>
            <div className="demo-cta">
              <a
                className="demo-btn primary"
                href="https://github.com/zhaizhch/fluffnest/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
              >
                下载 macOS 版
              </a>
              <a
                className="demo-btn ghost"
                href="https://github.com/zhaizhch/fluffnest"
                target="_blank"
                rel="noopener noreferrer"
              >
                源码
              </a>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

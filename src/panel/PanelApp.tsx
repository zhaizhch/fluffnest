import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type InteractAction } from "../lib/api";
import { crossedTier, nextTierProgress } from "../lib/bondTiers";
import { DAILY_BOND_CAP } from "../lib/careRules";
import { weekRewardPreview } from "../lib/dailyRewards";
import {
  categoryDexProgress,
  overallDexProgress,
  unlockSourceLabel,
} from "../lib/dexProgress";
import { llmFromSettings, wechatFromSettings, withLlm, withWechat } from "../lib/llm";
import {
  PET_CATEGORIES,
  categoryLabel,
  petDef,
  type PetCategoryId,
} from "../lib/petCatalog";
import { PERSONALITIES, personalityLabel } from "../lib/personality";
import type {
  AppState,
  ChatMessage,
  ImDraftResult,
  ImMessage,
  ReminderRule,
  WechatLoginStart,
  WechatNotifStatus,
  WechatStatus,
} from "../lib/types";
import { PetFigure } from "../pet/PetFigure";
import "./panel.css";

type Tab =
  | "status"
  | "chat"
  | "roster"
  | "reminders"
  | "shop"
  | "wechat"
  | "settings";

const COIN_HINT =
  "金币：提醒打卡 +5 · 登录礼 · 亲密度升档礼 · 小铺花币解锁宠物";

export function PanelApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("status");
  const [rosterFilter, setRosterFilter] = useState<PetCategoryId | "all">(
    "all",
  );
  const [meetingTitle, setMeetingTitle] = useState("站会");
  const [meetingAt, setMeetingAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [fortuneText, setFortuneText] = useState<string | null>(null);
  const [fortuneBusy, setFortuneBusy] = useState(false);
  const [imInbox, setImInbox] = useState<ImMessage[]>([]);
  const [wxStatus, setWxStatus] = useState<WechatStatus | null>(null);
  const [wxNotif, setWxNotif] = useState<WechatNotifStatus | null>(null);
  const [wxQr, setWxQr] = useState<WechatLoginStart | null>(null);
  const [wxBusy, setWxBusy] = useState(false);
  const [draftTarget, setDraftTarget] = useState<ImDraftResult | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const wxPollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const s = await api.getState();
    setState(s);
    setChatHistory(s.chatHistory ?? []);
    setImInbox(s.imInbox ?? []);
  }, []);

  const refreshWechat = useCallback(async () => {
    try {
      const [st, nf, inbox] = await Promise.all([
        api.wechatStatus(),
        api.wechatNotifStatus(),
        api.getImInbox(),
      ]);
      setWxStatus(st);
      setWxNotif(nf);
      setImInbox(inbox);
    } catch {
      /* ignore when sidecar cold */
    }
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    refreshWechat().catch(console.error);
  }, [refresh, refreshWechat]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen("im-inbox-updated", () => {
        void refreshWechat();
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, [refreshWechat]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<string>("open-panel-tab", (e) => {
        if (e.payload === "wechat") setTab("wechat");
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (tab !== "wechat") return;
    refreshWechat().catch(console.error);
  }, [tab, refreshWechat]);

  useEffect(() => {
    return () => {
      if (wxPollRef.current) window.clearInterval(wxPollRef.current);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatBusy]);

  const toast = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2800);
  };

  useEffect(() => {
    const s = state?.settings;
    if (!s) return;
    const llm = llmFromSettings(s);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    if (
      llm.lastFortuneDate === todayStr &&
      llm.cachedFortune?.trim() &&
      !fortuneText
    ) {
      setFortuneText(llm.cachedFortune);
    }
  }, [state?.settings, fortuneText]);

  const loadFortune = async (forceToast = true) => {
    setFortuneBusy(true);
    try {
      const payload = await api.triggerProactive("fortune");
      setFortuneText(payload.text);
      if (forceToast) toast("今日运势已更新");
      await refresh();
    } catch (e) {
      toast(String(e));
    } finally {
      setFortuneBusy(false);
    }
  };

  const active = useMemo(
    () => state?.pets.find((p) => p.isActive && p.unlocked) ?? null,
    [state],
  );

  const bondProgress = useMemo(
    () => (active ? nextTierProgress(active.bond) : null),
    [active],
  );

  const dexOverall = useMemo(
    () => (state ? overallDexProgress(state.pets) : null),
    [state],
  );

  const dexByCat = useMemo(
    () => (state ? categoryDexProgress(state.pets) : []),
    [state],
  );

  const weekPreview = useMemo(() => weekRewardPreview(), []);

  const affordableHint = useMemo(() => {
    if (!state) return null;
    const candidates = state.shopCatalog
      .filter(
        (p) =>
          p.available &&
          p.currency === "coin" &&
          p.type === "pet_unlock" &&
          !state.pets.some((x) => x.speciesId === p.targetId && x.unlocked),
      )
      .sort((a, b) => a.amount - b.amount);
    const buyable = candidates.find((p) => p.amount <= state.wallet.coin);
    if (buyable) {
      return `余额够买「${buyable.name}」（${buyable.amount} 币）`;
    }
    const cheapest = candidates[0];
    if (cheapest) {
      return `再攒 ${cheapest.amount - state.wallet.coin} 币可买「${cheapest.name}」`;
    }
    return null;
  }, [state]);

  if (!state || !active) {
    return <div className="panel loading">绒窝加载中…</div>;
  }

  const def = petDef(active.speciesId);
  const daily = state.dailyLogin;
  // Highlight claimed day in cycle, or pending reward day
  const highlightDay = daily.claimedToday
    ? ((((daily.streak - 1) % 7) + 7) % 7) + 1
    : undefined;
  const pendingDay = daily.pendingRewards[0]
    ? weekPreview.find((w) => w.label === daily.pendingRewards[0]?.label)?.day
    : undefined;

  return (
    <div className="panel-scroll">
      <div className="panel">
        <header className="panel-header">
          <div>
            <h1>绒窝</h1>
            <p>
              FluffNest · 多风格桌宠
              {state.settings.isAdmin ? " · 管理员" : ""}
            </p>
          </div>
          <div className="wallet">
            <span>🪙 {state.wallet.coin}</span>
            <span>💎 {state.wallet.gem}</span>
          </div>
        </header>

        <section className="daily-banner">
          <div className="daily-banner-main">
            <div>
              <strong>
                {daily.claimedToday ? "登录礼已领" : "今日登录礼（请领取）"}
              </strong>
              <small>
                连续 {daily.streak} 天
                {!daily.claimedToday &&
                  ` · ${daily.pendingRewards[0]?.label ?? "领取奖励"}`}
              </small>
            </div>
            {!daily.claimedToday && (
              <button
                className="primary"
                onClick={async () => {
                  try {
                    const pendingLabel =
                      daily.pendingRewards[0]?.label ?? "已领取";
                    const unlockedBefore = state.pets.filter(
                      (p) => p.unlocked,
                    ).length;
                    const coinBefore = state.wallet.coin;
                    const next = await api.claimDailyLogin();
                    setState(next);
                    const unlockedAfter = next.pets.filter(
                      (p) => p.unlocked,
                    ).length;
                    const gained = next.wallet.coin - coinBefore;
                    const detail =
                      unlockedAfter > unlockedBefore
                        ? pendingLabel
                        : gained > 0
                          ? gained === 80
                            ? `已拥有该宠物，折合 +${gained} 币`
                            : `+${gained} 币`
                          : pendingLabel;
                    toast(
                      `已领取 · 连续 ${next.dailyLogin.streak} 天 · ${detail}`,
                    );
                  } catch (e) {
                    toast(String(e));
                  }
                }}
              >
                领取
              </button>
            )}
          </div>
          <div className="week-preview" aria-label="七日登录预览">
            {weekPreview.map((day) => {
              const activeDay =
                pendingDay === day.day ||
                (daily.claimedToday && highlightDay === day.day);
              return (
                <div
                  key={day.day}
                  className={`week-day ${activeDay ? "active" : ""} ${
                    day.kind === "pet" ? "pet" : "coin"
                  }`}
                  title={day.label}
                >
                  <em>D{day.day}</em>
                  <span>{day.kind === "pet" ? "宠" : `${day.amount}`}</span>
                </div>
              );
            })}
          </div>
        </section>

        <nav className="tabs">
          {(
            [
              ["status", "状态"],
              ["wechat", "微信"],
              ["chat", "对话"],
              ["roster", "图鉴"],
              ["reminders", "提醒"],
              ["shop", "小铺"],
              ["settings", "设置"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`${tab === id ? "active" : ""}${id === "wechat" ? " tab-wechat" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        {message && <div className="toast">{message}</div>}

        {tab === "status" && (
          <section className="card">
            <div className="status-hero">
              <PetFigure
                species={active.speciesId}
                behavior="idle"
                size={140}
              />
              <div>
                <h2>
                  {active.name}
                  <small>
                    {def
                      ? `${categoryLabel(def.category)} · ${def.vibe}`
                      : active.speciesId}
                  </small>
                </h2>
                <p className="meta">
                  <span className="badge bond">
                    {bondProgress?.label ?? `亲密度 ${active.bond}`}
                  </span>
                  <span className="badge">{personalityLabel(active.personality)}</span>
                </p>
                {bondProgress && (
                  <div className="bond-track" title="亲密度档位进度">
                    <div
                      className="bond-fill"
                      style={{ width: `${Math.round(bondProgress.ratio * 100)}%` }}
                    />
                  </div>
                )}
                {bondProgress?.next && (
                  <p className="bond-next">
                    下一档「{bondProgress.next.label}」· 升档礼 +
                    {bondProgress.next.coinGift} 币
                  </p>
                )}
              </div>
            </div>
            <div className="bars">
              <Bar label="心情" value={active.mood} color="#d4a090" />
              <Bar
                label="今日好感"
                value={Math.min(
                  100,
                  Math.round(
                    ((state.dailyCare?.bondGained ?? 0) / DAILY_BOND_CAP) * 100,
                  ),
                )}
                color="#b8a0c8"
                display={`${state.dailyCare?.bondGained ?? 0}/${DAILY_BOND_CAP}`}
              />
            </div>

            <div className="wechat-entry">
              <div>
                <strong>微信联动</strong>
                <small>
                  {wxStatus?.loggedIn
                    ? "ClawBot 已登录"
                    : wxNotif?.watching
                      ? "通知感知监听中"
                      : "未连接 · 普通微信消息需开通知感知"}
                </small>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => setTab("wechat")}
              >
                去连接
              </button>
            </div>

            <h3>性格切换</h3>
            <p className="hint">每只宠物都可切换；对话、天气叮嘱、提醒语音都会跟着变。</p>
            <div className="pet-switch personality-switch">
              {PERSONALITIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  className={active.personality === p.id ? "active-chip" : ""}
                  onClick={async () => {
                    if (active.personality === p.id) return;
                    try {
                      await api.setPetPersonality(p.id, active.id);
                      await refresh();
                      toast(`已切换为${p.label}`);
                    } catch (e) {
                      toast(String(e));
                    }
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <p className="hint coin-hint">{COIN_HINT}</p>
            <p className="hint">
              点击宠物或下方按钮互动；开启 AI 后台词会按性格生成。今日好感最多 +
              {DAILY_BOND_CAP}。登录礼需点「领取」。
            </p>

            <h3>今日运势</h3>
            <div className="row wrap fortune-actions">
              <button
                disabled={
                  fortuneBusy || !llmFromSettings(state.settings).enabled
                }
                onClick={() => void loadFortune(true)}
              >
                {fortuneBusy
                  ? "测算中…"
                  : fortuneText
                    ? "再看一遍"
                    : "测今日运势"}
              </button>
              {!llmFromSettings(state.settings).enabled && (
                <span className="hint warn">需先在设置里开启 AI</span>
              )}
            </div>
            {fortuneText ? (
              <div className="fortune-panel">{fortuneText}</div>
            ) : (
              <p className="hint">
                结合大模型生成宜忌、穿搭与详细分析；同日再次点击会直接读取缓存。
              </p>
            )}

            <h3>互动</h3>
            <div className="row wrap">
              {(
                [
                  ["pat", "轻拍"],
                  ["poke", "戳戳"],
                  ["hug", "抱抱"],
                  ["tickle", "挠痒"],
                  ["feed", "投喂"],
                  ["play", "逗玩"],
                ] as [InteractAction, string][]
              ).map(([action, label]) => {
                return (
                  <button
                    key={action}
                    onClick={async () => {
                      const before = active.bond;
                      const coinBefore = state.wallet.coin;
                      const bondBeforeDaily = state.dailyCare?.bondGained ?? 0;
                      try {
                        await api.interact(action);
                        const next = await api.getState();
                        setState(next);
                        const pet = next.pets.find(
                          (p) => p.isActive && p.unlocked,
                        );
                        const crossed = pet
                          ? crossedTier(before, pet.bond)
                          : null;
                        const gift = next.wallet.coin - coinBefore;
                        const dailyNow = next.dailyCare?.bondGained ?? 0;
                        if (crossed && gift > 0) {
                          toast(
                            `${label} · 关系升温「${crossed.label}」· +${gift} 币`,
                          );
                        } else if (
                          dailyNow >= DAILY_BOND_CAP &&
                          bondBeforeDaily < DAILY_BOND_CAP
                        ) {
                          toast(`${label} · 今日好感已达上限`);
                        } else if (dailyNow >= DAILY_BOND_CAP) {
                          toast(`${label} · 好感已满`);
                        } else {
                          toast(label);
                        }
                      } catch (e) {
                        toast(String(e));
                      }
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <h3>快速切换</h3>
            <div className="pet-switch">
              {state.pets
                .filter((p) => p.unlocked)
                .map((p) => (
                  <button
                    key={p.id}
                    className={p.isActive ? "active-chip" : ""}
                    onClick={async () => {
                      try {
                        await api.switchPet(p.id);
                        await refresh();
                      } catch (e) {
                        toast(String(e));
                      }
                    }}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
          </section>
        )}

        {tab === "chat" && (
          <section className="card chat-card">
            <h2>和 {active.name} 聊天</h2>
            <p className="hint">
              回复会按「{personalityLabel(active.personality)}」性格生成，并同步到桌面气泡。
            </p>
            {!llmFromSettings(state.settings).enabled && (
              <p className="hint warn">请先在「设置」里开启 AI 并填写 API Key。</p>
            )}
            <div className="chat-log">
              {chatHistory.length === 0 && (
                <div className="chat-empty">还没有对话，跟 {active.name} 打个招呼吧。</div>
              )}
              {chatHistory.map((m, i) => (
                <div
                  key={`${m.at ?? i}-${i}`}
                  className={`chat-bubble ${m.role === "user" ? "me" : "pet"}`}
                >
                  <small>{m.role === "user" ? "你" : active.name}</small>
                  <p>{m.content}</p>
                </div>
              ))}
              {chatBusy && (
                <div className="chat-bubble pet thinking">
                  <small>{active.name}</small>
                  <p>在想怎么回你…</p>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="chat-compose">
              <input
                value={chatInput}
                disabled={chatBusy}
                placeholder={`跟 ${active.name} 说点什么…`}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  const text = chatInput.trim();
                  if (!text || chatBusy) return;
                  setChatBusy(true);
                  setChatInput("");
                  setChatHistory((h) => [
                    ...h,
                    { role: "user", content: text, at: new Date().toISOString() },
                  ]);
                  try {
                    const reply = await api.chatWithPet(text);
                    setChatHistory((h) => [...h, reply]);
                    await refresh();
                  } catch (err) {
                    toast(String(err));
                    setChatHistory((h) => h.slice(0, -1));
                    setChatInput(text);
                  } finally {
                    setChatBusy(false);
                  }
                }}
              />
              <button
                className="primary"
                disabled={chatBusy || !chatInput.trim()}
                onClick={async () => {
                  const text = chatInput.trim();
                  if (!text || chatBusy) return;
                  setChatBusy(true);
                  setChatInput("");
                  setChatHistory((h) => [
                    ...h,
                    { role: "user", content: text, at: new Date().toISOString() },
                  ]);
                  try {
                    const reply = await api.chatWithPet(text);
                    setChatHistory((h) => [...h, reply]);
                    await refresh();
                  } catch (err) {
                    toast(String(err));
                    setChatHistory((h) => h.slice(0, -1));
                    setChatInput(text);
                  } finally {
                    setChatBusy(false);
                  }
                }}
              >
                发送
              </button>
            </div>
            <div className="row chat-actions">
              <button
                onClick={async () => {
                  await api.clearChatHistory();
                  setChatHistory([]);
                  toast("已清空对话");
                }}
              >
                清空记录
              </button>
            </div>
          </section>
        )}

        {tab === "roster" && (
          <section className="card">
            <h2>
              宠物图鉴
              {dexOverall && (
                <small className="dex-total">
                  {" "}
                  已解锁 {dexOverall.unlocked}/{dexOverall.total}
                </small>
              )}
            </h2>
            <p className="hint">
              按分类收集；点已解锁切换出战。锁定卡显示获取途径。
            </p>
            <div className="category-chips">
              <button
                type="button"
                className={rosterFilter === "all" ? "active" : ""}
                onClick={() => setRosterFilter("all")}
              >
                全部
              </button>
              {PET_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={rosterFilter === c.id ? "active" : ""}
                  onClick={() => setRosterFilter(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {(rosterFilter === "all"
              ? PET_CATEGORIES
              : PET_CATEGORIES.filter((c) => c.id === rosterFilter)
            ).map((cat) => {
              const pets = state.pets.filter(
                (p) => petDef(p.speciesId)?.category === cat.id,
              );
              if (!pets.length) return null;
              const prog = dexByCat.find((d) => d.categoryId === cat.id);
              return (
                <div key={cat.id} className="roster-category">
                  <div className="roster-category-head">
                    <h3>
                      {cat.label}
                      <small>{cat.blurb}</small>
                    </h3>
                    <span className="roster-count">
                      {prog?.unlocked ?? 0}/{prog?.total ?? pets.length}
                      {prog?.badgeLabel && (
                        <em className={`dex-badge ${prog.badge}`}>
                          {prog.badgeLabel}
                        </em>
                      )}
                    </span>
                  </div>
                  <div className="grid">
                    {pets.map((p) => {
                      const d = petDef(p.speciesId);
                      const locked = !p.unlocked;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`skin-card ${locked ? "locked" : "owned"} ${
                            p.isActive ? "equipped" : ""
                          }`}
                          disabled={locked}
                          onClick={async () => {
                            try {
                              await api.switchPet(p.id);
                              await refresh();
                              toast(`切换为 ${p.name}`);
                            } catch (e) {
                              toast(String(e));
                            }
                          }}
                        >
                          <span className="skin-preview" aria-hidden>
                            <PetFigure
                              species={p.speciesId}
                              behavior="idle"
                              size={88}
                            />
                          </span>
                          <span className="skin-meta">
                            <strong>
                              {locked ? `🔒 ${p.name}` : p.name}
                            </strong>
                            <small>{d?.vibe ?? p.speciesId}</small>
                            <small>
                              {d?.rarity ?? ""} ·{" "}
                              {p.isActive
                                ? "当前出战"
                                : locked
                                  ? unlockSourceLabel(p.speciesId)
                                  : "点击切换"}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {tab === "reminders" && (
          <section className="card">
            <h2>提醒</h2>
            <p className="hint">
              打卡 +5 币 · 好感最多 +3（计入今日上限）
            </p>
            <div className="list">
              {state.reminders.map((r) => (
                <ReminderRow
                  key={r.id}
                  rule={r}
                  onChange={async (next) => {
                    await api.upsertReminder(next);
                    await refresh();
                  }}
                  onDelete={async () => {
                    await api.deleteReminder(r.id);
                    await refresh();
                  }}
                  onDone={async () => {
                    try {
                      await api.completeReminder(r.id);
                      await refresh();
                      toast("打卡成功 · +5 币");
                    } catch (e) {
                      toast(String(e));
                    }
                  }}
                />
              ))}
            </div>
            <h3>添加手动会议</h3>
            <div className="row">
              <input
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="标题"
              />
              <input
                type="datetime-local"
                value={meetingAt}
                onChange={(e) => setMeetingAt(e.target.value)}
              />
              <button
                className="primary"
                onClick={async () => {
                  if (!meetingAt) return;
                  const iso = new Date(meetingAt).toISOString();
                  await api.addMeetingReminder(meetingTitle || "会议", iso);
                  await refresh();
                  toast("已添加会议提醒");
                }}
              >
                添加
              </button>
            </div>
          </section>
        )}

        {tab === "shop" && (
          <section className="card">
            <h2>绒窝小铺</h2>
            <p className="hint">{COIN_HINT}</p>
            {affordableHint && (
              <p className="hint shop-afford">{affordableHint}</p>
            )}
            {PET_CATEGORIES.map((cat) => {
              const products = state.shopCatalog.filter(
                (p) => petDef(p.targetId)?.category === cat.id,
              );
              if (!products.length) return null;
              return (
                <div key={cat.id} className="roster-category">
                  <div className="roster-category-head">
                    <h3>
                      {cat.label}
                      <small>{cat.blurb}</small>
                    </h3>
                  </div>
                  <div className="list">
                    {products.map((p) => {
                      const owned =
                        p.type === "pet_unlock" &&
                        state.pets.some(
                          (x) => x.speciesId === p.targetId && x.unlocked,
                        );
                      const real = p.currency === "real";
                      return (
                        <div key={p.id} className="shop-row">
                          <div>
                            <strong>{p.name}</strong>
                            <small>
                              {p.rarity} · {p.sku}
                              {p.iapProductId ? ` · ${p.iapProductId}` : ""}
                            </small>
                          </div>
                          <button
                            disabled={owned || !p.available || real}
                            onClick={async () => {
                              try {
                                const next = await api.purchaseProduct(p.id);
                                setState(next);
                                toast(`已解锁`);
                              } catch (e) {
                                toast(String(e));
                              }
                            }}
                          >
                            {owned
                              ? "已拥有"
                              : real || !p.available
                                ? "即将开放"
                                : `${p.amount} ${p.currency}`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {tab === "wechat" && state && (
          <section className="card wechat-card">
            <h2>微信联动</h2>
            <p className="hint">
              <strong>普通好友来信</strong>请用下面①通知感知；
              <strong>跟桌宠微信聊天</strong>请用②扫码登录 ClawBot。
              两者可同时开。消息只存本机。
            </p>

            {(() => {
              const wx = wechatFromSettings(state.settings);
              const patchWx = async (patch: Parameters<typeof withWechat>[1]) => {
                const next = withWechat(state.settings, patch);
                const saved = await api.updateSettings(next);
                setState({ ...state, settings: saved });
                await refreshWechat();
              };
              return (
                <>
                  <div className="wechat-step">
                    <h3>① 收普通微信消息（通知感知）</h3>
                    <p className="hint">
                      读取 macOS 微信通知横幅 / Dock 未读角标。请务必：
                      <br />
                      1）系统设置 → 隐私与安全性 → 辅助功能 → 勾选
                      <strong> FluffNest / fluffnest </strong>
                      （开发版二进制名常为 fluffnest）
                      <br />
                      2）微信通知开横幅；测试时让微信<strong>退到后台</strong>（不要前置窗口）
                    </p>
                    <div className="wechat-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={async () => {
                          try {
                            await api.openAccessibilitySettings();
                            if (!wxNotif?.trusted) {
                              toast("请勾选 FluffNest/fluffnest 后回到这里再开一次");
                            }
                            await patchWx({ notifEnabled: true });
                            await refreshWechat();
                            const st = await api.wechatNotifStatus();
                            setWxNotif(st);
                            toast(
                              st.trusted
                                ? st.watching
                                  ? "通知感知已运行，请把微信退到后台再测"
                                  : "已开启，正在启动监听…"
                                : "已开启，但辅助功能未授权 — 请勾选后重启绒窝",
                            );
                          } catch (err) {
                            toast(String(err));
                          }
                        }}
                      >
                        {wx.notifEnabled ? "通知感知已开" : "一键开启通知感知"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.openAccessibilitySettings();
                          } catch (e) {
                            toast(String(e));
                          }
                        }}
                      >
                        打开辅助功能
                      </button>
                      {wx.notifEnabled && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await patchWx({ notifEnabled: false });
                              toast("已关闭通知感知");
                            } catch (e) {
                              toast(String(e));
                            }
                          }}
                        >
                          关闭
                        </button>
                      )}
                    </div>
                    <p className="meta">
                      辅助功能：{wxNotif?.trusted ? "已授权 ✓" : "未授权 ✗"}
                      {" · "}
                      监听：{wxNotif?.watching ? "运行中 ✓" : "未运行"}
                    </p>
                  </div>

                  <div className="wechat-step">
                    <h3>② 扫码登录 ClawBot（跟桌宠聊）</h3>
                    <p className="hint">
                      需微信已开通 ClawBot / iLink。登录后，微信私聊走完整 Agent（tools / rules / skills / memory / cycle）：先检索再整理，自动发回。
                    </p>
                    <div className="wechat-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={wxBusy}
                        onClick={async () => {
                          setWxBusy(true);
                          try {
                            const start = await api.wechatLoginStart();
                            if (!start.qrImage) {
                              throw new Error("未返回二维码图片，请重试");
                            }
                            setWxQr(start);
                            await patchWx({ clawbotEnabled: true });
                            toast("请用微信扫一扫");
                            if (wxPollRef.current)
                              window.clearInterval(wxPollRef.current);
                            wxPollRef.current = window.setInterval(() => {
                              api
                                .wechatLoginPoll()
                                .then((st) => {
                                  setWxStatus(st);
                                  if (st.loggedIn) {
                                    if (wxPollRef.current)
                                      window.clearInterval(wxPollRef.current);
                                    wxPollRef.current = null;
                                    setWxQr(null);
                                    toast("ClawBot 已登录，微信消息将由大模型自动回复");
                                    refresh().catch(console.error);
                                    refreshWechat().catch(console.error);
                                  }
                                })
                                .catch(() => undefined);
                            }, 2000);
                          } catch (e) {
                            toast(
                              String(e).includes("二维码")
                                ? `${String(e)}（若暂无 ClawBot，请先用上面的通知感知收普通消息）`
                                : String(e),
                            );
                          } finally {
                            setWxBusy(false);
                          }
                        }}
                      >
                        {wxStatus?.loggedIn ? "重新扫码登录" : "显示登录二维码"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const st = await api.wechatLogout();
                            setWxStatus(st);
                            setWxQr(null);
                            toast("已断开 ClawBot");
                            await refresh();
                          } catch (e) {
                            toast(String(e));
                          }
                        }}
                      >
                        断开登录
                      </button>
                    </div>
                    {wxQr?.qrImage ? (
                      <div className="wechat-qr">
                        <img
                          src={wxQr.qrImage}
                          alt="微信登录二维码"
                          onError={() =>
                            toast("二维码图片加载失败，请重新点「显示登录二维码」")
                          }
                        />
                        <small>微信扫一扫确认 ClawBot</small>
                      </div>
                    ) : (
                      <p className="meta">
                        状态：
                        {wxStatus?.loggedIn
                          ? `已登录${wxStatus.polling ? " · 轮询收信中" : ""}`
                          : "未登录 · 点上方按钮显示二维码"}
                      </p>
                    )}
                  </div>

                  <div className="wechat-step">
                    <h3>选项</h3>
                    <div className="toggles">
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={wx.autoReplyFromWechat}
                          onChange={async (e) => {
                            try {
                              await patchWx({
                                autoReplyFromWechat: e.target.checked,
                              });
                            } catch (err) {
                              toast(String(err));
                            }
                          }}
                        />
                        微信消息经 Agent 自动回复（仅 ClawBot）
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={wx.ttsOnIncoming}
                          onChange={async (e) => {
                            try {
                              await patchWx({ ttsOnIncoming: e.target.checked });
                            } catch (err) {
                              toast(String(err));
                            }
                          }}
                        />
                        来信朗读
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={wx.urgentBreaksFocus}
                          onChange={async (e) => {
                            try {
                              await patchWx({
                                urgentBreaksFocus: e.target.checked,
                              });
                            } catch (err) {
                              toast(String(err));
                            }
                          }}
                        />
                        紧急消息可打断专注
                      </label>
                    </div>
                    <label className="field">
                      未读催促（分钟，0=关）
                      <input
                        type="number"
                        min={0}
                        max={240}
                        value={wx.nudgeMinutes}
                        onChange={async (e) => {
                          const n = Number(e.target.value) || 0;
                          try {
                            await patchWx({ nudgeMinutes: n });
                          } catch (err) {
                            toast(String(err));
                          }
                        }}
                      />
                    </label>
                    <div className="wechat-actions">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.simulateImMessage(
                              "测试好友",
                              "嗨，这是一条测试微信～",
                            );
                            await refresh();
                            await refreshWechat();
                            toast("已模拟来信，看看桌宠有没有反应");
                          } catch (e) {
                            toast(String(e));
                          }
                        }}
                      >
                        模拟来信（测桌宠）
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}

            {draftTarget && (
              <div className="im-draft">
                <h3>来信 · 回复建议</h3>
                <p className="im-draft-incoming-label">
                  {draftTarget.sender || "对方"} 说
                </p>
                <pre className="im-draft-incoming">
                  {draftTarget.incoming || "（未读到正文）"}
                </pre>
                {draftTarget.summary &&
                draftTarget.summary !== draftTarget.incoming ? (
                  <p className="hint">概括：{draftTarget.summary}</p>
                ) : null}
                {draftTarget.suggestions?.length > 0 && (
                  <div className="im-suggests">
                    {draftTarget.suggestions.map((s, i) => (
                      <button
                        key={`${i}-${s.slice(0, 12)}`}
                        type="button"
                        className={draftText === s ? "active" : ""}
                        onClick={() => setDraftText(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  rows={3}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="写回复或点选上方建议…"
                />
                <div className="wechat-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={async () => {
                      try {
                        const result = await api.sendImReply(
                          draftTarget.messageId,
                          draftText,
                        );
                        toast(
                          result === "sent"
                            ? "已发送"
                            : result === "pasted"
                              ? "已打开微信并粘贴，回车发送即可"
                              : "已复制并打开微信，输入框 Cmd+V 后回车",
                        );
                        setDraftTarget(null);
                        await refreshWechat();
                      } catch (e) {
                        toast(String(e));
                      }
                    }}
                  >
                    {draftTarget.canSend ? "确认发送" : "复制并打开微信"}
                  </button>
                  <button
                    type="button"
                    disabled={draftBusy}
                    onClick={async () => {
                      try {
                        setDraftBusy(true);
                        const d = await api.draftImReply(
                          draftTarget.messageId,
                          true,
                        );
                        setDraftTarget(d);
                        setDraftText(d.draft);
                        toast("已换一批建议");
                      } catch (e) {
                        toast(String(e));
                      } finally {
                        setDraftBusy(false);
                      }
                    }}
                  >
                    {draftBusy ? "生成中…" : "重新建议"}
                  </button>
                  <button type="button" onClick={() => setDraftTarget(null)}>
                    取消
                  </button>
                </div>
              </div>
            )}

            <h3>
              最近消息
              {imInbox.some((m) => !m.acknowledged) ? (
                <button
                  type="button"
                  className="im-ack-all"
                  onClick={async () => {
                    try {
                      const n = await api.acknowledgeAllImMessages();
                      toast(n > 0 ? `已清除 ${n} 条未读` : "没有未读");
                      await refreshWechat();
                    } catch (e) {
                      toast(String(e));
                    }
                  }}
                >
                  全部已读
                </button>
              ) : null}
            </h3>
            <ul className="im-inbox">
              {[...imInbox].reverse().slice(0, 20).map((m) => (
                <li key={m.id} className={m.acknowledged ? "acked" : ""}>
                  <div>
                    <strong>
                      {m.sender}
                      {m.urgency === "urgent" ? " · 紧急" : ""}
                      {m.source === "notif"
                        ? " · 通知"
                        : m.source === "simulate"
                          ? " · 模拟"
                          : " · ClawBot"}
                    </strong>
                    <p>{m.summary || m.text}</p>
                  </div>
                  <div className="im-actions">
                    {!m.acknowledged && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.acknowledgeImMessage(m.id);
                          await refreshWechat();
                        }}
                      >
                        已读
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const d = await api.draftImReply(m.id);
                          setDraftTarget(d);
                          setDraftText(d.draft);
                        } catch (e) {
                          toast(String(e));
                        }
                      }}
                    >
                      帮我回
                    </button>
                  </div>
                </li>
              ))}
              {imInbox.length === 0 && (
                <li className="empty">暂无来信 · 先点「模拟来信」或开启通知感知</li>
              )}
            </ul>
          </section>
        )}

        {tab === "settings" && (
          <section className="card">
            <h2>设置</h2>
            {(
              [
                ["muted", "静音"],
                ["focusMode", "专注模式"],
                ["alwaysOnTop", "始终置顶"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={Boolean(state.settings[key])}
                  onChange={async (e) => {
                    const next = {
                      ...state.settings,
                      [key]: e.target.checked,
                    };
                    await api.updateSettings(next);
                    await refresh();
                  }}
                />
                {label}
              </label>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(state.settings.isAdmin)}
                onChange={async (e) => {
                  const next = {
                    ...state.settings,
                    isAdmin: e.target.checked,
                  };
                  await api.updateSettings(next);
                  await refresh();
                  toast(
                    e.target.checked
                      ? "已开启管理员（全解锁）"
                      : "已关闭管理员（登录礼需手动领取）",
                  );
                }}
              />
              管理员模式（开发用，会全解锁）
            </label>
            <p className="hint">
              关闭管理员后，登录宠需通过顶部「领取」获得，不会在打开时自动发放。
            </p>

            <h3>AI 大模型</h3>
            <p className="hint">
              兼容 OpenAI Chat Completions（也可用国内中转 / 本地 Ollama 的兼容接口）。
              Key 保存在本机 state.json。
            </p>
            {(() => {
              const llm = llmFromSettings(state.settings);
              const saveLlm = async (
                patch: Parameters<typeof withLlm>[1],
              ) => {
                const next = withLlm(state.settings, patch);
                await api.updateSettings(next);
                await refresh();
              };
              return (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.enabled}
                      onChange={(e) => void saveLlm({ enabled: e.target.checked })}
                    />
                    启用 AI
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.chatEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ chatEnabled: e.target.checked })
                      }
                    />
                    面板对话
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.dialogueEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ dialogueEnabled: e.target.checked })
                      }
                    />
                    互动台词由 AI 生成（点击 / 闲逛 / 提醒）
                  </label>
                  <label className="field">
                    <span>API Base</span>
                    <input
                      value={llm.apiBase}
                      placeholder="https://api.openai.com/v1"
                      onChange={(e) =>
                        setState({
                          ...state,
                          settings: withLlm(state.settings, {
                            apiBase: e.target.value,
                          }),
                        })
                      }
                      onBlur={() => void saveLlm({ apiBase: llm.apiBase })}
                    />
                  </label>
                  <label className="field">
                    <span>API Key</span>
                    <input
                      type="password"
                      value={llm.apiKey}
                      placeholder="sk-…"
                      onChange={(e) =>
                        setState({
                          ...state,
                          settings: withLlm(state.settings, {
                            apiKey: e.target.value,
                          }),
                        })
                      }
                      onBlur={() => void saveLlm({ apiKey: llm.apiKey })}
                    />
                  </label>
                  <label className="field">
                    <span>模型</span>
                    <input
                      value={llm.model}
                      placeholder="gpt-4o-mini"
                      onChange={(e) =>
                        setState({
                          ...state,
                          settings: withLlm(state.settings, {
                            model: e.target.value,
                          }),
                        })
                      }
                      onBlur={() => void saveLlm({ model: llm.model })}
                    />
                  </label>
                  <div className="row">
                    <button
                      className="primary"
                      disabled={!llm.enabled}
                      onClick={async () => {
                        try {
                          // persist current draft fields first
                          await api.updateSettings(
                            withLlm(state.settings, {
                              apiBase: llm.apiBase,
                              apiKey: llm.apiKey,
                              model: llm.model,
                            }),
                          );
                          const line = await api.testLlm();
                          toast(`连通成功：${line}`);
                        } catch (e) {
                          toast(String(e));
                        }
                      }}
                    >
                      测试连接
                    </button>
                  </div>

                  <h3>主动推送</h3>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.proactiveEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ proactiveEnabled: e.target.checked })
                      }
                    />
                    开启主动推送（专注模式时自动暂停）
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.weatherEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ weatherEnabled: e.target.checked })
                      }
                    />
                    天气问候
                  </label>
                  <label className="field">
                    <span>天气城市</span>
                    <input
                      value={llm.weatherCity}
                      onChange={(e) =>
                        setState({
                          ...state,
                          settings: withLlm(state.settings, {
                            weatherCity: e.target.value,
                          }),
                        })
                      }
                      onBlur={() => void saveLlm({ weatherCity: llm.weatherCity })}
                    />
                  </label>
                  <label className="field">
                    <span>天气推送时刻（本地小时 0–23）</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={llm.weatherHour}
                      onChange={(e) =>
                        setState({
                          ...state,
                          settings: withLlm(state.settings, {
                            weatherHour: Number(e.target.value) || 0,
                          }),
                        })
                      }
                      onBlur={() =>
                        void saveLlm({
                          weatherHour: Math.min(23, Math.max(0, llm.weatherHour)),
                        })
                      }
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.jokeEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ jokeEnabled: e.target.checked })
                      }
                    />
                    冷笑话（间隔 {llm.jokeIntervalMinutes} 分钟）
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.newsEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ newsEnabled: e.target.checked })
                      }
                    />
                    科技/娱乐新闻吐槽（间隔 {llm.newsIntervalMinutes} 分钟）
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={llm.fortuneEnabled}
                      disabled={!llm.enabled}
                      onChange={(e) =>
                        void saveLlm({ fortuneEnabled: e.target.checked })
                      }
                    />
                    今日运势晨间推送
                  </label>
                  <label className="field">
                    <span>运势推送时刻（本地小时 0–23）</span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={llm.fortuneHour}
                      onChange={(e) =>
                        setState({
                          ...state,
                          settings: withLlm(state.settings, {
                            fortuneHour: Number(e.target.value) || 0,
                          }),
                        })
                      }
                      onBlur={() =>
                        void saveLlm({
                          fortuneHour: Math.min(23, Math.max(0, llm.fortuneHour)),
                        })
                      }
                    />
                  </label>
                  <div className="row proactive-row">
                    {(
                      [
                        ["fortune", "今日运势"],
                        ["weather", "现在查天气"],
                        ["joke", "讲个冷笑话"],
                        ["news", "科技娱乐"],
                      ] as const
                    ).map(([kind, label]) => (
                      <button
                        key={kind}
                        disabled={!llm.enabled}
                        onClick={async () => {
                          try {
                            const payload = await api.triggerProactive(kind);
                            if (kind === "fortune") {
                              setFortuneText(payload.text);
                              setTab("status");
                              toast("今日运势已更新");
                              await refresh();
                            } else if (kind === "weather" || kind === "news") {
                              toast(payload.detail || payload.text);
                            } else {
                              toast(payload.text);
                            }
                          } catch (e) {
                            toast(String(e));
                          }
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              );
            })()}
          </section>
        )}
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  color,
  display,
}: {
  label: string;
  value: number;
  color: string;
  display?: string;
}) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track">
        <div
          className="fill"
          style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}
        />
      </div>
      <em>{display ?? value}</em>
    </div>
  );
}

function ReminderRow({
  rule,
  onChange,
  onDelete,
  onDone,
}: {
  rule: ReminderRule;
  onChange: (r: ReminderRule) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  return (
    <div className="reminder">
      <div>
        <strong>{rule.title ?? rule.type}</strong>
        <small>
          {rule.type === "meeting"
            ? rule.at
            : `每 ${rule.intervalMinutes ?? "?"} 分钟`}
        </small>
      </div>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
          />
          启用
        </label>
        <button onClick={onDone}>打卡</button>
        <button onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}

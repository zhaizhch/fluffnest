import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type InteractAction } from "../lib/api";
import { crossedTier, nextTierProgress } from "../lib/bondTiers";
import { DAILY_BOND_CAP } from "../lib/careRules";
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
import { PERSONALITIES, isPersonality, personalityHint, personalityLabel } from "../lib/personality";
import type {
  AppState,
  ImDraftResult,
  ImMessage,
  ReminderRule,
  ScheduleJob,
  WechatLoginStart,
  WechatNotifStatus,
  WechatStatus,
} from "../lib/types";
import { PetFigure } from "../pet/PetFigure";
import "./panel.css";

type Tab =
  | "status"
  | "roster"
  | "reminders"
  | "wechat"
  | "settings";

export function PanelApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("status");
  const [rosterFilter, setRosterFilter] = useState<PetCategoryId | "all">(
    "all",
  );
  const [meetingTitle, setMeetingTitle] = useState("站会");
  const [meetingAt, setMeetingAt] = useState("");
  const [schTitle, setSchTitle] = useState("晚间天气预报");
  const [schKind, setSchKind] = useState<"weather_forecast" | "news_brief" | "custom_prompt">(
    "weather_forecast",
  );
  const [schHour, setSchHour] = useState(20);
  const [schMinute, setSchMinute] = useState(0);
  const [schPrompt, setSchPrompt] = useState("");
  const [schChannel, setSchChannel] = useState<"wechat" | "pet">("wechat");
  const [message, setMessage] = useState<string | null>(null);
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
  const [customLabel, setCustomLabel] = useState("");
  const [customNote, setCustomNote] = useState("");
  const [customBusy, setCustomBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const wxPollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const s = await api.getState();
    setState(s);
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

  useEffect(() => {
    if (!active) return;
    if (isPersonality(active.personality)) {
      setCustomLabel("");
      setCustomNote(active.personalityNote?.trim() ? active.personalityNote : "");
      setCustomOpen(!!active.personalityNote?.trim());
    } else {
      setCustomLabel(active.personality);
      setCustomNote(active.personalityNote ?? "");
      setCustomOpen(true);
    }
  }, [active?.id, active?.personality, active?.personalityNote]);

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

  if (!state || !active) {
    return <div className="panel loading">绒窝加载中…</div>;
  }

  const def = petDef(active.speciesId);

  return (
    <div className="panel-scroll">
      <div className="panel">
        <header className="panel-header">
          <div>
            <h1>绒窝</h1>
            <p>
              FluffNest · 暖卡卡
              {state.settings.isAdmin ? " · 管理员" : ""}
            </p>
          </div>
        </header>

        <nav className="tabs">
          {(
            [
              ["status", "状态"],
              ["wechat", "微信"],
              ["roster", "图鉴"],
              ["reminders", "提醒"],
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
                  <span
                    className="badge"
                    title={personalityHint(
                      active.personality,
                      active.personalityNote,
                    )}
                  >
                    {personalityLabel(
                      active.personality,
                      active.personalityNote,
                    )}
                  </span>
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
                    下一档「{bondProgress.next.label}」
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

            <h3>性格</h3>
            <p className="hint">
              可选预设，或自定义标签+描述；对话、天气叮嘱、提醒语音都会跟着变。
            </p>
            <div className="pet-switch personality-switch">
              {PERSONALITIES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  className={
                    active.personality === p.id && !active.personalityNote?.trim()
                      ? "active-chip"
                      : active.personality === p.id
                        ? "active-chip soft"
                        : ""
                  }
                  onClick={async () => {
                    try {
                      await api.setPetPersonality(p.id, active.id, null);
                      setCustomOpen(false);
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
              <button
                type="button"
                title="自己写性格标签和描述"
                className={
                  customOpen || !isPersonality(active.personality)
                    ? "active-chip"
                    : ""
                }
                onClick={() => {
                  setCustomOpen(true);
                  if (isPersonality(active.personality) && !customLabel) {
                    setCustomLabel("我的设定");
                  }
                  if (!customNote.trim() && isPersonality(active.personality)) {
                    setCustomNote(personalityHint(active.personality));
                  }
                }}
              >
                自定义…
              </button>
            </div>
            {customOpen && (
              <div className="personality-custom">
                <label>
                  标签
                  <input
                    value={customLabel}
                    maxLength={16}
                    placeholder="例如：社恐宅 / 毒舌顾问"
                    onChange={(e) => setCustomLabel(e.target.value)}
                  />
                </label>
                <label>
                  描述
                  <textarea
                    value={customNote}
                    maxLength={200}
                    rows={3}
                    placeholder="用几句话写清语气、相处方式、口头禅…"
                    onChange={(e) => setCustomNote(e.target.value)}
                  />
                </label>
                <div className="row wrap">
                  <button
                    type="button"
                    className="primary"
                    disabled={customBusy}
                    onClick={async () => {
                      const label = customLabel.trim();
                      const note = customNote.trim();
                      if (!label) {
                        toast("请填写性格标签");
                        return;
                      }
                      if (note.length < 4) {
                        toast("描述至少 4 个字");
                        return;
                      }
                      setCustomBusy(true);
                      try {
                        await api.setPetPersonality(label, active.id, note);
                        await refresh();
                        toast(`已保存「${label}」性格`);
                      } catch (e) {
                        toast(String(e));
                      } finally {
                        setCustomBusy(false);
                      }
                    }}
                  >
                    {customBusy ? "保存中…" : "保存自定义性格"}
                  </button>
                  {isPersonality(active.personality) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomOpen(false);
                        setCustomNote("");
                      }}
                    >
                      收起
                    </button>
                  )}
                </div>
              </div>
            )}

            <p className="hint">
              点击宠物或下方按钮互动；开启 AI 后台词会按性格生成。今日好感最多 +
              {DAILY_BOND_CAP}。
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
                        const dailyNow = next.dailyCare?.bondGained ?? 0;
                        if (crossed) {
                          toast(`${label} · 关系升温「${crossed.label}」`);
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
              也可对宠物说「取消喝水提醒」或「喝水提醒开了吗」
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

            <h3>定时推送（微信 / 桌宠）</h3>
            <p className="hint">
              例：每晚 20:00 发明日天气到 ClawBot；早 9:00 发过去 24h 资讯简报。微信推送需先给
              ClawBot 发过消息以绑定会话。也可微信说「每天晚上八点把明天天气发到微信」。
            </p>
            <div className="list">
              {(state.schedules ?? []).map((j) => (
                <ScheduleRow
                  key={j.id}
                  job={j}
                  onChange={async (next) => {
                    await api.upsertSchedule(next);
                    await refresh();
                  }}
                  onDelete={async () => {
                    await api.deleteSchedule(j.id);
                    await refresh();
                  }}
                />
              ))}
              {(state.schedules ?? []).length === 0 && (
                <p className="hint">暂无定时任务</p>
              )}
            </div>
            <div className="row wrap">
              <select
                value={schKind}
                onChange={(e) => {
                  const k = e.target.value as typeof schKind;
                  setSchKind(k);
                  if (k === "weather_forecast") {
                    setSchTitle("晚间天气预报");
                    setSchHour(20);
                  } else if (k === "news_brief") {
                    setSchTitle("早间资讯简报");
                    setSchHour(9);
                  } else {
                    setSchTitle("自定义推送");
                  }
                }}
              >
                <option value="weather_forecast">天气预报</option>
                <option value="news_brief">资讯简报</option>
                <option value="custom_prompt">自定义</option>
              </select>
              <input
                value={schTitle}
                onChange={(e) => setSchTitle(e.target.value)}
                placeholder="标题"
              />
              <input
                type="number"
                min={0}
                max={23}
                value={schHour}
                onChange={(e) => setSchHour(Number(e.target.value))}
                style={{ width: 64 }}
                title="小时"
              />
              <span>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={schMinute}
                onChange={(e) => setSchMinute(Number(e.target.value))}
                style={{ width: 64 }}
                title="分钟"
              />
              <select
                value={schChannel}
                onChange={(e) => setSchChannel(e.target.value as "wechat" | "pet")}
              >
                <option value="wechat">发到微信</option>
                <option value="pet">仅桌宠</option>
              </select>
            </div>
            {schKind === "custom_prompt" && (
              <textarea
                value={schPrompt}
                onChange={(e) => setSchPrompt(e.target.value)}
                placeholder="自定义推送说明，例如：用温柔语气总结今日待办"
                rows={2}
              />
            )}
            <button
              className="primary"
              onClick={async () => {
                const params: Record<string, unknown> = {};
                if (schKind === "weather_forecast") params.forTomorrow = true;
                if (schKind === "news_brief") params.lookbackHours = 24;
                if (schKind === "custom_prompt") params.prompt = schPrompt || schTitle;
                const job: ScheduleJob = {
                  id: "",
                  title: schTitle || "定时推送",
                  kind: schKind,
                  channel: schChannel,
                  enabled: true,
                  hour: schHour,
                  minute: schMinute,
                  daysOfWeek: [],
                  params,
                };
                await api.upsertSchedule(job);
                await refresh();
                toast("已添加定时推送");
              }}
            >
              添加定时推送
            </button>
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
                      : "已关闭管理员",
                  );
                }}
              />
              管理员模式（开发用，会全解锁）
            </label>
            <p className="hint">仅开发调试用。</p>

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
                    跟宠物说话（快捷菜单）
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
}: {
  rule: ReminderRule;
  onChange: (r: ReminderRule) => void;
  onDelete: () => void;
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
        <button onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}

function ScheduleRow({
  job,
  onChange,
  onDelete,
}: {
  job: ScheduleJob;
  onChange: (j: ScheduleJob) => void;
  onDelete: () => void;
}) {
  const kindLabel =
    job.kind === "weather_forecast"
      ? "天气"
      : job.kind === "news_brief"
        ? "资讯"
        : "自定义";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="reminder">
      <div>
        <strong>{job.title}</strong>
        <small>
          {kindLabel} · 每天 {pad(job.hour)}:{pad(job.minute)} ·{" "}
          {job.channel === "wechat" ? "微信" : "桌宠"}
        </small>
      </div>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={job.enabled}
            onChange={(e) => onChange({ ...job, enabled: e.target.checked })}
          />
          启用
        </label>
        <button onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type InteractAction } from "../lib/api";
import { crossedTier, nextTierProgress } from "../lib/bondTiers";
import {
  CHECKIN_ENERGY_COST,
  DAILY_BOND_CAP,
  INTERACT_ENERGY_COST,
} from "../lib/careRules";
import { weekRewardPreview } from "../lib/dailyRewards";
import {
  categoryDexProgress,
  overallDexProgress,
  unlockSourceLabel,
} from "../lib/dexProgress";
import {
  PET_CATEGORIES,
  categoryLabel,
  petDef,
  type PetCategoryId,
} from "../lib/petCatalog";
import type { AppState, ReminderRule } from "../lib/types";
import { PetFigure } from "../pet/PetFigure";
import "./panel.css";

type Tab = "status" | "roster" | "reminders" | "shop" | "settings";

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

  const refresh = useCallback(async () => {
    const s = await api.getState();
    setState(s);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const active = useMemo(
    () => state?.pets.find((p) => p.isActive && p.unlocked) ?? null,
    [state],
  );

  const toast = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 2800);
  };

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
              ["roster", "图鉴"],
              ["reminders", "提醒"],
              ["shop", "小铺"],
              ["settings", "设置"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
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
                  <span className="badge">{active.personality}</span>
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
              <Bar label="体力" value={active.energy} color="#8faf98" />
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

            <p className="hint coin-hint">{COIN_HINT}</p>
            <p className="hint">
              互动/打卡消耗体力，闲置时慢慢恢复；今日好感最多 +{DAILY_BOND_CAP}。
              登录礼需点「领取」，不会自动发放。
            </p>

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
                const cost = INTERACT_ENERGY_COST[action] ?? 0;
                return (
                  <button
                    key={action}
                    title={cost > 0 ? `消耗体力 ${cost}` : "恢复体力"}
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
                        } else if (dailyNow >= DAILY_BOND_CAP && bondBeforeDaily < DAILY_BOND_CAP) {
                          toast(`${label} · 今日好感已达上限`);
                        } else if (
                          dailyNow >= DAILY_BOND_CAP &&
                          bondBeforeDaily >= DAILY_BOND_CAP
                        ) {
                          toast(`${label} · 好感已满，体力照常结算`);
                        } else {
                          toast(
                            cost > 0 ? `${label} · 体力 -${cost}` : `${label} · 体力恢复`,
                          );
                        }
                      } catch (e) {
                        toast(String(e));
                      }
                    }}
                  >
                    {label}
                    {cost > 0 ? (
                      <small className="cost"> -{cost}</small>
                    ) : (
                      <small className="cost rest"> +体力</small>
                    )}
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
              打卡消耗体力 {CHECKIN_ENERGY_COST}，+5 币 · 好感最多 +3（计入今日上限）
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
                      toast(
                        `打卡成功 · 体力 -${CHECKIN_ENERGY_COST} · +5 币`,
                      );
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

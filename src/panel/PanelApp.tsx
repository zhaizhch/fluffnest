import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type InteractAction } from "../lib/api";
import {
  PET_CATALOG,
  PET_CATEGORIES,
  categoryLabel,
  petDef,
  type PetCategoryId,
} from "../lib/petCatalog";
import type { AppState, ReminderRule } from "../lib/types";
import { SpritePet } from "../pet/SpritePet";
import "./panel.css";

type Tab = "status" | "roster" | "reminders" | "shop" | "settings";

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
    window.setTimeout(() => setMessage(null), 2400);
  };

  if (!state || !active) {
    return <div className="panel loading">绒窝加载中…</div>;
  }

  const def = petDef(active.speciesId);
  const daily = state.dailyLogin;

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

        {!daily.claimedToday && (
          <section className="daily-banner">
            <div>
              <strong>今日登录礼</strong>
              <small>{daily.pendingRewards[0]?.label ?? "领取奖励"}</small>
            </div>
            <button
              className="primary"
              onClick={async () => {
                try {
                  const next = await api.claimDailyLogin();
                  setState(next);
                  toast(`已领取 · 连续 ${next.dailyLogin.streak} 天`);
                } catch (e) {
                  toast(String(e));
                }
              }}
            >
              领取
            </button>
          </section>
        )}

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
              <SpritePet
                species={active.speciesId}
                behavior="idle"
                size={140}
              />
              <div>
                <h2>
                  {active.name}
                  <small>
                    {def ? `${categoryLabel(def.category)} · ${def.vibe}` : active.speciesId}
                  </small>
                </h2>
                <p className="meta">
                  <span className="badge">亲密度 {active.bond}</span>
                  <span className="badge">{active.personality}</span>
                </p>
              </div>
            </div>
            <div className="bars">
              <Bar label="心情" value={active.mood} color="#d4a090" />
              <Bar label="体力" value={active.energy} color="#8faf98" />
            </div>

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
              ).map(([action, label]) => (
                <button
                  key={action}
                  onClick={async () => {
                    await api.interact(action);
                    await refresh();
                    toast(label);
                  }}
                >
                  {label}
                </button>
              ))}
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
            <h2>宠物图鉴 · {PET_CATALOG.length} 只</h2>
            <p className="hint">
              按分类浏览；点名字切换出战。未解锁的需在小铺或登录礼获得。
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
            {(rosterFilter === "all" ? PET_CATEGORIES : PET_CATEGORIES.filter((c) => c.id === rosterFilter)).map(
              (cat) => {
                const pets = state.pets.filter(
                  (p) => petDef(p.speciesId)?.category === cat.id,
                );
                if (!pets.length) return null;
                const unlockedCount = pets.filter((p) => p.unlocked).length;
                return (
                  <div key={cat.id} className="roster-category">
                    <div className="roster-category-head">
                      <h3>
                        {cat.label}
                        <small>{cat.blurb}</small>
                      </h3>
                      <span className="roster-count">
                        {unlockedCount}/{pets.length}
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
                              <SpritePet
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
                                    ? "未解锁"
                                    : "点击切换"}
                              </small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              },
            )}
          </section>
        )}

        {tab === "reminders" && (
          <section className="card">
            <h2>提醒</h2>
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
                    await api.completeReminder(r.id);
                    await refresh();
                    toast("打卡 +5 币");
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
            <p className="hint">用金币解锁更多风格宠物。实付商品显示「即将开放」。</p>
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
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bar">
      <span>{label}</span>
      <div className="track">
        <div className="fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <em>{value}</em>
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

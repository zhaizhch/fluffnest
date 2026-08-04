import { useEffect, useRef, useState } from "react";

export type QuickAction = "joke" | "news" | "weather" | "fortune" | "chat";

export type QuickRemindKind = "water" | "stretch" | "meeting";

type Props = {
  open: boolean;
  busy: boolean;
  petName: string;
  onClose: () => void;
  onAction: (action: Exclude<QuickAction, "chat">) => void;
  onChat: (text: string) => Promise<void> | void;
  onRemind: (args: {
    kind: QuickRemindKind;
    title?: string;
    atLocal?: string;
    intervalMinutes?: number;
  }) => Promise<void> | void;
};

const ACTIONS: {
  id: Exclude<QuickAction, "chat">;
  label: string;
  hint: string;
}[] = [
  { id: "fortune", label: "今日运势", hint: "宜忌 · 穿搭 · 详解" },
  { id: "joke", label: "讲个笑话", hint: "冷笑话来一句" },
  { id: "news", label: "科技娱乐", hint: "大模型查实时资讯再吐槽" },
  { id: "weather", label: "查查天气", hint: "气温风速紫外线+防护叮嘱" },
];

function defaultMeetingLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function QuickMenu({
  open,
  busy,
  petName,
  onClose,
  onAction,
  onChat,
  onRemind,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [view, setView] = useState<"main" | "remind">("main");
  const [meetingTitle, setMeetingTitle] = useState("会议");
  const [meetingAt, setMeetingAt] = useState(defaultMeetingLocal);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setSending(false);
      setView("main");
      setMeetingTitle("会议");
      setMeetingAt(defaultMeetingLocal());
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.blur(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const locked = busy || sending;

  const submitChat = async () => {
    const text = draft.trim();
    if (!text || locked) return;
    setSending(true);
    try {
      await onChat(text);
      setDraft("");
    } finally {
      setSending(false);
    }
  };

  const runRemind = async (
    kind: QuickRemindKind,
    extra?: { title?: string; atLocal?: string; intervalMinutes?: number },
  ) => {
    if (locked) return;
    setSending(true);
    try {
      await onRemind({ kind, ...extra });
      if (kind === "meeting") setView("main");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`quick-menu${view === "remind" ? " remind-view" : ""}`}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <header className="quick-menu-head">
        <span>{view === "remind" ? "设个提醒" : `和 ${petName}`}</span>
        <button
          type="button"
          className="quick-menu-close"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {view === "main" ? (
        <>
          <div className="quick-menu-actions">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="quick-menu-item"
                disabled={locked}
                onClick={() => onAction(a.id)}
              >
                <strong>{a.label}</strong>
                <small>{a.hint}</small>
              </button>
            ))}
            <button
              type="button"
              className="quick-menu-item"
              disabled={locked}
              onClick={() => setView("remind")}
            >
              <strong>设提醒</strong>
              <small>喝水 · 久坐 · 会议</small>
            </button>
          </div>

          <div className="quick-menu-chat">
            <input
              ref={inputRef}
              value={draft}
              disabled={locked}
              placeholder={`跟 ${petName} 说…也可说「提醒我喝水」`}
              maxLength={120}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitChat();
                }
                if (e.key === "Escape") onClose();
              }}
            />
            <button
              type="button"
              className="quick-menu-send"
              disabled={locked || !draft.trim()}
              onClick={() => void submitChat()}
            >
              {sending ? "…" : "发送"}
            </button>
          </div>
        </>
      ) : (
        <div className="quick-remind">
          <div className="quick-remind-row">
            <button
              type="button"
              className="quick-chip"
              disabled={locked}
              onClick={() => void runRemind("water", { intervalMinutes: 60 })}
            >
              喝水
              <small>每 60 分</small>
            </button>
            <button
              type="button"
              className="quick-chip"
              disabled={locked}
              onClick={() => void runRemind("stretch", { intervalMinutes: 45 })}
            >
              久坐
              <small>每 45 分</small>
            </button>
          </div>

          <div className="quick-meeting">
            <label>
              <span>会议</span>
              <input
                value={meetingTitle}
                disabled={locked}
                maxLength={24}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="标题"
              />
            </label>
            <label>
              <span>时间</span>
              <input
                type="datetime-local"
                value={meetingAt}
                disabled={locked}
                onChange={(e) => setMeetingAt(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="quick-menu-send block"
              disabled={locked || !meetingAt}
              onClick={() =>
                void runRemind("meeting", {
                  title: meetingTitle.trim() || "会议",
                  atLocal: meetingAt,
                })
              }
            >
              添加会议提醒
            </button>
          </div>

          <button
            type="button"
            className="quick-back"
            disabled={locked}
            onClick={() => setView("main")}
          >
            返回
          </button>
        </div>
      )}
    </div>
  );
}

package agent

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// HostSnapshot is desktop AppState slice passed from Rust each turn.
type HostSnapshot struct {
	Reminders       []HostReminder `json:"reminders"`
	Schedules       []HostSchedule `json:"schedules"`
	OwnerReady      bool           `json:"ownerReady"`
	ReminderSummary string         `json:"reminderSummary"`
}

type HostReminder struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	Title           string `json:"title"`
	Enabled         bool   `json:"enabled"`
	IntervalMinutes *int   `json:"intervalMinutes,omitempty"`
	At              string `json:"at,omitempty"`
}

type HostSchedule struct {
	ID         string         `json:"id"`
	Title      string         `json:"title"`
	Kind       string         `json:"kind"`
	Channel    string         `json:"channel"`
	Enabled    bool           `json:"enabled"`
	Hour       int            `json:"hour"`
	Minute     int            `json:"minute"`
	DaysOfWeek []int          `json:"daysOfWeek,omitempty"`
	Params     map[string]any `json:"params,omitempty"`
}

// HostAction is applied by the Tauri host after the agent turn.
type HostAction struct {
	Op   string         `json:"op"`
	Args map[string]any `json:"args"`
}

// HostBridge collects deferred desktop mutations for one agent turn.
type HostBridge struct {
	mu       sync.Mutex
	Snapshot HostSnapshot
	Actions  []HostAction
}

func (h *HostBridge) Add(op string, args map[string]any) {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if args == nil {
		args = map[string]any{}
	}
	h.Actions = append(h.Actions, HostAction{Op: op, Args: args})
}

func (h *HostBridge) SnapshotText() string {
	if h == nil {
		return "（无桌面主机状态）"
	}
	var b strings.Builder
	b.WriteString("提醒：")
	if h.Snapshot.ReminderSummary != "" {
		b.WriteString(h.Snapshot.ReminderSummary)
	} else {
		b.WriteString("无")
	}
	b.WriteString("\n定时任务：")
	if len(h.Snapshot.Schedules) == 0 {
		b.WriteString("无")
	} else {
		for i, s := range h.Snapshot.Schedules {
			if i > 0 {
				b.WriteString("；")
			}
			on := "关"
			if s.Enabled {
				on = "开"
			}
			fmt.Fprintf(&b, "%s[%s] %02d:%02d→%s(%s)", s.Title, on, s.Hour, s.Minute, s.Channel, s.Kind)
		}
	}
	if h.Snapshot.OwnerReady {
		b.WriteString("\n微信主动推送：已绑定会话")
	} else {
		b.WriteString("\n微信主动推送：尚未绑定（主人需先给 ClawBot 发过消息）")
	}
	return b.String()
}

func (h *HostBridge) ListRemindersJSON() string {
	if h == nil {
		return "[]"
	}
	raw, _ := json.Marshal(h.Snapshot.Reminders)
	return string(raw)
}

func (h *HostBridge) ListSchedulesJSON() string {
	if h == nil {
		return "[]"
	}
	raw, _ := json.Marshal(h.Snapshot.Schedules)
	return string(raw)
}

func (h *HostBridge) ActionsCopy() []HostAction {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]HostAction, len(h.Actions))
	copy(out, h.Actions)
	return out
}

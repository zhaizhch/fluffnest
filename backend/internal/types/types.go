package types

// PetInstance mirrors Rust state.PetInstance (camelCase JSON).
type PetInstance struct {
	ID           string `json:"id"`
	SpeciesID    string `json:"speciesId"`
	Name         string `json:"name"`
	Mood         int    `json:"mood"`
	Energy       int    `json:"energy"`
	Bond         int    `json:"bond"`
	Personality  string `json:"personality"`
	IsActive     bool   `json:"isActive"`
	Unlocked     bool   `json:"unlocked"`
	LastInteract string `json:"lastInteractAt"`
}

// LlmSettings mirrors Rust LLM config needed for outbound calls.
type LlmSettings struct {
	Enabled  bool   `json:"enabled"`
	APIBase  string `json:"apiBase"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	City     string `json:"weatherCity"`
}

// ChatMessage is a single chat turn.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	At      string `json:"at,omitempty"`
}

type BubbleRequest struct {
	LLM    LlmSettings `json:"llm"`
	Pet    PetInstance `json:"pet"`
	Kind   string      `json:"kind"`
	Action string      `json:"action"`
	Extra  *string     `json:"extra,omitempty"`
}

type ChatRequest struct {
	LLM     LlmSettings  `json:"llm"`
	Pet     PetInstance  `json:"pet"`
	History []ChatMessage `json:"history"`
	Message string       `json:"message"`
}

type FortuneRequest struct {
	LLM       LlmSettings `json:"llm"`
	Pet       PetInstance `json:"pet"`
	DateLabel string      `json:"dateLabel"`
	Weekday   string      `json:"weekday"`
	City      string      `json:"city"`
	Weather   *string     `json:"weather,omitempty"`
}

type CareVoiceRequest struct {
	LLM   LlmSettings `json:"llm"`
	Pet   PetInstance `json:"pet"`
	Kind  string      `json:"kind"`
	Count int         `json:"count"`
	Avoid []string    `json:"avoid"`
}

type WeatherRequest struct {
	City string `json:"city"`
}

type TextResponse struct {
	Text string `json:"text"`
}

type LinesResponse struct {
	Lines []string `json:"lines"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

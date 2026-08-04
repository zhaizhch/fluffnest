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

// WeatherRequest is a raw weather summary lookup.
type WeatherRequest struct {
	City string `json:"city"`
}

// WeatherBubbleRequest fetches weather then asks the model for a pet-style tip.
type WeatherBubbleRequest struct {
	LLM  LlmSettings `json:"llm"`
	Pet  PetInstance `json:"pet"`
	City string      `json:"city,omitempty"`
}

// NewsRequest asks the sidecar to fetch realtime news via LLM tools and roast one item.
type NewsRequest struct {
	LLM LlmSettings `json:"llm"`
	Pet PetInstance `json:"pet"`
}

type TextResponse struct {
	Text string `json:"text"`
}

// WeatherBubbleResponse includes numeric summary for the UI card + pet tip.
type WeatherBubbleResponse struct {
	Text    string `json:"text"`
	Summary string `json:"summary"`
}

// NewsBubbleResponse includes headline list for the UI card + pet roast.
type NewsBubbleResponse struct {
	Text    string `json:"text"`
	Summary string `json:"summary"`
}

type LinesResponse struct {
	Lines []string `json:"lines"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

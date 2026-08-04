package server

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/cache"
	"github.com/fluffnest/deskpet/backend/internal/geo"
	"github.com/fluffnest/deskpet/backend/internal/llm"
	"github.com/fluffnest/deskpet/backend/internal/news"
	"github.com/fluffnest/deskpet/backend/internal/types"
	"github.com/fluffnest/deskpet/backend/internal/weather"
)

type Server struct {
	llm     *llm.Client
	weather *weather.Service
	news    *news.Service
	geo     *geo.Service
	mux     *http.ServeMux
}

func New() *Server {
	c := cache.New()
	ai := llm.NewClient()
	s := &Server{
		llm:     ai,
		weather: weather.New(ai.HTTP(), c),
		news:    news.New(ai.HTTP(), c),
		geo:     geo.New(ai.HTTP(), c),
		mux:     http.NewServeMux(),
	}
	s.routes()
	// Warm geo + default-city weather so first click is cache-hit fast.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		_ = s.geo.Resolve(ctx, "北京")
		_, _ = s.weather.Fetch(ctx, "北京")
	}()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("POST /v1/bubble", s.handleBubble)
	s.mux.HandleFunc("POST /v1/chat", s.handleChat)
	s.mux.HandleFunc("POST /v1/fortune", s.handleFortune)
	s.mux.HandleFunc("POST /v1/care-voice", s.handleCareVoice)
	s.mux.HandleFunc("POST /v1/weather", s.handleWeather)
	s.mux.HandleFunc("POST /v1/weather-bubble", s.handleWeatherBubble)
	s.mux.HandleFunc("POST /v1/weather-tip", s.handleWeatherTip)
	s.mux.HandleFunc("POST /v1/news", s.handleNews)
	s.mux.HandleFunc("POST /v1/news-tip", s.handleNewsTip)
}

func (s *Server) Serve(ln net.Listener) error {
	srv := &http.Server{
		Handler:           s.mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Printf("fluffnest-ai listening on %s", ln.Addr().String())
	return srv.Serve(ln)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "fluffnest-ai"})
}

func (s *Server) handleBubble(w http.ResponseWriter, r *http.Request) {
	var req types.BubbleRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	text, err := s.llm.GenerateBubble(r.Context(), req.LLM, req.Pet, req.Kind, req.Action, req.Extra)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.TextResponse{Text: text})
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	var req types.ChatRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	text, err := s.llm.GenerateChat(r.Context(), req.LLM, req.Pet, req.History, req.Message)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.TextResponse{Text: text})
}

func (s *Server) handleFortune(w http.ResponseWriter, r *http.Request) {
	var req types.FortuneRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	text, err := s.llm.GenerateFortune(r.Context(), req.LLM, req.Pet, req.DateLabel, req.Weekday, req.City, req.Weather)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.TextResponse{Text: text})
}

func (s *Server) handleCareVoice(w http.ResponseWriter, r *http.Request) {
	var req types.CareVoiceRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	lines, err := s.llm.GenerateCareVoice(r.Context(), req.LLM, req.Pet, req.Kind, req.Count, req.Avoid)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.LinesResponse{Lines: lines})
}

func (s *Server) handleWeather(w http.ResponseWriter, r *http.Request) {
	var req types.WeatherRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	text, err := s.weather.Summary(r.Context(), req.City)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.TextResponse{Text: text})
}

func (s *Server) handleWeatherBubble(w http.ResponseWriter, r *http.Request) {
	var req types.WeatherBubbleRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	city := req.City
	if city == "" {
		city = req.LLM.City
	}
	snap, err := s.weather.Fetch(r.Context(), city)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	summary := snap.CardText()
	// Instant tip — no LLM wait (keeps UX under ~1s when weather is cached/fast).
	tip := s.llm.GenerateWeatherBubbleFast(r.Context(), req.Pet, snap)
	writeJSON(w, http.StatusOK, types.WeatherBubbleResponse{Text: tip, Summary: summary})
}

func (s *Server) handleWeatherTip(w http.ResponseWriter, r *http.Request) {
	var req types.WeatherBubbleRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	city := req.City
	if city == "" {
		city = req.LLM.City
	}
	snap, err := s.weather.Fetch(r.Context(), city)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	tip, err := s.llm.RefineWeatherTip(r.Context(), req.LLM, req.Pet, snap.PromptText())
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.TextResponse{Text: tip})
}

func (s *Server) handleNews(w http.ResponseWriter, r *http.Request) {
	var req types.NewsRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	loc := s.geo.Resolve(r.Context(), req.LLM.City)
	res, err := s.llm.GenerateNewsBubbleFast(r.Context(), req.Pet, s.news, loc)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.NewsBubbleResponse{Text: res.Tip, Summary: res.Summary})
}

func (s *Server) handleNewsTip(w http.ResponseWriter, r *http.Request) {
	var req types.NewsRequest
	if err := decode(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	loc := s.geo.Resolve(r.Context(), req.LLM.City)
	items, err := s.news.FetchHeadlines(r.Context(), "both", 4, false, loc)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	summary := "📍 " + loc.Label() + "\n" + news.FormatHeadlines(items)
	tip, err := s.llm.RefineNewsTip(r.Context(), req.LLM, req.Pet, summary)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, types.TextResponse{Text: tip})
}

func decode(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, types.ErrorResponse{Error: msg})
}

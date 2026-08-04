package llm

import (
	"context"
	"fmt"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/geo"
	"github.com/fluffnest/deskpet/backend/internal/news"
	"github.com/fluffnest/deskpet/backend/internal/types"
	"github.com/fluffnest/deskpet/backend/internal/weather"
)

// NewsResult is pet roast + headline list for the UI card.
type NewsResult struct {
	Tip     string
	Summary string
}

// GenerateNewsBubbleFast fetches headlines and returns an instant personality tip (no LLM wait).
func (c *Client) GenerateNewsBubbleFast(ctx context.Context, pet types.PetInstance, newsSvc *news.Service, loc geo.Location) (NewsResult, error) {
	var zero NewsResult
	if newsSvc == nil {
		return zero, fmt.Errorf("新闻插件未就绪")
	}
	ctx, cancel := context.WithTimeout(ctx, 900*time.Millisecond)
	defer cancel()

	items, err := newsSvc.FetchHeadlines(ctx, "both", 4, false, loc)
	if err != nil {
		return zero, err
	}
	summary := fmt.Sprintf("📍 %s\n%s", loc.Label(), news.FormatHeadlines(items))
	return NewsResult{
		Tip:     QuickNewsTip(pet.Personality, items),
		Summary: summary,
	}, nil
}

// RefineNewsTip optionally polishes the tip with LLM (background use).
func (c *Client) RefineNewsTip(ctx context.Context, llm types.LlmSettings, pet types.PetInstance, summary string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	return c.GenerateBubble(ctx, llm, pet, "news", "科技娱乐", &summary)
}

// GenerateWeatherBubbleFast builds an instant tip from a weather snapshot (no LLM wait).
func (c *Client) GenerateWeatherBubbleFast(_ context.Context, pet types.PetInstance, snap weather.Snapshot) string {
	return QuickWeatherTip(pet.Personality, snap)
}

// RefineWeatherTip optionally polishes the tip with LLM (background use).
func (c *Client) RefineWeatherTip(ctx context.Context, llm types.LlmSettings, pet types.PetInstance, prompt string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	return c.GenerateBubble(ctx, llm, pet, "weather", "天气", &prompt)
}

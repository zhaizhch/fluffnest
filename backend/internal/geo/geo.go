package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/cache"
)

// Location is a resolved user place for weather/news personalization.
type Location struct {
	City        string  `json:"city"`
	Region      string  `json:"region,omitempty"`
	Country     string  `json:"country,omitempty"`
	CountryCode string  `json:"countryCode,omitempty"`
	Latitude    float64 `json:"latitude,omitempty"`
	Longitude   float64 `json:"longitude,omitempty"`
	Source      string  `json:"source"` // ip | settings | default
}

func (l Location) Label() string {
	parts := make([]string, 0, 3)
	if l.City != "" {
		parts = append(parts, l.City)
	}
	if l.Region != "" && l.Region != l.City {
		parts = append(parts, l.Region)
	}
	if l.Country != "" && l.Country != l.City && l.Country != l.Region {
		parts = append(parts, l.Country)
	}
	if len(parts) == 0 {
		return "未知"
	}
	return strings.Join(parts, " · ")
}

type Service struct {
	http  *http.Client
	cache *cache.TTL
}

func New(httpClient *http.Client, c *cache.TTL) *Service {
	return &Service{http: httpClient, cache: c}
}

// Resolve prefers cached IP, else settings city immediately (never blocks on IP).
// IP lookup is warmed in the background for the next call.
func (s *Service) Resolve(ctx context.Context, settingsCity string) Location {
	if v, ok := s.cache.Get("geo:ip"); ok {
		var loc Location
		if json.Unmarshal([]byte(v), &loc) == nil && loc.City != "" {
			return loc
		}
	}
	// Non-blocking warm-up.
	go func() {
		bg, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, _ = s.locateByIP(bg)
	}()

	city := strings.TrimSpace(settingsCity)
	if city != "" {
		return Location{City: city, CountryCode: guessCNCode(city), Source: "settings"}
	}
	return Location{City: "北京", Country: "中国", CountryCode: "CN", Source: "default"}
}

func guessCNCode(city string) string {
	for _, r := range city {
		if r >= 0x4e00 && r <= 0x9fff {
			return "CN"
		}
	}
	return ""
}

type ipAPIResp struct {
	Status      string  `json:"status"`
	Message     string  `json:"message"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	Query       string  `json:"query"`
}

func (s *Service) locateByIP(ctx context.Context) (Location, error) {
	if v, ok := s.cache.Get("geo:ip"); ok {
		var loc Location
		if json.Unmarshal([]byte(v), &loc) == nil && loc.City != "" {
			return loc, nil
		}
	}

	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	// Free non-commercial IP geolocation (Chinese labels).
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://ip-api.com/json/?lang=zh-CN&fields=status,message,country,countryCode,regionName,city,lat,lon,query", nil)
	if err != nil {
		return Location{}, err
	}
	req.Header.Set("User-Agent", "FluffNest/0.2 (deskpet; +https://github.com/fluffnest)")
	resp, err := s.http.Do(req)
	if err != nil {
		return Location{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return Location{}, fmt.Errorf("ip geo http %d", resp.StatusCode)
	}
	var raw ipAPIResp
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return Location{}, err
	}
	if raw.Status != "success" || strings.TrimSpace(raw.City) == "" {
		msg := raw.Message
		if msg == "" {
			msg = "empty city"
		}
		return Location{}, fmt.Errorf("ip geo: %s", msg)
	}

	loc := Location{
		City:        strings.TrimSpace(raw.City),
		Region:      strings.TrimSpace(raw.RegionName),
		Country:     strings.TrimSpace(raw.Country),
		CountryCode: strings.ToUpper(strings.TrimSpace(raw.CountryCode)),
		Latitude:    raw.Lat,
		Longitude:   raw.Lon,
		Source:      "ip",
	}
	if b, err := json.Marshal(loc); err == nil {
		s.cache.Set("geo:ip", string(b), 6*time.Hour)
	}
	return loc, nil
}

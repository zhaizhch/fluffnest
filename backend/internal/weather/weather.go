package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/fluffnest/deskpet/backend/internal/cache"
)

type Service struct {
	http  *http.Client
	cache *cache.TTL
}

func New(httpClient *http.Client, c *cache.TTL) *Service {
	return &Service{http: httpClient, cache: c}
}

type geoResult struct {
	Results []geoHit `json:"results"`
}

type geoHit struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name"`
	Country   string  `json:"country"`
}

type forecast struct {
	Current *struct {
		Temperature2m float64 `json:"temperature_2m"`
		WeatherCode   int     `json:"weather_code"`
		WindSpeed10m  float64 `json:"wind_speed_10m"`
	} `json:"current"`
	Daily *struct {
		Temperature2mMax []float64 `json:"temperature_2m_max"`
		Temperature2mMin []float64 `json:"temperature_2m_min"`
	} `json:"daily"`
}

func weatherCodeZH(code int) string {
	switch code {
	case 0:
		return "晴朗"
	case 1, 2:
		return "多云"
	case 3:
		return "阴天"
	case 45, 48:
		return "有雾"
	case 51, 53, 55:
		return "毛毛雨"
	case 61, 63, 65:
		return "下雨"
	case 71, 73, 75:
		return "下雪"
	case 80, 81, 82:
		return "阵雨"
	case 95, 96, 99:
		return "雷阵雨"
	default:
		return "天气一般"
	}
}

func (s *Service) Summary(ctx context.Context, city string) (string, error) {
	city = strings.TrimSpace(city)
	if city == "" {
		city = "北京"
	}
	cacheKey := "weather:" + city
	if v, ok := s.cache.Get(cacheKey); ok {
		return v, nil
	}

	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	geoURL := "https://geocoding-api.open-meteo.com/v1/search?name=" + url.QueryEscape(city) + "&count=1&language=zh&format=json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geoURL, nil)
	if err != nil {
		return "", err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("地理编码失败: %w", err)
	}
	defer resp.Body.Close()
	var geo geoResult
	if err := json.NewDecoder(resp.Body).Decode(&geo); err != nil {
		return "", fmt.Errorf("地理编码解析失败: %w", err)
	}
	if len(geo.Results) == 0 {
		return "", fmt.Errorf("找不到城市「%s」", city)
	}
	hit := geo.Results[0]

	forecastURL := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1",
		hit.Latitude, hit.Longitude,
	)
	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, forecastURL, nil)
	if err != nil {
		return "", err
	}
	resp2, err := s.http.Do(req2)
	if err != nil {
		return "", fmt.Errorf("天气请求失败: %w", err)
	}
	defer resp2.Body.Close()
	var fc forecast
	if err := json.NewDecoder(resp2.Body).Decode(&fc); err != nil {
		return "", fmt.Errorf("天气解析失败: %w", err)
	}
	if fc.Current == nil {
		return "", fmt.Errorf("无当前天气")
	}

	label := hit.Name
	if label == "" {
		label = city
	}
	countryBit := ""
	if hit.Country != "" {
		countryBit = "（" + hit.Country + "）"
	}
	rangeBit := ""
	if fc.Daily != nil && len(fc.Daily.Temperature2mMin) > 0 && len(fc.Daily.Temperature2mMax) > 0 {
		rangeBit = fmt.Sprintf("，今日 %.0f~%.0f℃", fc.Daily.Temperature2mMin[0], fc.Daily.Temperature2mMax[0])
	}
	summary := fmt.Sprintf("%s%s：%s，当前 %.0f℃%s，风速 %.0f km/h",
		label, countryBit, weatherCodeZH(fc.Current.WeatherCode),
		fc.Current.Temperature2m, rangeBit, fc.Current.WindSpeed10m,
	)
	s.cache.Set(cacheKey, summary, 15*time.Minute)
	return summary, nil
}

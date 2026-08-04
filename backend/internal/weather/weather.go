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

// Snapshot is structured weather for UI cards + LLM prompts.
type Snapshot struct {
	Label       string  `json:"label"`
	Condition   string  `json:"condition"`
	TempC       float64 `json:"tempC"`
	FeelsC      float64 `json:"feelsC"`
	TempMin     float64 `json:"tempMin"`
	TempMax     float64 `json:"tempMax"`
	Humidity    float64 `json:"humidity"`
	Cloud       float64 `json:"cloud"`
	WindKmh     float64 `json:"windKmh"`
	WindGust    float64 `json:"windGust"`
	WindDir     string  `json:"windDir"`
	PrecipNow   float64 `json:"precipNow"`
	PrecipDay   float64 `json:"precipDay"`
	UV          float64 `json:"uv"`
	UVLevel     string  `json:"uvLevel"`
	Hints       string  `json:"hints"`
	HasDaily    bool    `json:"-"`
	HasUV       bool    `json:"-"`
	HasPrecipDay bool   `json:"-"`
}

// CardText is human-readable numbers for the pet weather panel.
func (s Snapshot) CardText() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n", s.Label)
	fmt.Fprintf(&b, "天气：%s\n", s.Condition)
	fmt.Fprintf(&b, "气温：%.0f℃（体感 %.0f℃）", s.TempC, s.FeelsC)
	if s.HasDaily {
		fmt.Fprintf(&b, "，今日 %.0f~%.0f℃", s.TempMin, s.TempMax)
	}
	b.WriteByte('\n')
	fmt.Fprintf(&b, "湿度：%.0f%%　云量：%.0f%%\n", s.Humidity, s.Cloud)
	fmt.Fprintf(&b, "风速：%.0f km/h（%s）", s.WindKmh, s.WindDir)
	if s.WindGust > 0 {
		fmt.Fprintf(&b, "，阵风 %.0f km/h", s.WindGust)
	}
	b.WriteByte('\n')
	if s.PrecipNow > 0 {
		fmt.Fprintf(&b, "当前降水：%.1f mm\n", s.PrecipNow)
	}
	if s.HasPrecipDay {
		fmt.Fprintf(&b, "今日降水：%.1f mm\n", s.PrecipDay)
	}
	if s.HasUV {
		fmt.Fprintf(&b, "紫外线：UV %.1f（%s）\n", s.UV, s.UVLevel)
	}
	return strings.TrimSpace(b.String())
}

// PromptText feeds the model (includes protection hints).
func (s Snapshot) PromptText() string {
	return s.CardText() + "\n防护提示素材：" + s.Hints
}

type geoResult struct {
	Results []geoHit `json:"results"`
}

type geoHit struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name"`
	Country   string  `json:"country"`
	Admin1    string  `json:"admin1"`
}

type forecast struct {
	Current *struct {
		Temperature2m      float64 `json:"temperature_2m"`
		ApparentTemp       float64 `json:"apparent_temperature"`
		RelativeHumidity2m float64 `json:"relative_humidity_2m"`
		WeatherCode        int     `json:"weather_code"`
		CloudCover         float64 `json:"cloud_cover"`
		Precipitation      float64 `json:"precipitation"`
		WindSpeed10m       float64 `json:"wind_speed_10m"`
		WindGusts10m       float64 `json:"wind_gusts_10m"`
		WindDirection10m   float64 `json:"wind_direction_10m"`
	} `json:"current"`
	Daily *struct {
		Temperature2mMax []float64 `json:"temperature_2m_max"`
		Temperature2mMin []float64 `json:"temperature_2m_min"`
		UvIndexMax       []float64 `json:"uv_index_max"`
		PrecipitationSum []float64 `json:"precipitation_sum"`
		WeatherCode      []int     `json:"weather_code"`
	} `json:"daily"`
}

func weatherCodeZH(code int) string {
	switch code {
	case 0:
		return "晴天"
	case 1:
		return "大部晴朗"
	case 2:
		return "多云"
	case 3:
		return "阴天"
	case 45, 48:
		return "有雾"
	case 51, 53, 55:
		return "毛毛雨"
	case 56, 57:
		return "冻毛毛雨"
	case 61:
		return "小雨"
	case 63:
		return "中雨"
	case 65:
		return "大雨"
	case 66, 67:
		return "冻雨"
	case 71:
		return "小雪"
	case 73:
		return "中雪"
	case 75, 77:
		return "大雪"
	case 80:
		return "小阵雨"
	case 81:
		return "中阵雨"
	case 82:
		return "强阵雨"
	case 85, 86:
		return "阵雪"
	case 95:
		return "雷阵雨"
	case 96, 99:
		return "雷暴伴冰雹"
	default:
		return "天气一般"
	}
}

func windDirZH(deg float64) string {
	dirs := []string{"北", "东北", "东", "东南", "南", "西南", "西", "西北"}
	i := int((deg + 22.5) / 45.0) % 8
	if i < 0 {
		i = 0
	}
	return dirs[i] + "风"
}

func uvLevelZH(uv float64) string {
	switch {
	case uv < 3:
		return "低"
	case uv < 6:
		return "中等"
	case uv < 8:
		return "高"
	case uv < 11:
		return "很高"
	default:
		return "极高"
	}
}

func (s *Service) Summary(ctx context.Context, city string) (string, error) {
	snap, err := s.Fetch(ctx, city)
	if err != nil {
		return "", err
	}
	return snap.PromptText(), nil
}

// Fetch returns a structured weather snapshot (cached ~15 min).
func (s *Service) Fetch(ctx context.Context, city string) (Snapshot, error) {
	city = strings.TrimSpace(city)
	if city == "" {
		city = "北京"
	}
	cacheKey := "weather:snap:v1:" + city
	if v, ok := s.cache.Get(cacheKey); ok {
		var snap Snapshot
		if json.Unmarshal([]byte(v), &snap) == nil && snap.Label != "" {
			return snap, nil
		}
	}

	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	geoURL := "https://geocoding-api.open-meteo.com/v1/search?name=" + url.QueryEscape(city) + "&count=1&language=zh&format=json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geoURL, nil)
	if err != nil {
		return Snapshot{}, err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return Snapshot{}, fmt.Errorf("地理编码失败: %w", err)
	}
	defer resp.Body.Close()
	var geo geoResult
	if err := json.NewDecoder(resp.Body).Decode(&geo); err != nil {
		return Snapshot{}, fmt.Errorf("地理编码解析失败: %w", err)
	}
	if len(geo.Results) == 0 {
		return Snapshot{}, fmt.Errorf("找不到城市「%s」", city)
	}
	hit := geo.Results[0]

	forecastURL := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f"+
			"&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m"+
			"&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum"+
			"&timezone=auto&forecast_days=1",
		hit.Latitude, hit.Longitude,
	)
	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, forecastURL, nil)
	if err != nil {
		return Snapshot{}, err
	}
	resp2, err := s.http.Do(req2)
	if err != nil {
		return Snapshot{}, fmt.Errorf("天气请求失败: %w", err)
	}
	defer resp2.Body.Close()
	var fc forecast
	if err := json.NewDecoder(resp2.Body).Decode(&fc); err != nil {
		return Snapshot{}, fmt.Errorf("天气解析失败: %w", err)
	}
	if fc.Current == nil {
		return Snapshot{}, fmt.Errorf("无当前天气")
	}
	cur := fc.Current

	label := hit.Name
	if label == "" {
		label = city
	}
	if hit.Admin1 != "" && hit.Admin1 != label {
		label = label + "·" + hit.Admin1
	}
	if hit.Country != "" {
		label = label + "（" + hit.Country + "）"
	}

	cond := weatherCodeZH(cur.WeatherCode)
	if fc.Daily != nil && len(fc.Daily.WeatherCode) > 0 {
		dayCond := weatherCodeZH(fc.Daily.WeatherCode[0])
		if dayCond != cond {
			cond = cond + "（今日整体偏" + dayCond + "）"
		}
	}

	snap := Snapshot{
		Label:     label,
		Condition: cond,
		TempC:     cur.Temperature2m,
		FeelsC:    cur.ApparentTemp,
		Humidity:  cur.RelativeHumidity2m,
		Cloud:     cur.CloudCover,
		WindKmh:   cur.WindSpeed10m,
		WindGust:  cur.WindGusts10m,
		WindDir:   windDirZH(cur.WindDirection10m),
		PrecipNow: cur.Precipitation,
	}
	if fc.Daily != nil && len(fc.Daily.Temperature2mMin) > 0 && len(fc.Daily.Temperature2mMax) > 0 {
		snap.HasDaily = true
		snap.TempMin = fc.Daily.Temperature2mMin[0]
		snap.TempMax = fc.Daily.Temperature2mMax[0]
	}
	if fc.Daily != nil && len(fc.Daily.PrecipitationSum) > 0 {
		snap.HasPrecipDay = true
		snap.PrecipDay = fc.Daily.PrecipitationSum[0]
	}
	if fc.Daily != nil && len(fc.Daily.UvIndexMax) > 0 {
		snap.HasUV = true
		snap.UV = fc.Daily.UvIndexMax[0]
		snap.UVLevel = uvLevelZH(snap.UV)
	}
	snap.Hints = protectionHints(cur.WeatherCode, snap.TempC, snap.FeelsC, snap.WindKmh, snap.UV, snap.PrecipNow, snap.PrecipDay)

	if b, err := json.Marshal(snap); err == nil {
		s.cache.Set(cacheKey, string(b), 15*time.Minute)
	}
	return snap, nil
}

func protectionHints(code int, temp, feels, wind, uv, precipNow, precipDay float64) string {
	var tips []string
	switch {
	case code >= 95:
		tips = append(tips, "有雷暴风险，尽量少出门、远离空旷处")
	case code >= 80 || code == 61 || code == 63 || code == 65 || precipNow > 0 || precipDay >= 2:
		tips = append(tips, "记得带伞/穿防水外套")
	case code >= 71:
		tips = append(tips, "路滑注意防滑保暖")
	case code == 45 || code == 48:
		tips = append(tips, "有雾能见度低，出行减速小心")
	}
	switch {
	case feels <= 0 || temp <= 0:
		tips = append(tips, "严寒，戴帽手套、多层保暖")
	case feels <= 10 || temp <= 8:
		tips = append(tips, "偏冷，加外套围巾")
	case feels >= 35 || temp >= 33:
		tips = append(tips, "高温，补水防晒、减少暴晒")
	case feels >= 30 || temp >= 28:
		tips = append(tips, "较热，透气衣物并及时补水")
	}
	switch {
	case uv >= 8:
		tips = append(tips, "紫外线很强，防晒霜+帽子/墨镜")
	case uv >= 6:
		tips = append(tips, "紫外线偏高，外出涂防晒")
	case uv >= 3 && (code == 0 || code == 1):
		tips = append(tips, "晴天紫外线不低，可轻防晒")
	}
	if wind >= 40 {
		tips = append(tips, "大风，注意固定物品、骑行小心")
	} else if wind >= 25 {
		tips = append(tips, "风不小，薄外套防风更舒适")
	}
	if len(tips) == 0 {
		tips = append(tips, "天气较温和，按体感增减衣即可")
	}
	return strings.Join(tips, "；")
}

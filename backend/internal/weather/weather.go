package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	Label        string  `json:"label"`
	Condition    string  `json:"condition"`
	TempC        float64 `json:"tempC"`
	FeelsC       float64 `json:"feelsC"`
	TempMin      float64 `json:"tempMin"`
	TempMax      float64 `json:"tempMax"`
	Humidity     float64 `json:"humidity"`
	Cloud        float64 `json:"cloud"`
	WindKmh      float64 `json:"windKmh"`
	WindGust     float64 `json:"windGust"`
	WindDir      string  `json:"windDir"`
	PrecipNow    float64 `json:"precipNow"`
	PrecipDay    float64 `json:"precipDay"`
	UV           float64 `json:"uv"`
	UVLevel      string  `json:"uvLevel"`
	Hints        string  `json:"hints"`
	DayOffset    int     `json:"dayOffset"`
	HasDaily     bool    `json:"-"`
	HasUV        bool    `json:"-"`
	HasPrecipDay bool    `json:"-"`
	DailyOnly    bool    `json:"-"`
}

func dayWord(offset int) string {
	switch offset {
	case 0:
		return "今日"
	case 1:
		return "明日"
	default:
		return fmt.Sprintf("%d天后", offset)
	}
}

// CardText is human-readable numbers for the pet weather panel.
func (s Snapshot) CardText() string {
	var b strings.Builder
	dw := dayWord(s.DayOffset)
	fmt.Fprintf(&b, "%s\n", s.Label)
	fmt.Fprintf(&b, "天气：%s\n", s.Condition)
	if s.DailyOnly {
		if s.HasDaily {
			fmt.Fprintf(&b, "%s气温：%.0f~%.0f℃\n", dw, s.TempMin, s.TempMax)
		}
	} else {
		fmt.Fprintf(&b, "气温：%.0f℃（体感 %.0f℃）", s.TempC, s.FeelsC)
		if s.HasDaily {
			fmt.Fprintf(&b, "，%s %.0f~%.0f℃", dw, s.TempMin, s.TempMax)
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
	}
	if s.HasPrecipDay {
		fmt.Fprintf(&b, "%s降水：%.1f mm\n", dw, s.PrecipDay)
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
	return s.SummaryDay(ctx, city, 0)
}

func (s *Service) SummaryDay(ctx context.Context, city string, dayOffset int) (string, error) {
	snap, err := s.FetchDay(ctx, city, dayOffset)
	if err != nil {
		return "", err
	}
	return snap.PromptText(), nil
}

// DayOffset resolves forTomorrow / explicit dayOffset into 0=today, 1=tomorrow, …
func DayOffset(forTomorrow bool, dayOffset int) int {
	if dayOffset > 0 {
		return dayOffset
	}
	if forTomorrow {
		return 1
	}
	return 0
}

// Fetch returns a structured weather snapshot for today (cached ~15 min).
func (s *Service) Fetch(ctx context.Context, city string) (Snapshot, error) {
	return s.FetchDay(ctx, city, 0)
}

// FetchDay returns weather for today (offset 0) or a future daily forecast (offset ≥ 1).
// Primary source: sojson / weather.com.cn (reachable in CN). Open-Meteo is a short fallback.
func (s *Service) FetchDay(ctx context.Context, city string, dayOffset int) (Snapshot, error) {
	city = strings.TrimSpace(city)
	if city == "" {
		city = "北京"
	}
	if dayOffset < 0 {
		dayOffset = 0
	}
	if dayOffset > 7 {
		dayOffset = 7
	}
	cacheKey := fmt.Sprintf("weather:snap:v3:%s:d%d", city, dayOffset)
	if v, ok := s.cache.Get(cacheKey); ok {
		var snap Snapshot
		if json.Unmarshal([]byte(v), &snap) == nil && snap.Label != "" {
			return snap, nil
		}
	}

	var lastErr error
	if snap, err := s.fetchSojson(ctx, city, dayOffset); err == nil {
		if b, e := json.Marshal(snap); e == nil {
			s.cache.Set(cacheKey, string(b), 15*time.Minute)
		}
		return snap, nil
	} else {
		lastErr = err
	}

	// Open-Meteo often times out in CN; keep a short attempt for overseas networks.
	if snap, err := s.fetchOpenMeteo(ctx, city, dayOffset); err == nil {
		if b, e := json.Marshal(snap); e == nil {
			s.cache.Set(cacheKey, string(b), 15*time.Minute)
		}
		return snap, nil
	} else if lastErr == nil {
		lastErr = err
	} else {
		lastErr = fmt.Errorf("%v；备用源: %w", lastErr, err)
	}
	return Snapshot{}, lastErr
}

type sojsonResp struct {
	Status   int `json:"status"`
	CityInfo *struct {
		City     string `json:"city"`
		Parent   string `json:"parent"`
		CityKey  string `json:"citykey"`
		UpdateAt string `json:"updateTime"`
	} `json:"cityInfo"`
	Data *struct {
		Shidu    string  `json:"shidu"`
		Wendu    string  `json:"wendu"`
		Quality  string  `json:"quality"`
		Ganmao   string  `json:"ganmao"`
		Forecast []struct {
			High   string `json:"high"`
			Low    string `json:"low"`
			Ymd    string `json:"ymd"`
			Week   string `json:"week"`
			Fx     string `json:"fx"`
			Fl     string `json:"fl"`
			Type   string `json:"type"`
			Notice string `json:"notice"`
			Aqi    float64 `json:"aqi"`
		} `json:"forecast"`
	} `json:"data"`
}

func (s *Service) fetchSojson(ctx context.Context, city string, dayOffset int) (Snapshot, error) {
	code, label, ok := lookupCityCode(city)
	if !ok {
		return Snapshot{}, fmt.Errorf("暂不支持城市「%s」（可试北京/上海/天津等）", city)
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()

	urlStr := "http://t.weather.sojson.com/api/weather/city/" + code
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return Snapshot{}, err
	}
	req.Header.Set("User-Agent", "FluffNest/0.2 (deskpet)")
	resp, err := s.http.Do(req)
	if err != nil {
		return Snapshot{}, fmt.Errorf("国内天气源请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return Snapshot{}, fmt.Errorf("国内天气源 HTTP %d", resp.StatusCode)
	}
	var raw sojsonResp
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return Snapshot{}, fmt.Errorf("国内天气源解析失败: %w", err)
	}
	if raw.Status != 200 || raw.Data == nil || len(raw.Data.Forecast) == 0 {
		return Snapshot{}, fmt.Errorf("国内天气源无数据")
	}
	if dayOffset >= len(raw.Data.Forecast) {
		return Snapshot{}, fmt.Errorf("无%s预报", dayWord(dayOffset))
	}

	display := label
	if raw.CityInfo != nil && strings.TrimSpace(raw.CityInfo.City) != "" {
		display = strings.TrimSpace(raw.CityInfo.City)
	}

	day := raw.Data.Forecast[dayOffset]
	high := parseTempC(day.High)
	low := parseTempC(day.Low)
	cond := strings.TrimSpace(day.Type)
	if cond == "" {
		cond = "天气一般"
	}

	if dayOffset == 0 {
		temp := parseFloat(raw.Data.Wendu)
		if temp == 0 && high != 0 && low != 0 {
			temp = (high + low) / 2
		}
		// Prefer live SK when available (more precise now-temp / humidity / wind).
		if sk, err := s.fetchWeatherCNLive(ctx, code); err == nil {
			if sk.Temp != 0 {
				temp = sk.Temp
			}
			if sk.Condition != "" {
				cond = sk.Condition
			}
			snap := Snapshot{
				Label:     display,
				Condition: cond,
				TempC:     temp,
				FeelsC:    temp,
				Humidity:  sk.Humidity,
				WindKmh:   sk.WindKmh,
				WindDir:   firstNonEmpty(sk.WindDir, day.Fx),
				DayOffset: 0,
				HasDaily:  true,
				TempMin:   low,
				TempMax:   high,
			}
			if day.Notice != "" {
				snap.Hints = day.Notice
			} else {
				snap.Hints = protectionHints(conditionCodeApprox(cond), snap.TempC, snap.FeelsC, snap.WindKmh, 0, 0, 0)
			}
			if raw.Data.Ganmao != "" {
				if snap.Hints != "" {
					snap.Hints += "；"
				}
				snap.Hints += raw.Data.Ganmao
			}
			return snap, nil
		}
		hum := parsePercent(raw.Data.Shidu)
		snap := Snapshot{
			Label:     display,
			Condition: cond,
			TempC:     temp,
			FeelsC:    temp,
			Humidity:  hum,
			WindDir:   day.Fx,
			WindKmh:   windLevelToKmh(day.Fl),
			DayOffset: 0,
			HasDaily:  true,
			TempMin:   low,
			TempMax:   high,
		}
		if day.Notice != "" {
			snap.Hints = day.Notice
		} else {
			snap.Hints = protectionHints(conditionCodeApprox(cond), snap.TempC, snap.FeelsC, snap.WindKmh, 0, 0, 0)
		}
		if raw.Data.Ganmao != "" {
			if snap.Hints != "" {
				snap.Hints += "；"
			}
			snap.Hints += raw.Data.Ganmao
		}
		return snap, nil
	}

	mid := (high + low) / 2
	snap := Snapshot{
		Label:     display,
		Condition: cond,
		DayOffset: dayOffset,
		DailyOnly: true,
		HasDaily:  true,
		TempMin:   low,
		TempMax:   high,
		TempC:     mid,
		FeelsC:    mid,
		WindDir:   day.Fx,
		WindKmh:   windLevelToKmh(day.Fl),
	}
	if day.Notice != "" {
		snap.Hints = day.Notice
	} else {
		snap.Hints = protectionHints(conditionCodeApprox(cond), snap.TempC, snap.FeelsC, snap.WindKmh, 0, 0, 0)
	}
	return snap, nil
}

type liveSK struct {
	Temp      float64
	Humidity  float64
	WindKmh   float64
	WindDir   string
	Condition string
}

func (s *Service) fetchWeatherCNLive(ctx context.Context, code string) (liveSK, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	urlStr := "https://d1.weather.com.cn/sk_2d/" + code + ".html"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return liveSK{}, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 FluffNest/0.2")
	req.Header.Set("Referer", "https://www.weather.com.cn/")
	resp, err := s.http.Do(req)
	if err != nil {
		return liveSK{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return liveSK{}, fmt.Errorf("sk http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return liveSK{}, err
	}
	text := string(body)
	// var dataSK={...}
	i := strings.Index(text, "{")
	j := strings.LastIndex(text, "}")
	if i < 0 || j <= i {
		return liveSK{}, fmt.Errorf("sk payload")
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(text[i:j+1]), &raw); err != nil {
		return liveSK{}, err
	}
	out := liveSK{
		Temp:      parseFloat(fmt.Sprint(raw["temp"])),
		Humidity:  parsePercent(fmt.Sprint(raw["SD"])),
		WindDir:   strings.TrimSpace(fmt.Sprint(raw["WD"])),
		Condition: strings.TrimSpace(fmt.Sprint(raw["weather"])),
		WindKmh:   parseWindKmh(fmt.Sprint(raw["wse"]), fmt.Sprint(raw["WS"])),
	}
	return out, nil
}

func (s *Service) fetchOpenMeteo(ctx context.Context, city string, dayOffset int) (Snapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()

	geoURL := "https://geocoding-api.open-meteo.com/v1/search?name=" + url.QueryEscape(city) + "&count=1&language=zh&format=json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geoURL, nil)
	if err != nil {
		return Snapshot{}, err
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return Snapshot{}, fmt.Errorf("Open-Meteo 地理编码失败: %w", err)
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

	days := dayOffset + 1
	forecastURL := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f"+
			"&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m"+
			"&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum"+
			"&timezone=auto&forecast_days=%d",
		hit.Latitude, hit.Longitude, days,
	)
	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, forecastURL, nil)
	if err != nil {
		return Snapshot{}, err
	}
	resp2, err := s.http.Do(req2)
	if err != nil {
		return Snapshot{}, fmt.Errorf("Open-Meteo 天气请求失败: %w", err)
	}
	defer resp2.Body.Close()
	var fc forecast
	if err := json.NewDecoder(resp2.Body).Decode(&fc); err != nil {
		return Snapshot{}, fmt.Errorf("天气解析失败: %w", err)
	}

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

	if dayOffset == 0 {
		if fc.Current == nil {
			return Snapshot{}, fmt.Errorf("无当前天气")
		}
		cur := fc.Current
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
			DayOffset: 0,
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
		return snap, nil
	}

	if fc.Daily == nil || dayOffset >= len(fc.Daily.WeatherCode) {
		return Snapshot{}, fmt.Errorf("无%s预报", dayWord(dayOffset))
	}
	code := fc.Daily.WeatherCode[dayOffset]
	snap := Snapshot{
		Label:     label,
		Condition: weatherCodeZH(code),
		DayOffset: dayOffset,
		DailyOnly: true,
		HasDaily:  true,
	}
	if dayOffset < len(fc.Daily.Temperature2mMin) && dayOffset < len(fc.Daily.Temperature2mMax) {
		snap.TempMin = fc.Daily.Temperature2mMin[dayOffset]
		snap.TempMax = fc.Daily.Temperature2mMax[dayOffset]
		snap.TempC = (snap.TempMin + snap.TempMax) / 2
		snap.FeelsC = snap.TempC
	}
	if dayOffset < len(fc.Daily.PrecipitationSum) {
		snap.HasPrecipDay = true
		snap.PrecipDay = fc.Daily.PrecipitationSum[dayOffset]
	}
	if dayOffset < len(fc.Daily.UvIndexMax) {
		snap.HasUV = true
		snap.UV = fc.Daily.UvIndexMax[dayOffset]
		snap.UVLevel = uvLevelZH(snap.UV)
	}
	snap.Hints = protectionHints(code, snap.TempC, snap.FeelsC, 0, snap.UV, 0, snap.PrecipDay)
	return snap, nil
}

func parseTempC(s string) float64 {
	// "高温 37℃" / "低温 28℃" / "37℃"
	var num strings.Builder
	dot := false
	for _, r := range s {
		if r >= '0' && r <= '9' {
			num.WriteRune(r)
			continue
		}
		if r == '.' && !dot {
			num.WriteRune(r)
			dot = true
			continue
		}
		if num.Len() > 0 {
			break
		}
	}
	return parseFloat(num.String())
}

func parseFloat(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "<nil>" {
		return 0
	}
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}

func parsePercent(s string) float64 {
	s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "%"))
	return parseFloat(s)
}

func windLevelToKmh(fl string) float64 {
	// "1级" → rough mid of Beaufort-ish domestic scale
	n := parseTempC(fl)
	switch {
	case n <= 0:
		return 0
	case n == 1:
		return 5
	case n == 2:
		return 12
	case n == 3:
		return 20
	case n == 4:
		return 30
	case n == 5:
		return 40
	default:
		return n * 8
	}
}

func parseWindKmh(wse, ws string) float64 {
	if v := parseTempC(wse); v > 0 {
		return v
	}
	return windLevelToKmh(ws)
}

func conditionCodeApprox(cond string) int {
	switch {
	case strings.Contains(cond, "雷"):
		return 95
	case strings.Contains(cond, "暴雨"):
		return 82
	case strings.Contains(cond, "雨"):
		return 63
	case strings.Contains(cond, "雪"):
		return 73
	case strings.Contains(cond, "雾"):
		return 45
	case strings.Contains(cond, "晴"):
		return 0
	case strings.Contains(cond, "云"):
		return 2
	case strings.Contains(cond, "阴"):
		return 3
	default:
		return 2
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
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

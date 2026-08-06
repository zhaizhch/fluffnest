package weather

import "strings"

// cityCode maps common Chinese city names (and aliases) to weather.com.cn / sojson IDs.
// Prefer exact normalized keys without 市/县/区 suffix when possible.
var cityCode = map[string]string{
	"北京": "101010100", "北京市": "101010100", "beijing": "101010100",
	"天津": "101030100", "天津市": "101030100", "tianjin": "101030100",
	"上海": "101020100", "上海市": "101020100", "shanghai": "101020100",
	"重庆": "101040100", "重庆市": "101040100", "chongqing": "101040100",
	"石家庄": "101090101", "太原": "101100101", "呼和浩特": "101080101",
	"沈阳": "101070101", "长春": "101060101", "哈尔滨": "101050101",
	"南京": "101190101", "杭州": "101210101", "合肥": "101220101",
	"福州": "101230101", "南昌": "101240101", "济南": "101120101",
	"郑州": "101180101", "武汉": "101200101", "长沙": "101250101",
	"广州": "101280101", "南宁": "101300101", "海口": "101310101",
	"成都": "101270101", "贵阳": "101260101", "昆明": "101290101",
	"拉萨": "101140101", "西安": "101110101", "兰州": "101160101",
	"西宁": "101150101", "银川": "101170101", "乌鲁木齐": "101130101",
	"深圳": "101280601", "珠海": "101280701", "汕头": "101280501",
	"佛山": "101280800", "东莞": "101281601", "中山": "101281701",
	"惠州": "101280301", "苏州": "101190401", "无锡": "101190201",
	"常州": "101191101", "南通": "101190501", "扬州": "101190601",
	"徐州": "101190801", "宁波": "101210401", "温州": "101210701",
	"嘉兴": "101210301", "绍兴": "101210507", "金华": "101210901",
	"青岛": "101120201", "烟台": "101120501", "潍坊": "101120601",
	"大连": "101070201", "厦门": "101230201", "泉州": "101230501",
	"洛阳": "101180901", "开封": "101180801", "无锡市": "101190201",
	"沧州": "101090701", "南皮": "101090707", "南皮县": "101090707",
	"保定": "101090201", "唐山": "101090501", "廊坊": "101090601",
	"邯郸": "101091001", "秦皇岛": "101091101", "承德": "101090402",
	"张家口": "101090301", "衡水": "101090801", "邢台": "101090901",
	"香港": "101320101", "澳门": "101330101", "台北": "101340101",
}

func lookupCityCode(city string) (string, string, bool) {
	key := normalizeCityKey(city)
	if key == "" {
		return "", "", false
	}
	if code, ok := cityCode[key]; ok {
		return code, key, true
	}
	// Try without common suffixes.
	for _, suf := range []string{"特别行政区", "自治州", "地区", "盟", "市", "县", "区", "旗"} {
		if strings.HasSuffix(key, suf) && len([]rune(key)) > len([]rune(suf))+1 {
			trimmed := strings.TrimSuffix(key, suf)
			if code, ok := cityCode[trimmed]; ok {
				return code, trimmed, true
			}
		}
	}
	// Case-insensitive latin.
	low := strings.ToLower(key)
	if code, ok := cityCode[low]; ok {
		return code, key, true
	}
	return "", key, false
}

func normalizeCityKey(city string) string {
	city = strings.TrimSpace(city)
	city = strings.ReplaceAll(city, " ", "")
	city = strings.ReplaceAll(city, "　", "")
	return city
}

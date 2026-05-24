/**
 * 天气工具：基于 Open-Meteo（免费、无 key、全球）
 * 1) geocoding 城市名 -> 经纬度（带中文复合地名 + 拼音 fallback）
 * 2) forecast 取 current 字段
 *
 * 已知：Open-Meteo 中国城市的数据条目大多以英文/拼音存储（如 "Xuancheng"），
 * 直接传中文命中率很低。因此对中文输入会同时尝试中文与拼音变体。
 */
import { pinyin } from 'pinyin-pro'

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

// 部分常用城市的标准英文名（拼音库无法生成的特例）
const CITY_ALIAS = {
  哈尔滨: 'Harbin',
  乌鲁木齐: 'Urumqi',
  呼和浩特: 'Hohhot',
  拉萨: 'Lhasa',
  香港: 'Hong Kong',
  澳门: 'Macau',
}

function toPinyin(s) {
  return pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .map((w, i) => (i === 0 && w ? w[0].toUpperCase() + w.slice(1) : w))
    .join('')
}

// WMO 天气代码 -> 中文
const WEATHER_CODE = {
  0: '晴', 1: '少云', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '强阵雨', 82: '暴阵雨', 85: '小阵雪', 86: '大阵雪',
  95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
}

// 常见的省/直辖市/自治区前缀，长串在前以避免误匹配
const REGION_PREFIXES = [
  '内蒙古自治区', '广西壮族自治区', '宁夏回族自治区', '新疆维吾尔自治区',
  '西藏自治区', '香港特别行政区', '澳门特别行政区',
  '黑龙江省', '河北省', '山西省', '辽宁省', '吉林省', '江苏省', '浙江省',
  '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省', '湖南省',
  '广东省', '海南省', '四川省', '贵州省', '云南省', '陕西省', '甘肃省',
  '青海省', '台湾省',
  '内蒙古', '黑龙江', '河北', '山西', '辽宁', '吉林', '江苏', '浙江',
  '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西',
  '海南', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏',
  '新疆', '香港', '澳门', '台湾',
  '北京市', '天津市', '上海市', '重庆市',
  '北京', '天津', '上海', '重庆',
]

// 末尾的常见行政后缀
const TAIL_SUFFIXES = ['特别行政区', '自治区', '自治州', '自治县', '省', '市', '区', '县', '盟', '旗']

/** 规范化原始输入：剥离行政前后缀、按分隔符切分，得到一组中文候选 */
function normalizeChinese(raw) {
  const out = []
  const seen = new Set()
  const push = (s) => {
    const v = (s || '').trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }

  const orig = (raw || '').trim()
  if (!orig) return out

  push(orig)

  // 剥离尾部行政后缀（"宣城市" → "宣城"）
  let tail = orig
  for (const suf of TAIL_SUFFIXES) {
    if (tail.endsWith(suf) && tail.length > suf.length) {
      tail = tail.slice(0, -suf.length).trim()
      push(tail)
      break
    }
  }

  // 剥离前部省/直辖市前缀（"安徽宣城" → "宣城"），再叠加尾部剥离
  for (const p of REGION_PREFIXES) {
    if (orig.startsWith(p) && orig.length > p.length) {
      const rest = orig.slice(p.length).trim()
      push(rest)
      for (const suf of TAIL_SUFFIXES) {
        if (rest.endsWith(suf) && rest.length > suf.length) {
          push(rest.slice(0, -suf.length).trim())
          break
        }
      }
      break
    }
  }

  // 按空格/逗号切分，分别取最后一段、第一段
  const parts = orig.split(/[\s,，、/]+/).filter(Boolean)
  if (parts.length > 1) {
    push(parts[parts.length - 1])
    push(parts[0])
  }

  return out
}

/** 生成 geocoding 候选关键词：中文候选 + 对应拼音/英文别名，按可信度从高到低 */
function* candidates(raw) {
  const seen = new Set()
  const push = (s) => {
    const v = (s || '').trim()
    if (v && !seen.has(v)) {
      seen.add(v)
      return v
    }
    return null
  }

  // 若输入已经是 ASCII（拼音/英文），直接尝试
  if (/^[\x00-\x7F]+$/.test(raw)) {
    const c = push(raw.trim())
    if (c) yield c
    return
  }

  const zhList = normalizeChinese(raw)

  // 1) 先尝试所有中文候选（少数城市 zh 可命中）
  for (const z of zhList) {
    const c = push(z)
    if (c) yield c
  }

  // 2) 再尝试拼音/英文别名候选（Open-Meteo 中国数据多为英文条目）
  for (const z of zhList) {
    if (CITY_ALIAS[z]) {
      const c = push(CITY_ALIAS[z])
      if (c) yield c
    }
    const py = toPinyin(z)
    const c = push(py)
    if (c) yield c
  }
}

async function geocode(name, signal) {
  const url = `${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=zh`
  const resp = await fetch(url, { signal })
  if (!resp.ok) return null
  const json = await resp.json()
  return json.results?.[0] || null
}

export async function getWeather({ city }, { signal } = {}) {
  if (!city) throw new Error('city 参数缺失')

  let place = null
  for (const c of candidates(city)) {
    place = await geocode(c, signal)
    if (place) break
  }
  if (!place) throw new Error(`没找到城市：${city}`)

  const wUrl =
    `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&timezone=auto`
  const wResp = await fetch(wUrl, { signal })
  if (!wResp.ok) throw new Error(`forecast 失败 (${wResp.status})`)
  const w = await wResp.json()
  const c = w.current || {}

  return {
    city: place.name,
    country: place.country,
    admin1: place.admin1,
    temperature_c: c.temperature_2m,
    feels_like_c: c.apparent_temperature,
    humidity_percent: c.relative_humidity_2m,
    wind_speed_kmh: c.wind_speed_10m,
    condition: WEATHER_CODE[c.weather_code] || `未知(${c.weather_code})`,
    observed_at: c.time,
  }
}

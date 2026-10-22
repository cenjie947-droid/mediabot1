import { createClient } from '@supabase/supabase-js'

const REDFOX_BASE = (process.env.REDFOX_BASE_URL || 'https://redfox.hk').replace(/\/$/, '')
const REDFOX_KEY = process.env.REDFOX_API_KEY || ''
const DOYIN_SOURCE = process.env.REDFOX_DOUYIN_SOURCE || '点赞排行榜'
const SUPPORTED = ['douyin', 'xiaohongshu', 'kuaishou', 'wechat', 'toutiao', 'bilibili', 'weibo', 'zhihu', 'baidu']

const endpointConfig = () => {
  try { return JSON.parse(process.env.REDFOX_TREND_ENDPOINTS_JSON || '{}') } catch { return {} }
}

function normalizeNumber(v) {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const s = String(v).replace(/,/g, '').trim().toLowerCase()
  const m = s.match(/^([\d.]+)([万亿kw])?$/)
  if (!m) return Number(s) || 0
  const n = Number(m[1])
  const unit = m[2]
  return unit === '万' || unit === 'w' ? n * 1e4 : unit === '亿' ? n * 1e8 : unit === 'k' ? n * 1e3 : n
}

function extractList(payload) {
  const d = payload?.data ?? payload?.result ?? payload
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.list)) return d.list
  if (Array.isArray(d?.items)) return d.items
  if (Array.isArray(d?.records)) return d.records
  return []
}

function normalizeItem(platform, row, source, index) {
  const title = row.title || row.video_title || row.name || row.keyword || row.word || row.hotword || row.query || `热点 ${index + 1}`
  const url = row.share_url || row.workUrl || row.url || row.link || row.article_url || row.note_url || ''
  const likes = normalizeNumber(row.like ?? row.likes ?? row.liked ?? row.likedGrowth)
  const comments = normalizeNumber(row.comment ?? row.comments ?? row.commentCount ?? row.commentsGrowth)
  const shares = normalizeNumber(row.share ?? row.shares ?? row.sharedGrowth)
  const favorites = normalizeNumber(row.collect ?? row.collects ?? row.favorites ?? row.collectedGrowth)
  const heat = normalizeNumber(row.hot_score ?? row.hotScore ?? row.hot ?? row.heat ?? row.index ?? row.score)
  const rank = Number(row.rank ?? row.ranking ?? row.position ?? index + 1) || index + 1
  return {
    platform,
    title: String(title).slice(0, 500),
    url: String(url).slice(0, 2000),
    rank,
    heat_score: heat,
    likes,
    comments,
    shares,
    favorites,
    author_name: String(row.author_name || row.author || row.nickname || row.accountName || '').slice(0, 200),
    category: String(row.category || row.type || '').slice(0, 100),
    published_at: row.publish_time || row.publishTime || row.create_time || row.created_at || null,
    source,
    raw: row
  }
}

async function redfoxPost(path, body = {}) {
  if (!REDFOX_KEY) throw new Error('未配置 REDFOX_API_KEY')
  const r = await fetch(`${REDFOX_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': REDFOX_KEY, REDFOX_API_KEY: REDFOX_KEY },
    body: JSON.stringify(body)
  })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`RedFox 返回非 JSON：HTTP ${r.status}`) }
  if (!r.ok || (json.code && ![200, 2000].includes(Number(json.code)))) throw new Error(`RedFox 请求失败：${json.msg || json.message || r.status}`)
  return json
}

async function fetchDouyinDailyHot() {
  const today = new Date()
  today.setDate(today.getDate() - 1)
  const day = today.toISOString().slice(0, 10)
  return redfoxPost('/story/api/dy/search/likesRank', { source: DOYIN_SOURCE, startTime: day, endTime: day })
}

async function fetchDouyinSurge() {
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  return redfoxPost('/story/api/dy/search/hotContentRank', { source: DOYIN_SOURCE, startTime: day })
}

async function fetchConfigured(platform) {
  const cfg = endpointConfig()[platform]
  if (!cfg?.path) return null
  return redfoxPost(cfg.path, cfg.body || {})
}

export async function syncRedfoxTrends({ admin, source = 'redfox', userId = null } = {}) {
  if (!admin) throw new Error('缺少 Supabase service key')
  if (!REDFOX_KEY) throw new Error('未配置 REDFOX_API_KEY')
  const sources = []
  const tasks = [
    ['douyin', 'daily_hot', fetchDouyinDailyHot],
    ['douyin', 'surge', fetchDouyinSurge]
  ]
  for (const platform of SUPPORTED.filter(p => p !== 'douyin')) {
    const fn = endpointConfig()[platform]
    if (fn?.path) tasks.push([platform, fn.kind || 'hot', () => fetchConfigured(platform)])
  }
  for (const [platform, kind, fn] of tasks) {
    try {
      const payload = await fn()
      const rows = extractList(payload)
      const items = rows.map((row, i) => normalizeItem(platform, row, source, i))
      if (!items.length) continue
      const snapshot = items.map(x => ({
        user_id: userId,
        source,
        platform: x.platform,
        kind,
        title: x.title,
        url: x.url,
        rank: x.rank,
        heat_score: x.heat_score,
        likes: x.likes,
        comments: x.comments,
        shares: x.shares,
        favorites: x.favorites,
        author_name: x.author_name,
        category: x.category,
        published_at: x.published_at,
        raw: x.raw
      }))
      const { error } = await admin.from('trend_items').insert(snapshot)
      if (error) throw error
      sources.push({ platform, kind, count: snapshot.length })
    } catch (error) {
      sources.push({ platform, kind, count: 0, error: error.message })
    }
  }
  return { source, synced_at: new Date().toISOString(), sources }
}

export function trendScore(row, crossPlatformCount = 1) {
  const rankScore = Math.max(0, 100 - Math.min(99, Number(row.rank || 50) * 2))
  const interaction = Math.log10(1 + Number(row.likes || 0) + Number(row.comments || 0) * 2 + Number(row.shares || 0) * 3 + Number(row.favorites || 0)) * 7
  const cross = Math.min(20, Math.max(0, crossPlatformCount - 1) * 8)
  return Math.round(Math.min(100, rankScore * 0.45 + interaction * 0.35 + cross * 0.2))
}

export async function buildTrendEvents(admin, limit = 100) {
  const { data, error } = await admin.from('trend_items').select('*').order('fetched_at', { ascending: false }).limit(limit)
  if (error) throw error
  const groups = new Map()
  for (const item of data || []) {
    const key = String(item.title).toLowerCase().replace(/[#\s\p{P}\p{S}]/gu, '').slice(0, 80)
    if (!key) continue
    const arr = groups.get(key) || []
    arr.push(item)
    groups.set(key, arr)
  }
  const events = [...groups.values()].map(items => {
    const platforms = [...new Set(items.map(x => x.platform))]
    const best = [...items].sort((a, b) => (a.rank || 999) - (b.rank || 999))[0]
    const score = Math.max(...items.map(x => trendScore(x, platforms.length)))
    return {
      canonical_key: String(best.title).toLowerCase().replace(/[#\s\p{P}\p{S}]/gu, '').slice(0, 160),
      title: best.title,
      score,
      platforms,
      source_count: platforms.length,
      representative_url: best.url || null,
      metadata: { items: items.slice(0, 20).map(x => ({ id: x.id, platform: x.platform, rank: x.rank, heat_score: x.heat_score, likes: x.likes, comments: x.comments, shares: x.shares, url: x.url })) }
    }
  }).sort((a, b) => b.score - a.score).slice(0, 50)
  return events
}

export { SUPPORTED }

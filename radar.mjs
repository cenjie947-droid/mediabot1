import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY')
const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// No official Douyin trend API is assumed. This task intentionally reports manual-first mode;
// it must never invent market numbers or scrape login-protected pages.
export async function fetchDouyinRadar(config = {}) {
  return {
    mode: 'manual-first',
    fetched: 0,
    inserted: 0,
    skipped: true,
    reason: '当前没有可用的官方抖音热点数据权限。请在 MediaBot「爆款雷达」录入公开视频的公开指标；后续可接入获授权的数据源。',
    configuredSource: Boolean(config.sourceUrl || process.env.RADAR_DATA_SOURCE_URL)
  }
}

export async function analyzeRadar(config = {}) {
  const days = Math.max(1, Math.min(30, Number(config.days) || 7))
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data, error } = await admin.from('radar_video_snapshots')
    .select('user_id,video_key,category,snapshot_at,views,likes,comments,shares,favorites,published_at')
    .gte('snapshot_at', since).order('snapshot_at', { ascending: false }).limit(5000)
  if (error) throw new Error(error.message)
  const videos = new Map()
  for (const row of data || []) {
    const key = `${row.user_id}:${row.video_key}`
    if (!videos.has(key)) videos.set(key, [])
    videos.get(key).push(row)
  }
  const groups = new Map()
  for (const snapshots of videos.values()) {
    const latest = snapshots[0]
    const category = latest.category || '未分类'
    if (!groups.has(category)) groups.set(category, { category, sampledVideos: 0, views: 0, likes: 0, comments: 0, shares: 0, favorites: 0, hourlyViewGrowth: 0, trackedVideos: 0 })
    const g = groups.get(category)
    g.sampledVideos++
    for (const field of ['views','likes','comments','shares','favorites']) g[field] += Number(latest[field] || 0)
    const previous = snapshots.find(s => new Date(s.snapshot_at) < new Date(latest.snapshot_at))
    if (previous) {
      const hours = (new Date(latest.snapshot_at) - new Date(previous.snapshot_at)) / 3600000
      if (hours > 0) {
        g.hourlyViewGrowth += Math.max(0, Number(latest.views || 0) - Number(previous.views || 0)) / hours
        g.trackedVideos++
      }
    }
  }
  return { days, sampledVideos: videos.size, categories: [...groups.values()].sort((a,b) => b.hourlyViewGrowth - a.hourlyViewGrowth), disclaimer: '统计范围仅为已录入样本，不代表抖音全平台总量。' }
}

export async function runCategoryRadar(config = {}) {
  return analyzeRadar(config)
}

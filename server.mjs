import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '1mb' }))

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const AI_API_KEY = process.env.AI_API_KEY
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
const DOUYIN_CLIENT_KEY = process.env.DOUYIN_CLIENT_KEY
const DOUYIN_CLIENT_SECRET = process.env.DOUYIN_CLIENT_SECRET
const DOUYIN_REDIRECT_URI = process.env.DOUYIN_REDIRECT_URI || (PUBLIC_APP_URL ? `${PUBLIC_APP_URL}/api/oauth/douyin/callback` : '')
const XHS_CLIENT_ID = process.env.XHS_CLIENT_ID
const XHS_CLIENT_SECRET = process.env.XHS_CLIENT_SECRET
const XHS_REDIRECT_URI = process.env.XHS_REDIRECT_URI || (PUBLIC_APP_URL ? `${PUBLIC_APP_URL}/api/oauth/xiaohongshu/callback` : '')
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) console.warn('Missing Supabase server configuration')
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim()
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return res.status(401).json({ error: '未登录或服务器未配置 Supabase' })
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data, error } = await client.auth.getUser()
    if (error || !data?.user) {
      console.warn('Auth verification failed:', error?.message || 'no user')
      return res.status(401).json({ error: '登录状态已失效，请重新登录', detail: error?.message || 'Supabase 未返回用户' })
    }
    req.user = data.user
    req.userToken = token
    next()
  } catch (error) {
    console.warn('Auth verification exception:', error.message)
    return res.status(401).json({ error: '登录状态验证失败，请重新登录', detail: error.message })
  }
}

function userClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
}


const radarCategories = ['全部赛道','伤感','搞笑','情感','美食','美女','汽车','宠物','知识','影视','游戏','财经','其他']
app.get('/api/radar/snapshots', auth, async (req, res) => {
  try {
    const db = userClient(req.userToken)
    const days = Math.max(1, Math.min(30, Number(req.query.days) || 7))
    const since = new Date(Date.now() - days * 86400000).toISOString()
    let q = db.from('radar_video_snapshots').select('*').gte('snapshot_at', since).order('snapshot_at', { ascending: false }).limit(500)
    if (req.query.category && req.query.category !== '全部赛道') q = q.eq('category', String(req.query.category).slice(0, 40))
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    const byVideo = new Map()
    for (const row of data || []) {
      if (!byVideo.has(row.video_key)) byVideo.set(row.video_key, [])
      byVideo.get(row.video_key).push(row)
    }
    const videos = [...byVideo.values()].map(rows => {
      const latest = rows[0]
      const previous = rows.find(r => new Date(r.snapshot_at) < new Date(latest.snapshot_at))
      const hours = previous ? Math.max((new Date(latest.snapshot_at) - new Date(previous.snapshot_at)) / 3600000, 0.01) : 0
      const delta = previous ? Math.max(0, Number(latest.views || 0) - Number(previous.views || 0)) : null
      return { ...latest, snapshots: rows.length, previousViews: previous ? Number(previous.views || 0) : null, viewGrowth: delta, hourlyViewGrowth: hours ? delta / hours : null, growthPercent: previous && Number(previous.views) > 0 ? (delta / Number(previous.views)) * 100 : null }
    })
    const categories = new Map()
    for (const v of videos) {
      const c = categories.get(v.category) || { category: v.category, sampledVideos: 0, views: 0, likes: 0, comments: 0, shares: 0, favorites: 0, hourlyViewGrowth: 0, trackedVideos: 0 }
      c.sampledVideos++; for (const k of ['views','likes','comments','shares','favorites']) c[k] += Number(v[k] || 0)
      if (v.hourlyViewGrowth !== null) { c.hourlyViewGrowth += v.hourlyViewGrowth; c.trackedVideos++ }
      categories.set(v.category, c)
    }
    const categoryRows = [...categories.values()].map(c => ({ ...c, hourlyViewGrowth: c.trackedVideos ? Math.round(c.hourlyViewGrowth) : null })).sort((a,b) => (b.hourlyViewGrowth ?? -1) - (a.hourlyViewGrowth ?? -1))
    res.json({ days, videos, categories: categoryRows, sampledVideos: videos.length, disclaimer: '仅统计你已录入的样本，不代表抖音全平台数据。增长速度只根据同一视频的历史快照计算。' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})
app.post('/api/radar/snapshots', auth, async (req, res) => {
  try {
    const b = req.body || {}
    const videoUrl = String(b.videoUrl || '').trim()
    const title = String(b.title || '').trim()
    const category = String(b.category || '').trim()
    if (!videoUrl || !title || !category) return res.status(400).json({ error: '视频链接、标题和赛道为必填项' })
    let parsed
    try { parsed = new URL(videoUrl) } catch { return res.status(400).json({ error: '视频链接格式不正确' }) }
    if (!['http:','https:'].includes(parsed.protocol)) return res.status(400).json({ error: '仅支持 http/https 链接' })
    const num = (v, key) => {
      if (v === '' || v === null || v === undefined) return 0
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0 || n > 9000000000000000) throw new Error(key + ' 必须是非负数字')
      return Math.floor(n)
    }
    let metrics
    try { metrics = { views:num(b.views,'播放量'), likes:num(b.likes,'点赞量'), comments:num(b.comments,'评论量'), shares:num(b.shares,'转发量'), favorites:num(b.favorites,'收藏量') } }
    catch (e) { return res.status(400).json({ error: e.message }) }
    const videoKey = String(b.videoKey || parsed.pathname || videoUrl).slice(0, 300)
    const db = userClient(req.userToken)
    const row = { user_id:req.user.id, video_key:videoKey, video_url:videoUrl, title:title.slice(0,300), creator_name:String(b.creatorName || '').slice(0,160) || null, category:category.slice(0,40), platform:'douyin', published_at:b.publishedAt ? new Date(b.publishedAt).toISOString() : null, snapshot_at:new Date().toISOString(), ...metrics, avg_watch_seconds:b.avgWatchSeconds === '' || b.avgWatchSeconds == null ? null : Number(b.avgWatchSeconds), completion_rate:b.completionRate === '' || b.completionRate == null ? null : Number(b.completionRate), retention_3s:b.retention3s === '' || b.retention3s == null ? null : Number(b.retention3s), retention_5s:b.retention5s === '' || b.retention5s == null ? null : Number(b.retention5s), retention_10s:b.retention10s === '' || b.retention10s == null ? null : Number(b.retention10s), source_type:'manual', notes:String(b.notes || '').slice(0,1000) || null }
    for (const key of ['completion_rate','retention_3s','retention_5s','retention_10s']) if (row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0 || row[key] > 100)) return res.status(400).json({ error: key + ' 必须在 0 到 100 之间' })
    if (row.avg_watch_seconds !== null && (!Number.isFinite(row.avg_watch_seconds) || row.avg_watch_seconds < 0)) return res.status(400).json({ error: '平均观看时长必须是非负数字' })
    const { data, error } = await db.from('radar_video_snapshots').insert(row).select().single()
    if (error) return res.status(500).json({ error: error.message })
    res.status(201).json({ data })
  } catch (e) { res.status(400).json({ error: e.message || '录入失败' }) }
})
app.get('/api/radar/preferences', auth, async (req, res) => {
  const db = userClient(req.userToken)
  const { data, error } = await db.from('radar_preferences').select('*').eq('user_id', req.user.id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ data: data || { watched_categories: ['伤感','情感'], production_mode: 'market' } })
})
app.put('/api/radar/preferences', auth, async (req, res) => {
  const categories = Array.isArray(req.body?.watchedCategories) ? req.body.watchedCategories.filter(x => radarCategories.includes(x) && x !== '全部赛道').slice(0, 13) : []
  const mode = req.body?.productionMode === 'vertical' ? 'vertical' : 'market'
  const db = userClient(req.userToken)
  const { data, error } = await db.from('radar_preferences').upsert({ user_id:req.user.id, watched_categories:categories, production_mode:mode, updated_at:new Date().toISOString() }, { onConflict:'user_id' }).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ data })
})

app.get('/api/video/assets', auth, async (req, res) => {
  try {
    const db = userClient(req.userToken)
    const { data, error } = await db.from('video_assets').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(200)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data: data || [] })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/video/assets', auth, async (req, res) => {
  const b = req.body || {}
  const storagePath = String(b.storagePath || '')
  const fileName = String(b.fileName || '').slice(0, 240)
  const mimeType = String(b.mimeType || '')
  const sizeBytes = Number(b.sizeBytes || 0)
  if (!storagePath.startsWith(req.user.id + '/') || storagePath.includes('..')) return res.status(400).json({ error: '素材路径无效' })
  if (!fileName || !['video/','audio/','image/'].some(prefix => mimeType.startsWith(prefix))) return res.status(400).json({ error: '只支持视频、音频或图片素材' })
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 1024 * 1024 * 1024) return res.status(400).json({ error: '视频大小无效或超过1GB' })
  const db = userClient(req.userToken)
  const { data, error } = await db.from('video_assets').upsert({ user_id: req.user.id, storage_path: storagePath, file_name: fileName, mime_type: mimeType, size_bytes: sizeBytes, status: 'ready' }, { onConflict: 'user_id,storage_path' }).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ data })
})

app.post('/api/video/remix', auth, async (req, res) => {
  if (!SUPABASE_SECRET_KEY) return res.status(503).json({ error: '服务器未配置 Supabase Secret Key，无法在服务器端处理视频' })
  const assetIds = Array.isArray(req.body?.assetIds) ? [...new Set(req.body.assetIds.map(String))].slice(0, 12) : []
  if (!assetIds.length) return res.status(400).json({ error: '请先上传并选择自己的视频素材' })
  const referenceUrl = String(req.body?.referenceUrl || '').trim().slice(0, 2000)
  if (referenceUrl) {
    try { if (!['http:', 'https:'].includes(new URL(referenceUrl).protocol)) throw new Error() }
    catch { return res.status(400).json({ error: '爆款链接格式不正确' }) }
  }
  const referenceNotes = String(req.body?.referenceNotes || '').slice(0, 5000)
  const musicAssetId = String(req.body?.musicAssetId || '')
  const referenceImageAssetId = String(req.body?.referenceImageAssetId || '')
  const referenceVideoAssetId = String(req.body?.referenceVideoAssetId || '')
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { data: assets, error: assetsError } = await admin.from('video_assets').select('id,storage_path,file_name').eq('user_id', req.user.id).in('id', assetIds)
  if (assetsError) return res.status(500).json({ error: assetsError.message })
  if (!assets || assets.length !== assetIds.length) return res.status(400).json({ error: '部分素材不存在或不属于当前账号，请刷新素材库后重试' })
  const { data: videoRows, error: videoError } = await admin.from('video_assets').select('id,storage_path,mime_type').eq('user_id', req.user.id).in('id', assetIds).like('mime_type', 'video/%')
  if (videoError || !videoRows || videoRows.length !== assetIds.length) return res.status(400).json({ error: '只能选择视频素材进行剪辑，请重新选择' })
  let musicPath = ''
  let musicOptions = []
  if (musicAssetId === 'auto') {
    const { data: tracks, error } = await admin.from('video_assets').select('storage_path,file_name,mime_type').eq('user_id', req.user.id).like('mime_type', 'audio/%').order('created_at', { ascending: false }).limit(50)
    if (error) return res.status(500).json({ error: error.message })
    musicOptions = (tracks || []).map(track => ({ storagePath: track.storage_path, fileName: track.file_name }))
  } else if (musicAssetId) {
    const { data: music, error } = await admin.from('video_assets').select('id,storage_path,mime_type').eq('id', musicAssetId).eq('user_id', req.user.id).maybeSingle()
    if (error || !music || !music.mime_type.startsWith('audio/')) return res.status(400).json({ error: '配乐文件不存在或格式不支持' })
    musicPath = music.storage_path
  }
  let referenceImagePath = ''
  let referenceImageMime = 'image/jpeg'
  let referenceVideoPath = ''
  if (referenceVideoAssetId) {
    const { data: referenceVideo, error } = await admin.from('video_assets').select('id,storage_path,mime_type').eq('id', referenceVideoAssetId).eq('user_id', req.user.id).maybeSingle()
    if (error || !referenceVideo || !referenceVideo.mime_type.startsWith('video/')) return res.status(400).json({ error: '爆款参考视频不存在或格式不支持' })
    referenceVideoPath = referenceVideo.storage_path
  }
  if (referenceImageAssetId) {
    const { data: image, error } = await admin.from('video_assets').select('id,storage_path,mime_type').eq('id', referenceImageAssetId).eq('user_id', req.user.id).maybeSingle()
    if (error || !image || !image.mime_type.startsWith('image/')) return res.status(400).json({ error: '爆款参考截图不存在或格式不支持' })
    referenceImagePath = image.storage_path
    referenceImageMime = image.mime_type
  }
  const { data: job, error: jobError } = await admin.from('video_remix_jobs').insert({
    user_id: req.user.id, reference_url: referenceUrl || null, reference_notes: referenceNotes || null,
    input_asset_ids: assetIds, music_storage_path: musicPath || null, status: 'analyzing'
  }).select().single()
  if (jobError) return res.status(500).json({ error: jobError.message })
  res.status(202).json({ job: { id: job.id, status: job.status } })
  ;(async () => {
    try {
      const { createVideoRemix } = await import('./video-remix.mjs')
      const result = await createVideoRemix({ admin, userId: req.user.id, referenceUrl, referenceNotes, assetPaths: videoRows.map(a => a.storage_path), musicPath, referenceImagePath, referenceImageMime, referenceVideoPath, musicOptions })
      const { data: content, error: contentError } = await admin.from('content_items').insert({ user_id: req.user.id, title: result.editPlan.title, body: [result.editPlan.caption, result.editPlan.hook, result.editPlan.structure, Array.isArray(result.editPlan.hashtags) ? result.editPlan.hashtags.map(tag => '#' + String(tag).replace(/^#/, '')).join(' ') : ''].filter(Boolean).join('\n\n'), platform: 'douyin', status: 'draft', media_urls: [result.outputPath] }).select('id').single()
      if (contentError) throw new Error('成片已生成，但写入内容库失败：' + contentError.message)
      await admin.from('video_remix_jobs').update({ status: 'completed', output_storage_path: result.outputPath, edit_plan: result.editPlan, content_id: content.id, completed_at: new Date().toISOString(), error_message: null }).eq('id', job.id).eq('user_id', req.user.id)
      await admin.from('run_logs').insert({ user_id: req.user.id, task_type: 'video_remix', level: 'success', message: '自动剪辑成片完成', metadata: { job_id: job.id, output_path: result.outputPath, duration_seconds: result.editPlan.durationSeconds } })
    } catch (e) {
      await admin.from('video_remix_jobs').update({ status: 'failed', error_message: String(e.message || e).slice(0, 1800) }).eq('id', job.id).eq('user_id', req.user.id)
      await admin.from('run_logs').insert({ user_id: req.user.id, task_type: 'video_remix', level: 'error', message: '自动剪辑失败', metadata: { job_id: job.id, error: String(e.message || e).slice(0, 500) } })
    }
  })()
})

app.get('/api/video/remix/:id', auth, async (req, res) => {
  const admin = SUPABASE_SECRET_KEY ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null
  if (!admin) return res.status(503).json({ error: '服务器未配置 Supabase Secret Key' })
  const { data, error } = await admin.from('video_remix_jobs').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: '剪辑任务不存在' })
  let outputUrl = null
  if (data.output_storage_path) {
    const { data: signed, error: signError } = await admin.storage.from('publish-media').createSignedUrl(data.output_storage_path, 3600)
    if (!signError) outputUrl = signed?.signedUrl || null
  }
  res.json({ job: { ...data, output_url: outputUrl } })
})

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'mediabot-api', version: '0.7.0', supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_KEY), secretConfigured: Boolean(SUPABASE_SECRET_KEY), aiConfigured: Boolean(AI_API_KEY), publicAppConfigured: Boolean(PUBLIC_APP_URL), douyinConfigured: Boolean(DOUYIN_CLIENT_KEY && DOUYIN_CLIENT_SECRET), xiaohongshuConfigured: Boolean(XHS_CLIENT_ID && XHS_CLIENT_SECRET) }))

app.post('/api/automation/run-now', auth, async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return res.status(503).json({ error: '自动化服务未配置 SUPABASE_SECRET_KEY。请先配置 .env。' })
    const { runAutomation } = await import('./automation.mjs')
    const result = await runAutomation({ userId: req.user.id, force: true })
    res.json(result)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/ai/generate', auth, async (req, res) => {
  const { topic, platform = 'all', tone = '专业但有网感', length = '中等', requirements = '' } = req.body || {}
  if (!topic?.trim()) return res.status(400).json({ error: '请输入主题' })
  if (!AI_API_KEY) return res.status(503).json({ error: 'AI 服务尚未配置。请在服务器环境变量中设置 AI_API_KEY、AI_BASE_URL、AI_MODEL。' })

  const system = `你是中文内容运营总监。根据用户给出的热点/主题，输出适合中国社交媒体的原创内容。必须避免虚构事实，不能编造来源或数据。请严格返回 JSON，不要 Markdown 代码块。字段：title(string), xiaohongshu(string), douyin(string), summary(string), hashtags(string[]), ai_score(number 0-100), recommendation(string).`
  const user = `主题：${topic}\n目标平台：${platform}\n语气：${tone}\n篇幅：${length}\n用户补充要求：${String(requirements || '').trim() || '无'}\n请给出可直接进入内容库的版本。小红书要有吸引人的开头、分段、行动建议；抖音要适合口播，包含3秒钩子、主体和结尾行动号召。`

  try {
    const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({ model: AI_MODEL, temperature: 0.7, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
    })
    const raw = await r.text()
    if (!r.ok) return res.status(502).json({ error: `AI 服务返回 ${r.status}`, detail: raw.slice(0, 800) })
    const payload = JSON.parse(raw)
    const content = payload.choices?.[0]?.message?.content
    if (!content) return res.status(502).json({ error: 'AI 没有返回内容' })
    let result
    try { result = JSON.parse(content) } catch { return res.status(502).json({ error: 'AI 返回格式不是 JSON', detail: content.slice(0, 800) }) }

    const db = userClient(req.userToken)
    const body = platform === 'xiaohongshu' ? result.xiaohongshu : platform === 'douyin' ? result.douyin : result.xiaohongshu
    const { data: row, error } = await db.from('content_items').insert({
      user_id: req.user.id,
      title: result.title || topic,
      body: body || result.summary || '',
      platform,
      status: 'draft',
      media_urls: Array.isArray(req.body?.mediaUrls) ? req.body.mediaUrls : [],
      ai_score: Number.isFinite(Number(result.ai_score)) ? Math.max(0, Math.min(100, Number(result.ai_score))) : null
    }).select().single()
    if (error) return res.status(500).json({ error: error.message })

    await db.from('ai_generations').insert({ content_id: row.id, prompt: user, model: AI_MODEL, result: result })
    await db.from('run_logs').insert({ user_id: req.user.id, task_type: 'generate', level: 'success', message: `AI 生成成功：${result.title || topic}`, metadata: { content_id: row.id, model: AI_MODEL } })
    res.json({ result, content: row })
  } catch (e) { res.status(500).json({ error: e.message }) }
})


function safeNext(next) { return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/' }
function oauthBase() { return PUBLIC_APP_URL || '' }

app.post('/api/oauth/:platform/start', auth, async (req, res) => {
  const platform = req.params.platform
  if (!['douyin','xiaohongshu'].includes(platform)) return res.status(400).send('不支持的平台')
  if (!SUPABASE_SECRET_KEY) return res.status(503).send('服务器未配置 Supabase Secret Key')
  const state = crypto.randomUUID()
  const expires = new Date(Date.now()+10*60*1000).toISOString()
  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)
  const { error } = await admin.from('oauth_states').insert({ state, user_id:req.user.id, platform, expires_at:expires })
  if (error) return res.status(500).send(error.message)
  let url
  if (platform === 'douyin') {
    if (!DOUYIN_CLIENT_KEY || !DOUYIN_REDIRECT_URI) return res.status(503).send('抖音 OAuth 尚未配置')
    url = new URL('https://open.douyin.com/platform/oauth/connect/')
    url.searchParams.set('client_key', DOUYIN_CLIENT_KEY)
    url.searchParams.set('response_type','code')
    url.searchParams.set('scope','user_info')
    url.searchParams.set('redirect_uri',DOUYIN_REDIRECT_URI)
    url.searchParams.set('state',state)
  } else {
    if (!XHS_CLIENT_ID || !XHS_REDIRECT_URI) return res.status(503).send('小红书 OAuth 尚未配置：请先配置官方开放平台应用凭证')
    return res.status(503).send('小红书 OAuth 适配器已预留，但当前项目未启用官方开放平台授权参数；请配置并按平台审核通过的 OAuth 地址接入。')
  }
  res.json({ url:url.toString() })
})

async function exchangeDouyin(code) {
  const r = await fetch('https://open.douyin.com/oauth/access_token/', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({client_key:DOUYIN_CLIENT_KEY,client_secret:DOUYIN_CLIENT_SECRET,code,grant_type:'authorization_code'}) })
  const text = await r.text(); if (!r.ok) throw new Error(`抖音换取 token 失败：${r.status}`)
  const j=JSON.parse(text); const d=j.data||j
  if (!d.access_token) throw new Error(d.description||d.message||'抖音未返回 access_token')
  return d
}

app.get('/api/oauth/douyin/callback', async (req,res) => {
  const { code, state, error, error_description } = req.query
  if (error) return res.redirect(`/?oauth_error=${encodeURIComponent(error_description||error)}`)
  if (!code || !state || !SUPABASE_SECRET_KEY) return res.redirect('/?oauth_error=授权参数不完整')
  const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY)
  const { data: st, error: se }=await admin.from('oauth_states').select('*').eq('state',state).single()
  if(se||!st||new Date(st.expires_at)<new Date()) return res.redirect('/?oauth_error=授权已过期，请重新连接')
  try {
    const token=await exchangeDouyin(code)
    const { data: userInfo } = await fetch('https://open.douyin.com/oauth/userinfo/', { headers:{Authorization:`Bearer ${token.access_token}`} }).then(r=>r.json())
    const info=userInfo?.data||{}
    const { data: account, error: ae }=await admin.from('social_accounts').upsert({ user_id:st.user_id, platform:'douyin', account_name:info.nickname||info.display_name||'抖音账号', display_name:info.nickname||info.display_name||'抖音账号', external_account_id:token.open_id||info.open_id||info.union_id||null, status:'connected', token_expires_at:token.expires_in?new Date(Date.now()+Number(token.expires_in)*1000).toISOString():null, metadata:{avatar:info.avatar,scope:token.scope||null,open_id:token.open_id||info.open_id||null,union_id:token.union_id||info.union_id||null} }, {onConflict:'user_id,platform,external_account_id'}).select().single()
    if(ae) throw new Error(ae.message)
    await admin.from('social_account_secrets').upsert({social_account_id:account.id,access_token:token.access_token,refresh_token:token.refresh_token||null,expires_at:token.expires_in?new Date(Date.now()+Number(token.expires_in)*1000).toISOString():null,metadata:token,updated_at:new Date().toISOString()})
    await admin.from('oauth_states').delete().eq('state',state)
    await admin.from('run_logs').insert({user_id:st.user_id,task_type:'oauth',level:'success',message:'抖音账号授权成功',metadata:{social_account_id:account.id}})
    res.redirect('/?oauth=success&platform=douyin')
  } catch(e) { await admin.from('oauth_states').delete().eq('state',state); res.redirect(`/?oauth_error=${encodeURIComponent(e.message)}`) }
})

app.post('/api/publish/queue', auth, async (req,res) => {
  const { contentId, socialAccountId, scheduledAt }=req.body||{}
  if(!contentId||!socialAccountId) return res.status(400).json({error:'contentId 和 socialAccountId 必填'})
  let normalizedSchedule = null
  if (scheduledAt) {
    const parsed = new Date(scheduledAt)
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({error:'定时发布时间无效'})
    if (parsed.getTime() <= Date.now()) return res.status(400).json({error:'定时发布时间必须晚于当前时间'})
    normalizedSchedule = parsed.toISOString()
  }
  const db=userClient(req.userToken)
  const {data:content,error:ce}=await db.from('content_items').select('*').eq('id',contentId).single()
  if(ce || !content) return res.status(404).json({error:'找不到该内容，或你没有访问权限'})
  const {data:account,error:ae}=await db.from('social_accounts').select('*').eq('id',socialAccountId).single()
  if(ae || !account) return res.status(404).json({error:'找不到该账号，或你没有访问权限'})
  if(account.status !== 'connected') return res.status(409).json({error:'该账号尚未完成官方授权，不能加入真实发布队列'})
  if(content.platform && content.platform !== 'all' && content.platform !== account.platform) return res.status(400).json({error:'内容目标平台与所选账号不一致'})
  const {data:job,error}=await db.from('publish_jobs').insert({user_id:req.user.id,content_id:content.id,social_account_id:account.id,platform:account.platform,status:'queued',scheduled_at:normalizedSchedule}).select().single()
  if(error) return res.status(500).json({error:error.message})
  const {error:updateError}=await db.from('content_items').update({status:normalizedSchedule?'scheduled':'review',scheduled_at:normalizedSchedule}).eq('id',content.id).eq('user_id',req.user.id)
  if(updateError) return res.status(500).json({error:'发布任务已入队，但内容状态更新失败：'+updateError.message,job})
  res.json({job})
})

app.get('/api/publish/jobs', auth, async (req,res) => {
  try {
    const db=userClient(req.userToken)
    const limit=Math.max(1,Math.min(100,Number(req.query.limit)||30))
    const {data,error}=await db.from('publish_jobs').select('id,content_id,social_account_id,platform,status,scheduled_at,started_at,published_at,external_id,error_message,created_at,updated_at').eq('user_id',req.user.id).order('created_at',{ascending:false}).limit(limit)
    if(error) return res.status(500).json({error:error.message})
    res.set('Cache-Control','no-store')
    res.json({jobs:data||[],count:(data||[]).length})
  } catch(e) { res.status(500).json({error:e.message}) }
})

app.post('/api/publish/run-now', auth, async (req,res) => {
  if(!SUPABASE_SECRET_KEY) return res.status(503).json({error:'服务器未配置 Secret Key'})
  const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY)
  const now=new Date().toISOString()
  const {data:jobs,error}=await admin.from('publish_jobs').select('*').eq('user_id',req.user.id).eq('status','queued').or('scheduled_at.is.null,scheduled_at.lte.'+now).order('scheduled_at',{ascending:true}).limit(10)
  if(error) return res.status(500).json({error:error.message})
  const {publishJobs}=await import('./publishers.mjs')
  const result=await publishJobs(admin,jobs||[])
  res.json(result)
})

app.post('/api/hot-topics/fetch-now', auth, async (req,res) => {
  try {
    if (!SUPABASE_SECRET_KEY) return res.status(503).json({error:'服务器未配置 Secret Key'})
    const { hotFetch } = await import('./automation.mjs')
    const result = await hotFetch(req.user.id, {})
    const { aiScore } = await import('./automation.mjs')
    const scored = AI_API_KEY ? await aiScore(req.user.id,{limit:8}) : {scored:0, skipped:true}
    res.json({result,scored})
  } catch(e) { res.status(500).json({error:e.message}) }
})

app.post('/api/hot-topics/demo-score', auth, async (req, res) => {
  const db = userClient(req.userToken)
  const rows = [
    { user_id: req.user.id, title: 'AI 电商新玩法', source: '行业观察', heat_score: 91, ai_score: 88, recommendation: '适合案例型内容' },
    { user_id: req.user.id, title: '短视频搜索流量上涨', source: '平台趋势', heat_score: 86, ai_score: 84, recommendation: '适合教程型内容' },
    { user_id: req.user.id, title: '年轻人开始用 AI 做副业', source: '社会趋势', heat_score: 82, ai_score: 79, recommendation: '适合观点型内容' }
  ]
  const { data, error } = await db.from('hot_topics').insert(rows).select()
  if (error) return res.status(500).json({ error: error.message })
  await db.from('run_logs').insert({ user_id: req.user.id, task_type: 'hot_fetch', level: 'success', message: '写入示例热点并完成评分', metadata: { count: data.length } })
  res.json({ data })
})

app.get('/api/hot-topics/feeds', auth, async (req, res) => {
  const feeds = (process.env.HOT_FEEDS || 'https://news.google.com/rss/search?q=AI+OR+人工智能+OR+大模型&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://news.google.com/rss/search?q=抖音+OR+小红书+OR+短视频&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://news.google.com/rss/search?q=电商+OR+消费+OR+营销&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://news.google.com/rss/search?q=科技+OR+互联网&hl=zh-CN&gl=CN&ceid=CN:zh-Hans').split(',').map(x => x.trim()).filter(Boolean)
  const results = []
  for (const url of feeds.slice(0, 10)) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'MediaBot/1.0' } })
      const text = await r.text()
      const items = [...text.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 10)
      for (const m of items) {
        const block = m[0]
        const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\\[CDATA\\[|\\]\\]>/g, '').trim()
        const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '').trim()
        if (title) results.push({ title, url: link, source: new URL(url).hostname })
      }
    } catch (e) { results.push({ source: url, error: e.message }) }
  }
  res.json({ data: results })
})

const dist = path.join(__dirname, 'dist')
app.use(express.static(dist))
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')))

const port = Number(process.env.PORT || 10000)
app.listen(port, '0.0.0.0', () => console.log(`MediaBot listening on ${port}`))

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
  const { topic, platform = 'all', tone = '专业但有网感', length = '中等' } = req.body || {}
  if (!topic?.trim()) return res.status(400).json({ error: '请输入主题' })
  if (!AI_API_KEY) return res.status(503).json({ error: 'AI 服务尚未配置。请在服务器环境变量中设置 AI_API_KEY、AI_BASE_URL、AI_MODEL。' })

  const system = `你是中文内容运营总监。根据用户给出的热点/主题，输出适合中国社交媒体的原创内容。必须避免虚构事实，不能编造来源或数据。请严格返回 JSON，不要 Markdown 代码块。字段：title(string), xiaohongshu(string), douyin(string), summary(string), hashtags(string[]), ai_score(number 0-100), recommendation(string).`
  const user = `主题：${topic}\n目标平台：${platform}\n语气：${tone}\n篇幅：${length}\n请给出可直接进入内容库的版本。小红书要有吸引人的开头、分段、行动建议；抖音要适合口播，包含3秒钩子、主体和结尾行动号召。`

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
  const db=userClient(req.userToken)
  const {data:content,error:ce}=await db.from('content_items').select('*').eq('id',contentId).single(); if(ce) return res.status(404).json({error:ce.message})
  const {data:account,error:ae}=await db.from('social_accounts').select('*').eq('id',socialAccountId).single(); if(ae) return res.status(404).json({error:ae.message})
  const {data:job,error}=await db.from('publish_jobs').insert({user_id:req.user.id,content_id:content.id,social_account_id:account.id,platform:account.platform,status:'queued',scheduled_at:scheduledAt||null}).select().single()
  if(error) return res.status(500).json({error:error.message})
  await db.from('content_items').update({status:scheduledAt?'scheduled':'review',scheduled_at:scheduledAt||null}).eq('id',content.id)
  res.json({job})
})

app.post('/api/publish/run-now', auth, async (req,res) => {
  if(!SUPABASE_SECRET_KEY) return res.status(503).json({error:'服务器未配置 Secret Key'})
  const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY)
  const {data:jobs,error}=await admin.from('publish_jobs').select('*').eq('user_id',req.user.id).eq('status','queued').order('scheduled_at',{ascending:true}).limit(10)
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

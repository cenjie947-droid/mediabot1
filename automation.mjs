import { createClient } from '@supabase/supabase-js'
import { CronExpressionParser } from 'cron-parser'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const AI_API_KEY = process.env.AI_API_KEY
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SECRET_KEY')
const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

function nextRun(cron, now = new Date()) {
  return CronExpressionParser.parse(cron, { currentDate: now }).next().toDate().toISOString()
}

function cleanXml(s='') {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim()
}

async function fetchFeed(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'MediaBot/0.4 (+https://mediabot.local)' } })
  if (!r.ok) throw new Error(`feed ${r.status}: ${url}`)
  const text = await r.text()
  const blocks = [...text.matchAll(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi)].slice(0, 20)
  return blocks.map(m => {
    const b = m[0]
    const title = cleanXml(b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    const link = cleanXml(b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '')
    const href = b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || link
    const summary = cleanXml(b.match(/<(description|summary|content)[^>]*>([\s\S]*?)<\/(description|summary|content)>/i)?.[2] || '')
    return { title, url: href, summary, source: new URL(url).hostname }
  }).filter(x => x.title)
}

async function aiJson(system, user) {
  if (!AI_API_KEY) throw new Error('AI_API_KEY 未配置')
  const r = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({ model: AI_MODEL, temperature: 0.4, response_format: { type: 'json_object' }, messages: [{ role:'system', content:system }, { role:'user', content:user }] })
  })
  const raw = await r.text()
  if (!r.ok) throw new Error(`AI ${r.status}: ${raw.slice(0,400)}`)
  const c = JSON.parse(raw).choices?.[0]?.message?.content
  if (!c) throw new Error('AI 无返回')
  return JSON.parse(c)
}

async function log(userId, level, message, metadata={}) {
  await admin.from('run_logs').insert({ user_id:userId, task_type:'automation', level, message, metadata })
}

export async function hotFetch(userId, config={}) {
  const feeds = (config.feeds || process.env.HOT_FEEDS || `https://news.google.com/rss/search?q=AI+OR+人工智能+OR+大模型&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://news.google.com/rss/search?q=抖音+OR+小红书+OR+短视频&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://news.google.com/rss/search?q=电商+OR+消费+OR+营销&hl=zh-CN&gl=CN&ceid=CN:zh-Hans,https://news.google.com/rss/search?q=科技+OR+互联网&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`).split(',').map(x=>x.trim()).filter(Boolean).slice(0,10)
  if (!feeds.length) throw new Error('没有配置热点源：请设置 HOT_FEEDS 或任务 config.feeds')
  let items=[]
  for (const url of feeds) { try { items.push(...await fetchFeed(url)) } catch (e) { await log(userId,'warning',`热点源抓取失败：${url}`,{error:e.message}) } }
  const titles = items.map(x=>x.title)
  if (!items.length) return { fetched:0, inserted:0 }
  const { data: existing } = await admin.from('hot_topics').select('title').eq('user_id',userId).in('title',titles.slice(0,100))
  const seen = new Set((existing||[]).map(x=>x.title))
  const rows = items.filter(x=>!seen.has(x.title)).slice(0,30).map(x=>({ user_id:userId,title:x.title,source:x.source,url:x.url,heat_score:null,ai_score:null,recommendation:null,metadata:{summary:x.summary,automation:true},discovered_at:new Date().toISOString() }))
  if (!rows.length) return { fetched:items.length, inserted:0 }
  const { error } = await admin.from('hot_topics').insert(rows)
  if (error) throw new Error(error.message)
  return { fetched:items.length, inserted:rows.length }
}

export async function aiScore(userId, config={}) {
  const limit = Number(config.limit || 8)
  const { data: topics, error } = await admin.from('hot_topics').select('*').eq('user_id',userId).is('ai_score',null).order('discovered_at',{ascending:false}).limit(limit)
  if (error) throw new Error(error.message)
  let scored=0
  for (const t of topics||[]) {
    const r = await aiJson('你是中文社交媒体热点分析师。只返回 JSON：ai_score(0-100), recommendation(string), heat_score(0-100)。不要编造外部事实。', `热点标题：${t.title}\n来源：${t.source||''}\n摘要：${t.metadata?.summary||''}`)
    const ai = Math.max(0,Math.min(100,Number(r.ai_score)||0))
    const heat = Math.max(0,Math.min(100,Number(r.heat_score)||Number(t.heat_score)||0))
    await admin.from('hot_topics').update({ai_score:ai,heat_score:heat,recommendation:r.recommendation||''}).eq('id',t.id).eq('user_id',userId)
    scored++
  }
  return { scored }
}

async function generate(userId, config={}) {
  const minScore = Number(config.min_score ?? 80)
  const limit = Number(config.limit || 3)
  const { data: topics, error } = await admin.from('hot_topics').select('*').eq('user_id',userId).gte('ai_score',minScore).order('ai_score',{ascending:false}).order('discovered_at',{ascending:false}).limit(limit)
  if (error) throw new Error(error.message)
  let generated=0
  for (const t of topics||[]) {
    const { data: existing } = await admin.from('content_items').select('id').eq('user_id',userId).eq('title',t.title).limit(1)
    if (existing?.length) continue
    const r = await aiJson('你是中文内容运营总监。根据热点生成原创社交媒体内容。只返回 JSON：title,xiaohongshu,douyin,summary,hashtags,ai_score,recommendation。不要编造事实、数据或来源。', `热点：${t.title}\n来源：${t.source||''}\n摘要：${t.metadata?.summary||''}\n热点评分：${t.ai_score}\n推荐：${t.recommendation||''}`)
    const body = r.xiaohongshu || r.douyin || r.summary || ''
    const { data: row, error: e } = await admin.from('content_items').insert({user_id:userId,title:r.title||t.title,body,platform:'all',status:'draft',ai_score:Math.max(0,Math.min(100,Number(r.ai_score)||t.ai_score))}).select().single()
    if (e) throw new Error(e.message)
    await admin.from('ai_generations').insert({content_id:row.id,prompt:`automation:${t.id}`,model:AI_MODEL,result:r})
    await admin.from('hot_topics').update({metadata:{...(t.metadata||{}),generated_content_id:row.id}}).eq('id',t.id).eq('user_id',userId)
    generated++
  }
  return { generated }
}

async function executeTask(task) {
  const config = task.config || {}
  let result={}
  if (task.task_type==='hot_fetch') result=await hotFetch(task.user_id,config)
  else if (task.task_type==='ai_score') result=await aiScore(task.user_id,config)
  else if (task.task_type==='generate') result=await generate(task.user_id,config)
  else if (task.task_type==='publish') { const { publishJobs } = await import('./publishers.mjs'); const now=new Date().toISOString(); const { data: jobs, error } = await admin.from('publish_jobs').select('*').eq('user_id',task.user_id).eq('status','queued').or('scheduled_at.is.null,scheduled_at.lte.'+now).order('scheduled_at',{ascending:true}).limit(Number(config.limit||5)); if(error) throw new Error(error.message); result=await publishJobs(admin,jobs||[]) }
  else if (task.task_type==='sync_metrics') result={ skipped:true, reason:'平台数据同步接口尚未接入' }
    else if (task.task_type==='radar_fetch') {
  const { fetchDouyinRadar } = await import('./radar.mjs')
  result = await fetchDouyinRadar(config)
}
else if (task.task_type==='radar_analyze') {
  const { analyzeRadar } = await import('./trend-engine.mjs')
  result = await analyzeRadar({ ...config, userId: task.user_id })
}
else if (task.task_type==='radar_category') {
  const { runCategoryRadar } = await import('./category-trend-engine.mjs')
  result = await runCategoryRadar({ ...config, userId: task.user_id })
}
  else result={ skipped:true }
  const next = nextRun(task.cron_expression)
  await admin.from('scheduled_tasks').update({ last_run_at:new Date().toISOString(), next_run_at:next, last_status:'success', last_error:null, run_count:(task.run_count||0)+1 }).eq('id',task.id)
  await log(task.user_id,'success',`自动任务完成：${task.name}`,{task_id:task.id,task_type:task.task_type,result,next_run_at:next})
  return result
}

export async function runAutomation({ userId=null, force=false }={}) {
  let q=admin.from('scheduled_tasks').select('*').eq('enabled',true)
  if (userId) q=q.eq('user_id',userId)
  const {data:tasks,error}=await q
  if(error) throw new Error(error.message)
  const now=new Date()
  const due=(tasks||[]).filter(t=>force || !t.next_run_at || new Date(t.next_run_at)<=now)
  const results=[]
  for(const task of due){
    try{ results.push({task:task.name,ok:true,result:await executeTask(task)}) }
    catch(e){
      const next=(()=>{try{return nextRun(task.cron_expression)}catch{return new Date(Date.now()+3600000).toISOString()}})()
      await admin.from('scheduled_tasks').update({last_run_at:new Date().toISOString(),next_run_at:next,last_status:'error',last_error:e.message,run_count:(task.run_count||0)+1}).eq('id',task.id)
      await log(task.user_id,'error',`自动任务失败：${task.name}`,{task_id:task.id,error:e.message})
      results.push({task:task.name,ok:false,error:e.message})
    }
  }
  return {checked:(tasks||[]).length,due:due.length,results}
}

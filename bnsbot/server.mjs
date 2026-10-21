import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(process.cwd(), 'bnsbot')))

const PORT = Number(process.env.PORT || 10000)
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'bnsbot', 'data')
const DB_FILE = path.join(DATA_DIR, 'store.json')
const ADMIN_PASSWORD = process.env.BNS_ADMIN_PASSWORD || 'change-me'
const SQUARE_KEY = process.env.BNS_SQUARE_OPENAPI_KEY || ''
const AI_BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const AI_API_KEY = process.env.AI_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'
const CRON_SECRET = process.env.BNS_CRON_SECRET || ''
const DAILY_LIMIT = Math.max(1, Number(process.env.BNS_DAILY_LIMIT || 20))
const PORTFOLIO = [
  { symbol:'BTC', price:104320, change:2.84 }, { symbol:'ETH', price:3834, change:1.72 },
  { symbol:'BNB', price:1114, change:3.41 }, { symbol:'SOL', price:187.2, change:-0.62 }
]

let store
async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive:true })
  try { store = JSON.parse(await fs.readFile(DB_FILE, 'utf8')) }
  catch { store = { accounts:[{ id:'default', name:'主广场账号', keyConfigured:Boolean(SQUARE_KEY), status:SQUARE_KEY?'connected':'not_configured' }], posts:[], sources:[], templates:[], materials:[], settings:{ dailyLimit:DAILY_LIMIT, autoEnabled:Boolean(SQUARE_KEY), intervalMinutes:30 }, logs:[] }; await save() }
}
async function save(){ await fs.writeFile(DB_FILE, JSON.stringify(store, null, 2)) }
function id(){ return crypto.randomUUID() }
function now(){ return new Date().toISOString() }
function maskKey(key){ return key ? `${key.slice(0,5)}...${key.slice(-4)}` : '' }
function auth(req,res,next){ const token=req.headers.authorization?.replace(/^Bearer\s+/i,''); if(token!==process.env.BNS_SESSION_TOKEN) return res.status(401).json({error:'未登录'}); next() }
function cronAuth(req,res,next){ if(!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) return res.status(401).json({error:'cron unauthorized'}); next() }

app.get('/api/health', (_,res)=>res.json({ok:true, app:'Bnsbot v8'}))
app.post('/api/login', (req,res)=>{ if(String(req.body?.password||'')!==ADMIN_PASSWORD) return res.status(401).json({error:'密码错误'}); res.json({token:process.env.BNS_SESSION_TOKEN}) })
app.get('/api/state', auth, async (_,res)=>{ res.json({settings:store.settings, accounts:store.accounts.map(a=>({...a,key:undefined})), posts:store.posts.slice(0,200), sources:store.sources.slice(0,80), templates:store.templates, materials:store.materials, logs:store.logs.slice(0,100), market:PORTFOLIO}) })

app.post('/api/accounts', auth, async (req,res)=>{
  const name=String(req.body?.name||'主广场账号').trim().slice(0,80); const key=String(req.body?.key||'').trim()
  if(!key) return res.status(400).json({error:'请输入 Square OpenAPI Key'})
  store.accounts.push({id:id(),name,keyConfigured:true,status:'connected',maskedKey:maskKey(key),createdAt:now()})
  store.settings.activeAccountId=store.accounts.at(-1).id
  store.logs.unshift({id:id(),level:'info',message:`已添加账号 ${name}，密钥已掩码保存于当前服务器配置。`,createdAt:now()})
  await save(); res.json({ok:true, account:store.accounts.at(-1)})
})

app.post('/api/posts', auth, async (req,res)=>{
  const content=String(req.body?.content||'').trim(); if(!content) return res.status(400).json({error:'内容不能为空'})
  const row={id:id(),content,status:'pending',scheduledAt:req.body?.scheduledAt||null,source:req.body?.source||'manual',createdAt:now(),publishedAt:null,squarePostId:null,squarePostUrl:null,error:null}
  store.posts.push(row); await save(); res.status(201).json(row)
})
app.patch('/api/posts/:id', auth, async (req,res)=>{ const p=store.posts.find(x=>x.id===req.params.id); if(!p) return res.status(404).json({error:'帖子不存在'}); if(req.body.content!==undefined)p.content=String(req.body.content).trim(); if(req.body.scheduledAt!==undefined)p.scheduledAt=req.body.scheduledAt||null; await save(); res.json(p) })
app.delete('/api/posts/:id', auth, async (req,res)=>{ store.posts=store.posts.filter(x=>x.id!==req.params.id); await save(); res.json({ok:true}) })

async function squarePost(content, key=SQUARE_KEY){
  if(!key) throw new Error('未配置 BNS_SQUARE_OPENAPI_KEY')
  const r=await fetch('https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add',{method:'POST',headers:{'X-Square-OpenAPI-Key':key,'Content-Type':'application/json','clienttype':'binanceSkill'},body:JSON.stringify({bodyTextOnly:content})})
  const data=await r.json().catch(()=>({}))
  if(!r.ok || data.code!=='000000') throw new Error(data.message || `Binance 返回 ${data.code||r.status}`)
  const postId=data.data?.id; return {id:postId,url:postId?`https://www.binance.com/square/post/${postId}`:null,raw:data}
}

async function publishOne(post){
  const account=store.accounts.find(a=>a.id===store.settings.activeAccountId)||store.accounts[0]
  try { const result=await squarePost(post.content, SQUARE_KEY); post.status='published'; post.publishedAt=now(); post.squarePostId=result.id; post.squarePostUrl=result.url; post.error=null; store.logs.unshift({id:id(),level:'success',message:`发布成功：${post.content.slice(0,50)}`,createdAt:now(),url:result.url}); return result }
  catch(e){ post.status='failed'; post.error=e.message; store.logs.unshift({id:id(),level:'error',message:`发布失败：${e.message}`,createdAt:now()}); throw e }
  finally { await save() }
}

app.post('/api/posts/:id/publish', auth, async (req,res)=>{ const p=store.posts.find(x=>x.id===req.params.id); if(!p)return res.status(404).json({error:'帖子不存在'}); try{const result=await publishOne(p);res.json({ok:true,result,post:p})}catch(e){res.status(502).json({error:e.message,post:p})} })
app.post('/api/cron/publish', cronAuth, async (_,res)=>{
  const start=Date.now(); const today=new Date().toISOString().slice(0,10); const count=store.posts.filter(p=>p.status==='published'&&String(p.publishedAt||'').startsWith(today)).length
  if(count>=Number(store.settings.dailyLimit||DAILY_LIMIT)) return res.json({ok:true,skipped:'daily_limit',count})
  const due=store.posts.filter(p=>p.status==='pending'&&(!p.scheduledAt||new Date(p.scheduledAt)<=new Date())).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))[0]
  if(!due)return res.json({ok:true,skipped:'no_due_post'})
  try{const result=await publishOne(due);res.json({ok:true,postId:due.id,result,elapsedMs:Date.now()-start})}catch(e){res.status(502).json({ok:false,error:e.message,postId:due.id})}
})

app.put('/api/settings', auth, async (req,res)=>{ store.settings={...store.settings,dailyLimit:Math.max(1,Math.min(100,Number(req.body?.dailyLimit||DAILY_LIMIT))),autoEnabled:Boolean(req.body?.autoEnabled),intervalMinutes:Math.max(5,Number(req.body?.intervalMinutes||30))}; await save(); res.json(store.settings) })

app.post('/api/ai/draft', auth, async (req,res)=>{
  const topic=String(req.body?.topic||'').trim(); if(!topic)return res.status(400).json({error:'请输入主题'})
  if(!AI_API_KEY)return res.json({title:`${topic}：今天市场值得关注的 3 个信号`,content:`${topic}\n\n① 先看价格变化与成交量\n② 再看资金和市场情绪\n③ 最后确认是否有新的基本面催化\n\n以上仅作信息整理，不构成投资建议。 #Crypto #Binance`,model:'demo'})
  const r=await fetch(`${AI_BASE_URL}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${AI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:AI_MODEL,messages:[{role:'system',content:'你是币安广场内容编辑。写中文、短句、信息密度高，不夸大、不承诺收益，不凭空编造事实。保留必要的$币种格式。输出 JSON：title,content。'},{role:'user',content:`根据主题生成一条适合 Binance Square 的帖子：${topic}`}],temperature:0.7,response_format:{type:'json_object'}})})
  const j=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:j.error?.message||'AI 请求失败'}); let out; try{out=JSON.parse(j.choices?.[0]?.message?.content||'{}')}catch{out={content:j.choices?.[0]?.message?.content||''}}; res.json({...out,model:AI_MODEL})
})

app.post('/api/sources/refresh', auth, async (_,res)=>{
  const demo=[
    {title:'Binance 公告：最新产品与市场动态',type:'announcement',source:'Binance Newsroom',createdAt:now(),url:'https://www.binance.com/en/press'},
    {title:'BTC 24h 价格与成交量出现明显变化',type:'market',source:'Binance Market Data',createdAt:now(),symbol:'BTC'},
    {title:'ETH 市场波动率升高，关注关键价位',type:'market',source:'Binance Market Data',createdAt:now(),symbol:'ETH'}
  ]
  store.sources=[...demo,...store.sources].slice(0,100); await save(); res.json({ok:true,count:demo.length,sources:demo})
})

app.post('/api/templates', auth, async (req,res)=>{ const t={id:id(),name:String(req.body?.name||'未命名模板').slice(0,80),content:String(req.body?.content||'').slice(0,4000),createdAt:now()}; store.templates.unshift(t); await save(); res.status(201).json(t) })
app.post('/api/materials', auth, async (req,res)=>{ const m={id:id(),name:String(req.body?.name||'未命名素材').slice(0,120),url:String(req.body?.url||''),type:String(req.body?.type||'link'),createdAt:now()}; store.materials.unshift(m); await save(); res.status(201).json(m) })

app.get('*', (_,res)=>res.sendFile(path.join(process.cwd(),'bnsbot','index.html')))
await ensureStore()
app.listen(PORT,()=>console.log(`Bnsbot v8 listening on ${PORT}`))

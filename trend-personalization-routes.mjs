import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { getTrendDashboard, trendConfig } from './trend-radar.mjs'

const URL=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase=URL&&KEY?createClient(URL,KEY):null
const originalGet=express.application.get
const STOP=new Set('这个 那个 这些 那些 一个 一种 可以 但是 因为 所以 以及 以及 现在 还是 不是 就是 如果 他们 我们 你们 自己 什么 怎么 为什么 今天 昨天 明天 视频 内容 作品 抖音 账号'.split(/\s+/))

function grams(text){
  const s=String(text||'').toLowerCase().replace(/[^\u4e00-\u9fff\w]+/g,' ')
  const words=s.split(/\s+/).filter(Boolean)
  const out=new Set(words.filter(x=>x.length>=2&&!STOP.has(x)))
  for(const w of words){if(w.length<3)continue;for(let n=2;n<=Math.min(4,w.length);n++)for(let i=0;i<=w.length-n;i++){const g=w.slice(i,i+n);if(!STOP.has(g))out.add(g)}}
  return out
}
function scoreWork(w){
  const likes=Number(w.metrics?.likes||0),comments=Number(w.metrics?.comments||0),shares=Number(w.metrics?.shares||0),favorites=Number(w.metrics?.favorites||0)
  return Math.log10(1+likes)+Math.log10(1+comments)*1.3+Math.log10(1+shares)*1.6+Math.log10(1+favorites)*1.2
}
function buildProfile(items){
  const works=items.filter(x=>x.kind==='account_work').sort((a,b)=>scoreWork(b)-scoreWork(a)).slice(0,100)
  const weights=new Map(); let total=0
  for(const w of works){const weight=scoreWork(w);total+=weight;for(const g of grams(`${w.title||''} ${w.raw?.content||''}`)){weights.set(g,(weights.get(g)||0)+weight)}}
  const top=[...weights.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20)
  return {sample_size:works.length,keywords:top.map(([k,v])=>({keyword:k,weight:Number((v/Math.max(total,1)).toFixed(4))}))}
}
function fitEvent(e,profile,rules){
  const text=`${e.title||''} ${(e.items||[]).slice(0,8).map(x=>x.title||x.raw?.content||'').join(' ')}`
  const tokens=grams(text), hits=[]
  for(const x of profile.keywords){if(tokens.has(x.keyword))hits.push(x)}
  const keywordFit=Math.min(100,hits.reduce((s,x)=>s+x.weight*100,0)*2.8)
  const activeRules=rules.filter(r=>r.platform==='douyin')
  let ruleFit=0
  const reasons=[]
  for(const r of activeRules){
    if(r.rule_type==='utility'){ruleFit+=8;reasons.push('实用/可收藏结构')}
    if(r.rule_type==='hook'){ruleFit+=6;reasons.push('强化前2秒 Hook')}
    if(r.rule_type==='engagement'){ruleFit+=5;reasons.push('强互动 CTA')}
    if(r.rule_type==='growth'){ruleFit+=4;reasons.push('延续增长方向')}
  }
  const fit=Math.round(Math.min(100,keywordFit+ruleFit))
  if(hits.length)reasons.unshift(`命中账号高表现主题：${hits.slice(0,3).map(x=>x.keyword).join('、')}`)
  return {fit,reasons:[...new Set(reasons)].slice(0,4),matched_keywords:hits.slice(0,5).map(x=>x.keyword)}
}

async function handler(req,res,next){
  if(!supabase)return next()
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'').trim()
  if(!token)return next()
  const client=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}})
  const {data,error}=await client.auth.getUser()
  if(error||!data?.user)return next()
  try{
    const limit=Math.min(100,Math.max(1,Number(req.query.limit||80)))
    const dataSet=await getTrendDashboard(client,data.user.id,limit)
    const workQ=await client.from('trend_items').select('kind,title,metrics,raw').eq('user_id',data.user.id).eq('platform','douyin').eq('kind','account_work').order('observed_at',{ascending:false}).limit(300)
    const rulesQ=await client.from('video_strategy_rules').select('platform,rule_type,title,recommendation,confidence').eq('user_id',data.user.id).eq('active',true).limit(30)
    const profile=buildProfile(workQ.data||[]),rules=rulesQ.data||[]
    const maxHot=Math.max(...dataSet.map(x=>Number(x.hot_score||0)),1)
    const ranked=dataSet.map((e,index)=>{const base=Math.round((Number(e.hot_score||0)/maxHot)*100);const f=fitEvent(e,profile,rules);const recency=Math.max(0,100-index*3);const personalized=Math.round(base*.62+f.fit*.28+recency*.10);return {...e,content_score:personalized,base_hot_score:base,personal_fit_score:f.fit,fit_reasons:f.reasons,matched_keywords:f.matched_keywords}}).sort((a,b)=>b.content_score-a.content_score)
    res.json({data:ranked,config:trendConfig(),profile:{sample_size:profile.sample_size,keywords:profile.keywords.slice(0,10)},personalized:true})
  }catch(e){res.status(500).json({error:e.message})}
}

express.application.get=function(path,...args){
  if(path==='/api/trends'){
    const app=this
    originalGet.call(app,path,handler)
  }
  return originalGet.call(this,path,...args)
}

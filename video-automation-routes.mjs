import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { getTrendDashboard } from './trend-radar.mjs'

const URL=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase=URL&&KEY?createClient(URL,KEY):null
let installed=false
const bad=(res,s,e)=>res.status(s).json({error:e})
async function auth(req,res,next){
  const t=req.headers.authorization?.replace(/^Bearer\s+/i,'').trim()
  if(!t||!supabase)return bad(res,401,'未登录或服务器未配置 Supabase')
  const c=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${t}`}}})
  const {data,error}=await c.auth.getUser()
  if(error||!data?.user)return bad(res,401,'登录状态已失效')
  req.autoDb=c;req.autoUser=data.user;next()
}
function install(app){if(installed)return;installed=true
  app.post('/api/video/automation/queue',auth,async(req,res)=>{
    try{
      const limit=Math.min(5,Math.max(1,Number(req.body?.limit||3)))
      const trends=await getTrendDashboard(req.autoDb,req.autoUser.id,80)
      const ranked=[...trends].sort((a,b)=>Number(b.content_score??b.hot_score??0)-Number(a.content_score??a.hot_score??0))
      const picked=[]
      for(const e of ranked){
        if(picked.length>=limit)break
        if(!e?.id||!e?.title)continue
        const exists=await req.autoDb.from('video_projects').select('id,status').eq('user_id',req.autoUser.id).eq('event_id',e.id).in('status',['queued','draft','scripted','ready','rendering','published']).limit(1)
        if(exists.data?.length)continue
        picked.push(e)
      }
      if(!picked.length)return res.json({data:[],created:0,message:'没有新的高价值热点进入队列'})
      const rows=picked.map((e,i)=>({user_id:req.autoUser.id,event_id:e.id,title:`${e.title} · 自动选题`,platform:'douyin',status:'queued',hook:'',duration:45,cta:'评论区告诉我你的看法。',verdict:`自动选题：机会分 ${Number(e.content_score??e.hot_score??0)}；${(e.fit_reasons||[]).join('、')}`,structure:'Hook → 冲突/问题 → 证据 → 解释 → 结论 → CTA',script:{auto_queue:true,queue_rank:i+1,content_score:e.content_score??null,personal_fit_score:e.personal_fit_score??null,fit_reasons:e.fit_reasons||[],matched_keywords:e.matched_keywords||[]},director_notes:{auto_queue:true,source_event_id:e.id}}))
      const ins=await req.autoDb.from('video_projects').insert(rows).select('*')
      if(ins.error)return bad(res,500,ins.error.message)
      res.json({data:ins.data||[],created:ins.data?.length||0})
    }catch(e){bad(res,500,e.message)}
  })
  app.get('/api/video/automation/queue',auth,async(req,res)=>{
    const q=await req.autoDb.from('video_projects').select('*').eq('user_id',req.autoUser.id).eq('status','queued').order('updated_at',{ascending:false}).limit(20)
    if(q.error)return bad(res,500,q.error.message)
    res.json({data:q.data||[]})
  })
}
const originalGet=express.application.get
express.application.get=function(path,...args){if(path==='*'||path==='/*'||path==='/')install(this);return originalGet.call(this,path,...args)}

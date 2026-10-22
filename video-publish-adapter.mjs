import express from 'express'
import { createClient } from '@supabase/supabase-js'

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
  req.publishDb=c;req.publishUser=data.user;next()
}
async function own(req,id){return req.publishDb.from('video_projects').select('*').eq('id',id).eq('user_id',req.publishUser.id).single()}
function install(app){if(installed)return;installed=true
 app.get('/api/video/projects/:id/publish/status',auth,async(req,res)=>{const p=await own(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');const meta=p.data.publish_meta&&typeof p.data.publish_meta==='object'?p.data.publish_meta:{};res.json({data:{id:p.data.id,status:p.data.status,platform:p.data.platform,external_work_id:p.data.external_work_id||null,external_url:p.data.external_url||null,publish_meta:meta,publish_ready:['ready','published'].includes(p.data.status)}})})
 app.post('/api/video/projects/:id/publish/queue',auth,async(req,res)=>{const p=await own(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');if(!['ready','draft','scripted','asset_ready'].includes(p.data.status))return bad(res,409,'当前项目状态不允许进入发布队列');const old=p.data.publish_meta&&typeof p.data.publish_meta==='object'?p.data.publish_meta:{};const body=req.body||{};const meta={...old,provider:String(body.provider||old.provider||p.data.platform||'manual'),queued_at:new Date().toISOString(),publish_options:body.options||old.publish_options||{}};const u=await req.publishDb.from('video_projects').update({status:'ready',publish_meta:meta,updated_at:new Date().toISOString()}).eq('id',p.data.id).eq('user_id',req.publishUser.id).select().single();if(u.error)return bad(res,500,u.error.message);res.json({data:u.data,queued:true,adapter:meta.provider})})
 app.post('/api/video/projects/:id/publish/mark-failed',auth,async(req,res)=>{const p=await own(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');const old=p.data.publish_meta&&typeof p.data.publish_meta==='object'?p.data.publish_meta:{};const meta={...old,publish_error:String(req.body?.error||'发布失败').slice(0,1000),publish_failed_at:new Date().toISOString()};const u=await req.publishDb.from('video_projects').update({status:'failed',publish_meta:meta,updated_at:new Date().toISOString()}).eq('id',p.data.id).eq('user_id',req.publishUser.id);if(u.error)return bad(res,500,u.error.message);res.json({failed:true})})
}
const originalGet=express.application.get
express.application.get=function(path,...args){if(path==='*'||path==='/*'||path==='/')install(this);return originalGet.call(this,path,...args)}

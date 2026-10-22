import express from 'express'
import { createClient } from '@supabase/supabase-js'

const URL=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase=URL&&KEY?createClient(URL,KEY):null
let installed=false
const bad=(res,status,error)=>res.status(status).json({error})
async function auth(req,res,next){
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'').trim()
  if(!token||!supabase)return bad(res,401,'未登录或服务器未配置 Supabase')
  const client=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}})
  const {data,error}=await client.auth.getUser()
  if(error||!data?.user)return bad(res,401,'登录状态已失效')
  req.publishDb=client;req.publishUser=data.user;next()
}
function install(app){
  if(installed)return
  installed=true
  app.post('/api/video/projects/:id/publish/attach',auth,async(req,res)=>{
    const id=req.params.id
    const p=await req.publishDb.from('video_projects').select('*').eq('id',id).eq('user_id',req.publishUser.id).single()
    if(p.error)return bad(res,404,'视频项目不存在')
    const b=req.body||{}
    const workId=String(b.work_id||'').trim()
    const workUrl=String(b.work_url||'').trim()
    if(!workId&&!workUrl)return bad(res,400,'至少提供作品 ID 或作品链接')
    const old=p.data.publish_meta&&typeof p.data.publish_meta==='object'?p.data.publish_meta:{}
    const publishMeta={...old,platform:p.data.platform||'douyin',accountId:b.account_id||old.accountId||null,authorUrl:b.author_url||old.authorUrl||null,secUserId:b.sec_user_id||old.secUserId||null,attachedAt:new Date().toISOString()}
    const u=await req.publishDb.from('video_projects').update({status:'published',external_work_id:workId||p.data.external_work_id||null,external_url:workUrl||p.data.external_url||null,publish_meta:publishMeta,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',req.publishUser.id).select().single()
    if(u.error)return bad(res,500,u.error.message)
    res.json({data:u.data,feedback_ready:true})
  })
}
const originalGet=express.application.get
express.application.get=function(path,...args){if(path==='*'||path==='/*'||path==='/')install(this);return originalGet.call(this,path,...args)}

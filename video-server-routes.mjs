import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { createRenderJob, renderConfig, getRenderJob } from './video-renderer.mjs'

const URL=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const TTS_BASE=(process.env.TTS_BASE_URL||'').replace(/\/$/,'')
const TTS_KEY=process.env.TTS_API_KEY||''
const TTS_PATH=process.env.TTS_PATH||'/tts'
const supabase=URL&&KEY?createClient(URL,KEY):null
let installed=false
const bad=(res,status,error)=>res.status(status).json({error})
async function auth(req,res,next){
  const token=req.headers.authorization?.replace(/^Bearer\s+/i,'').trim()
  if(!token||!supabase)return bad(res,401,'未登录或服务器未配置 Supabase')
  const client=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}})
  const {data,error}=await client.auth.getUser()
  if(error||!data?.user)return bad(res,401,'登录状态已失效')
  req.videoDb=client;req.videoUser=data.user;next()
}
function db(req){return req.videoDb}
function install(app){
  if(installed)return
  installed=true
  app.get('/api/video/config',auth,async(req,res)=>res.json({tts:{enabled:Boolean(TTS_BASE),path:TTS_PATH},render:renderConfig()}))
  app.get('/api/video/projects/:id',auth,async(req,res)=>{
    const p=await db(req).from('video_projects').select('*').eq('id',req.params.id).eq('user_id',req.videoUser.id).single()
    if(p.error)return bad(res,404,'视频项目不存在')
    const [s,a,r]=await Promise.all([
      db(req).from('video_scenes').select('*').eq('project_id',req.params.id).order('scene_no'),
      db(req).from('video_assets').select('*').eq('project_id',req.params.id).order('created_at',{ascending:false}),
      db(req).from('video_renders').select('*').eq('project_id',req.params.id).order('created_at',{ascending:false}).limit(10)
    ])
    res.json({project:p.data,scenes:s.data||[],assets:a.data||[],renders:r.data||[]})
  })
  app.post('/api/video/projects/:id/assets',auth,async(req,res)=>{
    const p=await db(req).from('video_projects').select('id').eq('id',req.params.id).eq('user_id',req.videoUser.id).single()
    if(p.error)return bad(res,404,'视频项目不存在')
    const b=req.body||{};if(!b.source_url)return bad(res,400,'素材 URL 不能为空')
    const q=await db(req).from('video_assets').insert({project_id:req.params.id,scene_id:b.scene_id||null,provider:String(b.provider||'manual'),kind:String(b.kind||'image'),source_url:String(b.source_url).slice(0,4000),title:String(b.title||'').slice(0,300),license_note:String(b.license_note||'').slice(0,500),metadata:b.metadata||{}}).select().single()
    if(q.error)return bad(res,500,q.error.message);res.status(201).json({data:q.data})
  })
  app.post('/api/video/projects/:id/tts',auth,async(req,res)=>{
    if(!TTS_BASE)return bad(res,503,'未配置 TTS_BASE_URL')
    const p=await db(req).from('video_projects').select('id').eq('id',req.params.id).eq('user_id',req.videoUser.id).single();if(p.error)return bad(res,404,'视频项目不存在')
    const b=req.body||{},text=String(b.text||'').trim();if(!text)return bad(res,400,'TTS 文本不能为空')
    const r=await fetch(`${TTS_BASE}${TTS_PATH}`,{method:'POST',headers:{'Content-Type':'application/json',...(TTS_KEY?{Authorization:`Bearer ${TTS_KEY}`}:{})},body:JSON.stringify({text,voice:b.voice||process.env.TTS_VOICE||'zh-CN',speed:Number(b.speed||1),format:b.format||'mp3'}),signal:AbortSignal.timeout(60000)})
    const data=await r.json().catch(()=>({}));if(!r.ok)return bad(res,502,data.error||`TTS 服务 HTTP ${r.status}`);res.json({data})
  })
  app.post('/api/video/projects/:id/render',auth,async(req,res)=>{
    const p=await db(req).from('video_projects').select('*').eq('id',req.params.id).eq('user_id',req.videoUser.id).single();if(p.error)return bad(res,404,'视频项目不存在')
    const s=await db(req).from('video_scenes').select('*').eq('project_id',req.params.id).order('scene_no');if(s.error)return bad(res,500,s.error.message)
    try{
      const job=await createRenderJob(p.data,{scenes:s.data||[],settings:req.body?.settings||{}})
      const row=await db(req).from('video_renders').insert({project_id:req.params.id,provider:job.provider||'http',status:job.status||'queued',output_url:job.output_url||job.url||null,error:job.error||null,settings:req.body?.settings||{},finished_at:job.status==='completed'?new Date().toISOString():null}).select().single()
      if(row.error)return bad(res,500,row.error.message)
      await db(req).from('video_projects').update({status:job.status==='completed'?'ready':'rendering',updated_at:new Date().toISOString()}).eq('id',req.params.id)
      res.json({data:row.data,provider_job_id:job.job_id||job.id||null})
    }catch(e){return bad(res,502,e.message)}
  })
  app.post('/api/video/renders/:id/sync',auth,async(req,res)=>{
    const q=await db(req).from('video_renders').select('*,video_projects!inner(user_id)').eq('id',req.params.id).eq('video_projects.user_id',req.videoUser.id).single();if(q.error)return bad(res,404,'渲染任务不存在')
    const jobId=req.body?.provider_job_id;if(!jobId)return bad(res,400,'缺少 provider_job_id')
    try{const data=await getRenderJob(jobId);if(!data)return bad(res,400,'当前渲染器不支持查询');const status=data.status||'rendering';const u=data.output_url||data.url||null;const upd=await db(req).from('video_renders').update({status,output_url:u,error:data.error||null,finished_at:['completed','failed'].includes(status)?new Date().toISOString():null}).eq('id',req.params.id).select().single();if(upd.error)return bad(res,500,upd.error.message);res.json({data:upd.data})}catch(e){return bad(res,502,e.message)}
  })
}
const originalGet=express.application.get
express.application.get=function(path,...args){if(path==='*'||path==='/*'||path==='/'){install(this)}return originalGet.call(this,path,...args)}

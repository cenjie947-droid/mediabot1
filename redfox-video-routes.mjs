import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { searchRedFoxAssets, redfoxConfig } from './redfox-video-assets.mjs'
const URL=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL
const KEY=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase=URL&&KEY?createClient(URL,KEY):null
let installed=false
const bad=(res,s,e)=>res.status(s).json({error:e})
async function auth(req,res,next){const t=req.headers.authorization?.replace(/^Bearer\s+/i,'').trim();if(!t||!supabase)return bad(res,401,'未登录或服务器未配置 Supabase');const c=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${t}`}}});const {data,error}=await c.auth.getUser();if(error||!data?.user)return bad(res,401,'登录状态已失效');req.rfDb=c;req.rfUser=data.user;next()}
async function own(req,id){return req.rfDb.from('video_projects').select('id').eq('id',id).eq('user_id',req.rfUser.id).single()}
function install(app){if(installed)return;installed=true
 app.get('/api/video/redfox/config',auth,(req,res)=>res.json(redfoxConfig()))
 app.post('/api/video/projects/:id/assets/search',auth,async(req,res)=>{const p=await own(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');const q=String(req.body?.query||'').trim();if(!q)return bad(res,400,'素材搜索词不能为空');try{res.json({data:await searchRedFoxAssets({query:q,type:req.body?.type||'video',limit:req.body?.limit||8,source:req.body?.source||'douyin'})})}catch(e){bad(res,502,e.message)}})
 app.post('/api/video/projects/:id/scenes/:sceneId/asset',auth,async(req,res)=>{const p=await own(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');const b=req.body||{};if(!b.source_url)return bad(res,400,'素材 URL 不能为空');const a=await req.rfDb.from('video_assets').insert({project_id:req.params.id,scene_id:req.params.sceneId,provider:b.provider||'redfox',kind:b.kind||'video',source_url:String(b.source_url).slice(0,4000),title:String(b.title||'').slice(0,300),license_note:String(b.license_note||'').slice(0,500),status:'selected',metadata:b.metadata||{}}).select().single();if(a.error)return bad(res,500,a.error.message);const s=await req.rfDb.from('video_scenes').update({asset_url:b.source_url,status:'asset_ready',updated_at:new Date().toISOString()}).eq('id',req.params.sceneId).eq('project_id',req.params.id).select().single();if(s.error)return bad(res,500,s.error.message);res.json({asset:a.data,scene:s.data})})
}
const originalGet=express.application.get
express.application.get=function(path,...args){if(path==='*'||path==='/*'||path==='/')install(this);return originalGet.call(this,path,...args)}

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
  req.strategyDb=c;req.strategyUser=data.user;next()
}
async function project(req,id){return req.strategyDb.from('video_projects').select('*').eq('id',id).eq('user_id',req.strategyUser.id).single()}
export function derive(rows){
  const ordered=[...rows].sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at))
  const latest=ordered.at(-1),prev=ordered.at(-2)
  if(!latest)return []
  const out=[]
  const views=Math.max(0,Number(latest.views||0)),likes=Number(latest.likes||0),comments=Number(latest.comments||0),shares=Number(latest.shares||0),favorites=Number(latest.favorites||0)
  const er=views?((likes+comments+shares+favorites)/views)*100:0
  if(er>=8)out.push({rule_type:'engagement',title:'互动率表现强',insight:`最近快照互动率约 ${er.toFixed(1)}%。`,recommendation:'下一条保留强观点或明确冲突，并在结尾加入低门槛互动 CTA。',confidence:Math.min(0.98,0.55+er/20),evidence:{views,likes,comments,shares,favorites,engagement_rate:er}})
  if(views>=10000&&er<3)out.push({rule_type:'hook',title:'有曝光但互动偏弱',insight:`播放 ${views.toLocaleString()}，但互动率约 ${er.toFixed(1)}%。`,recommendation:'优先重做前 2 秒 Hook 与利益点，不要只继续堆信息量。',confidence:0.82,evidence:{views,engagement_rate:er}})
  if(prev){const pv=Math.max(0,Number(prev.views||0));const growth=pv?((views-pv)/pv)*100:0;if(growth>=30)out.push({rule_type:'growth',title:'近期增长明显',insight:`相对上一条快照播放变化 ${growth.toFixed(0)}%。`,recommendation:'保留当前选题方向与节奏，下一条只改一个变量做 A/B 测试。',confidence:0.86,evidence:{previous_views:pv,latest_views:views,growth_pct:growth}})}
  if(shares+favorites>likes&&views>0)out.push({rule_type:'utility',title:'收藏/分享信号突出',insight:'收藏与分享合计高于点赞，内容存在较强的实用或转发价值。',recommendation:'下一条增加清单、步骤、数据或可保存的信息结构。',confidence:0.8,evidence:{likes,shares,favorites}})
  return out
}
export async function refreshRules(db,userId,platform='douyin',projectId=null){
  let q=db.from('video_performance_snapshots').select('*').eq('user_id',userId).eq('platform',platform).order('recorded_at',{ascending:true}).limit(100)
  if(projectId)q=q.eq('project_id',projectId)
  const snap=await q
  if(snap.error)throw new Error(snap.error.message)
  const rules=derive(snap.data||[])
  const deact=await db.from('video_strategy_rules').update({active:false,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('platform',platform)
  if(deact.error)throw new Error(deact.error.message)
  if(rules.length){const rows=rules.map(r=>({...r,user_id:userId,platform,scope:'account'}));const ins=await db.from('video_strategy_rules').insert(rows);if(ins.error)throw new Error(ins.error.message)}
  return rules
}
function install(app){if(installed)return;installed=true
 app.get('/api/video/projects/:id/strategy',auth,async(req,res)=>{const p=await project(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');const q=await req.strategyDb.from('video_performance_snapshots').select('*').eq('project_id',req.params.id).order('recorded_at',{ascending:true}).limit(50);if(q.error)return bad(res,500,q.error.message);const rules=derive(q.data||[]);res.json({data:rules,latest:(q.data||[]).at(-1)||null,previous:(q.data||[]).at(-2)||null})})
 app.post('/api/video/projects/:id/strategy/refresh',auth,async(req,res)=>{const p=await project(req,req.params.id);if(p.error)return bad(res,404,'视频项目不存在');try{const rules=await refreshRules(req.strategyDb,req.strategyUser.id,p.data.platform||'douyin',req.params.id);res.json({data:rules,refreshed_at:new Date().toISOString()})}catch(e){return bad(res,500,e.message)}})
 app.get('/api/video/strategy',auth,async(req,res)=>{const q=await req.strategyDb.from('video_strategy_rules').select('*').eq('user_id',req.strategyUser.id).eq('active',true).order('updated_at',{ascending:false}).limit(30);if(q.error)return bad(res,500,q.error.message);res.json({data:q.data||[]})})
}
const originalGet=express.application.get
express.application.get=function(path,...args){if(path==='*'||path==='/*'||path==='/')install(this);return originalGet.call(this,path,...args)}

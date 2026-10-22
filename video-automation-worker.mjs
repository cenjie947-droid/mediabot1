import { createClient } from '@supabase/supabase-js'
import { createRenderJob } from './video-renderer.mjs'

const URL=process.env.SUPABASE_URL
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
const AI_BASE=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')
const AI_KEY=process.env.AI_API_KEY||''
const AI_MODEL=process.env.AI_MODEL||'gpt-4o-mini'
const TTS_BASE=(process.env.TTS_BASE_URL||'').replace(/\/$/,'')
const TTS_KEY=process.env.TTS_API_KEY||''
const TTS_PATH=process.env.TTS_PATH||'/tts'
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false} }):null

const limit=Math.min(3,Math.max(1,Number(process.env.VIDEO_AUTOMATION_BATCH||2)))
const now=()=>new Date().toISOString()
const log=(...x)=>console.log('[video-automation]',...x)

function parseJson(text){
  const raw=String(text||'').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim()
  try{return JSON.parse(raw)}catch{}
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}')
  if(start>=0&&end>start)try{return JSON.parse(raw.slice(start,end+1))}catch{}
  return null
}

async function ai(topic,meta={}){
  if(!AI_KEY)throw new Error('未配置 AI_API_KEY')
  const prompt=`热点：${topic}\n机会分：${meta.content_score??''}\n账号匹配：${meta.personal_fit_score??''}\n匹配理由：${(meta.fit_reasons||[]).join('、')}\n历史高表现关键词：${(meta.matched_keywords||[]).join('、')}\n\n请作为短视频导演，输出合法 JSON，不要 Markdown。设计 30-60 秒、6-10 镜头的原创抖音视频。不要复述或复制任何参考作品，只提炼可迁移的结构。JSON 字段：title,hook,duration,cta,structure,verdict,scenes。scenes 每项包含 duration,visual,voiceover,text,asset_hint。前2秒必须有明确冲突、结论或利益点。` 
  const r=await fetch(`${AI_BASE}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${AI_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:AI_MODEL,messages:[{role:'system',content:'你是专业短视频导演。只输出合法 JSON。'},{role:'user',content:prompt}],temperature:.7}),signal:AbortSignal.timeout(90000)})
  const j=await r.json().catch(()=>({}))
  if(!r.ok)throw new Error(j.error?.message||`AI HTTP ${r.status}`)
  const out=parseJson(j.choices?.[0]?.message?.content)
  if(!out||!Array.isArray(out.scenes)||!out.scenes.length)throw new Error('AI 未返回有效镜头脚本')
  return out
}

async function tts(text){
  if(!TTS_BASE)return null
  const r=await fetch(`${TTS_BASE}${TTS_PATH}`,{method:'POST',headers:{'Content-Type':'application/json',...(TTS_KEY?{Authorization:`Bearer ${TTS_KEY}`}:{})},body:JSON.stringify({text,voice:process.env.TTS_VOICE||'zh-CN',speed:1,format:'mp3'}),signal:AbortSignal.timeout(60000)})
  const j=await r.json().catch(()=>({}))
  if(!r.ok)throw new Error(j.error||j.message||`TTS HTTP ${r.status}`)
  return j.audio_url||j.audioUrl||j.output_url||j.url||j.data?.audio_url||j.data?.audioUrl||j.data?.output_url||j.data?.url||null
}

async function claim(p){
  const q=await db.from('video_projects').update({status:'directing',updated_at:now(),director_notes:{...(p.director_notes||{}),automation:{started_at:now(),worker:'video-automation-worker'}}}).eq('id',p.id).eq('status','queued').select('*').single()
  return q.data||null
}

async function processProject(p){
  const meta=p.script&&typeof p.script==='object'?p.script:{}
  const directed=await ai(p.title?.replace(/\s*·\s*自动选题$/,'')||'热门话题',meta)
  const scenes=(directed.scenes||[]).slice(0,10).map((s,i)=>({project_id:p.id,scene_no:i+1,duration:Math.max(1,Math.min(20,Number(s.duration||5))),visual:String(s.visual||'竖屏动态画面').slice(0,2000),voiceover:String(s.voiceover||'').slice(0,4000),onscreen_text:String(s.text||s.onscreen_text||'').slice(0,500),asset_hint:String(s.asset_hint||'').slice(0,500),status:'scripted'}))
  if(!scenes.length)throw new Error('没有生成镜头')
  await db.from('video_scenes').delete().eq('project_id',p.id)
  const ins=await db.from('video_scenes').insert(scenes).select('*')
  if(ins.error)throw new Error(ins.error.message)
  const nextProject={title:String(directed.title||p.title).slice(0,200),hook:String(directed.hook||'').slice(0,1000),duration:Number(directed.duration||45),cta:String(directed.cta||p.cta||'').slice(0,500),verdict:String(directed.verdict||'').slice(0,2000),structure:String(directed.structure||'').slice(0,2000),script:{...(meta||{}),director_generated:true,generated_at:now(),scenes_count:scenes.length}}
  const up=await db.from('video_projects').update({...nextProject,status:'scripted',updated_at:now()}).eq('id',p.id)
  if(up.error)throw new Error(up.error.message)

  let ttsReady=0,ttsFailed=0
  for(const s of ins.data||[]){
    if(!s.voiceover){continue}
    try{const url=await tts(s.voiceover);if(url){await db.from('video_scenes').update({tts_audio_url:url,status:'vo_ready',updated_at:now()}).eq('id',s.id);ttsReady++}else{ttsFailed++}}catch(e){ttsFailed++;log('TTS failed',p.id,s.scene_no,e.message)}
  }
  await db.from('video_projects').update({status:'asset_ready',updated_at:now(),director_notes:{...(p.director_notes||{}),automation:{...(p.director_notes?.automation||{}),directed_at:now(),tts_ready:ttsReady,tts_failed:ttsFailed}}}).eq('id',p.id)

  const fresh=(await db.from('video_scenes').select('*').eq('project_id',p.id).order('scene_no')).data||[]
  const render=await createRenderJob({...p,...nextProject,id:p.id},{scenes:fresh,settings:{preset:process.env.VIDEO_PRESET||'veryfast',crf:Number(process.env.VIDEO_CRF||22)}})
  const row=await db.from('video_renders').insert({project_id:p.id,provider:render.provider||'local',status:render.status||'queued',output_url:render.output_url||render.url||null,error:render.error||null,settings:{automation:true}}).select().single()
  if(row.error)throw new Error(row.error.message)
  await db.from('video_projects').update({status:render.status==='completed'?'ready':'rendering',updated_at:now()}).eq('id',p.id)
  return {id:p.id,scenes:scenes.length,ttsReady,ttsFailed,render:row.data}
}

async function main(){
  if(!db)throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY')
  const q=await db.from('video_projects').select('*').eq('status','queued').order('updated_at',{ascending:true}).limit(limit)
  if(q.error)throw new Error(q.error.message)
  if(!q.data?.length){log('no queued projects');return}
  for(const p of q.data){
    const claimed=await claim(p)
    if(!claimed){log('skip already claimed',p.id);continue}
    try{const out=await processProject(claimed);log('completed',JSON.stringify(out))}
    catch(e){await db.from('video_projects').update({status:'failed',updated_at:now(),director_notes:{...(claimed.director_notes||{}),automation:{...(claimed.director_notes?.automation||{}),failed_at:now(),error:String(e.message||e).slice(0,1000)}}}).eq('id',claimed.id);log('failed',claimed.id,e.message)}
  }
}

main().catch(e=>{console.error(e);process.exitCode=1})

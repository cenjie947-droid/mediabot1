import { createClient } from '@supabase/supabase-js'
import { promises as fs } from 'node:fs'
import { renderProject } from './ffmpeg-video-renderer.mjs'

const url=process.env.SUPABASE_URL
const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY required')
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const BUCKET=process.env.VIDEO_STORAGE_BUCKET||'video-renders'
const TTS_BASE=(process.env.TTS_BASE_URL||'').replace(/\/$/,'')
const TTS_KEY=process.env.TTS_API_KEY||''
const TTS_PATH=process.env.TTS_PATH||'/tts'

async function ensureBucket(){
  const {error}=await admin.storage.createBucket(BUCKET,{public:true,fileSizeLimit:100*1024*1024,allowedMimeTypes:['video/mp4']})
  if(error && !/already exists|duplicate/i.test(error.message||'')) console.warn('storage bucket:',error.message)
}
function audioUrl(data){return data?.audio_url||data?.audioUrl||data?.output_url||data?.url||data?.data?.audio_url||data?.data?.audioUrl||data?.data?.output_url||data?.data?.url||null}
async function synthesizeScene(scene){
  if(!TTS_BASE||scene.tts_audio_url||!String(scene.voiceover||'').trim()) return scene
  const r=await fetch(`${TTS_BASE}${TTS_PATH}`,{method:'POST',headers:{'Content-Type':'application/json',...(TTS_KEY?{Authorization:`Bearer ${TTS_KEY}`}:{})},body:JSON.stringify({text:String(scene.voiceover).trim(),voice:process.env.TTS_VOICE||'zh-CN',speed:Number(process.env.TTS_SPEED||1),format:'mp3'}),signal:AbortSignal.timeout(60000)})
  const data=await r.json().catch(()=>({}))
  if(!r.ok) throw new Error(data.error||`TTS 服务 HTTP ${r.status}`)
  const u=audioUrl(data);if(!u)throw new Error('TTS 服务未返回音频 URL')
  await admin.from('video_scenes').update({tts_audio_url:u,status:'vo_ready',updated_at:new Date().toISOString()}).eq('id',scene.id)
  return {...scene,tts_audio_url:u,status:'vo_ready'}
}
async function claim(row){
  const {data,error}=await admin.from('video_renders').update({status:'rendering',error:null}).eq('id',row.id).eq('status','queued').select('id,project_id').maybeSingle()
  if(error)throw error
  return data||null
}
async function processOne(row){
  const claimed=await claim(row);if(!claimed)return false
  const startedAt=Date.now()
  let result=null
  try{
    const {data:project,error:pe}=await admin.from('video_projects').select('*').eq('id',claimed.project_id).single();if(pe)throw pe
    const {data:rawScenes,error:se}=await admin.from('video_scenes').select('*').eq('project_id',claimed.project_id).order('scene_no');if(se)throw se
    if(!rawScenes?.length)throw new Error('项目没有场景，无法渲染')
    const scenes=[]
    for(const scene of rawScenes) scenes.push(await synthesizeScene(scene))
    result=await renderProject({project,scenes})
    const bytes=await fs.readFile(result.output)
    const objectPath=`${project.user_id}/${project.id}/${claimed.id}.mp4`
    const up=await admin.storage.from(BUCKET).upload(objectPath,bytes,{contentType:'video/mp4',upsert:true,cacheControl:'31536000'})
    if(up.error)throw up.error
    const publicUrl=admin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl
    const {error:re}=await admin.from('video_renders').update({status:'completed',output_url:publicUrl,error:null,finished_at:new Date().toISOString()}).eq('id',claimed.id);if(re)throw re
    await admin.from('video_projects').update({status:'ready',updated_at:new Date().toISOString()}).eq('id',project.id)
    console.log(`video render completed ${claimed.id} in ${Math.round((Date.now()-startedAt)/1000)}s: ${publicUrl}`)
    return true
  }catch(e){
    const message=String(e?.message||e).slice(0,4000)
    console.error(`video render failed ${claimed.id}:`,message)
    await admin.from('video_renders').update({status:'failed',error:message,finished_at:new Date().toISOString()}).eq('id',claimed.id)
    await admin.from('video_projects').update({status:'draft',updated_at:new Date().toISOString()}).eq('id',claimed.project_id)
    return false
  }finally{
    if(result?.workDir)await fs.rm(result.workDir,{recursive:true,force:true}).catch(()=>{})
  }
}

await ensureBucket()
const {data:jobs,error}=await admin.from('video_renders').select('id,project_id').eq('status','queued').order('created_at',{ascending:true}).limit(Number(process.env.VIDEO_RENDER_BATCH||2))
if(error) throw error
let completed=0
for(const job of jobs||[]) if(await processOne(job)) completed++
console.log(`video worker processed ${jobs?.length||0} queued renders; completed ${completed}`)

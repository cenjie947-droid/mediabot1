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
  const {error}=await admin.storage.createBucket(BUCKET,{public:true,fileSizeLimit:50*1024*1024,allowedMimeTypes:['video/mp4']})
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
async function processOne(row){
  await admin.from('video_renders').update({status:'rendering',error:null}).eq('id',row.id)
  const {data:project,error:pe}=await admin.from('video_projects').select('*').eq('id',row.project_id).single();if(pe)throw pe
  const {data:rawScenes,error:se}=await admin.from('video_scenes').select('*').eq('project_id',row.project_id).order('scene_no');if(se)throw se
  const scenes=[]
  for(const scene of rawScenes||[]) scenes.push(await synthesizeScene(scene))
  const result=await renderProject({project,scenes})
  const bytes=await fs.readFile(result.output)
  const objectPath=`${project.user_id}/${project.id}/${row.id}.mp4`
  const up=await admin.storage.from(BUCKET).upload(objectPath,bytes,{contentType:'video/mp4',upsert:true,cacheControl:'31536000'})
  if(up.error)throw up.error
  const publicUrl=admin.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl
  await admin.from('video_renders').update({status:'completed',output_url:publicUrl,error:null,finished_at:new Date().toISOString()}).eq('id',row.id)
  await admin.from('video_projects').update({status:'ready',updated_at:new Date().toISOString()}).eq('id',project.id)
  await fs.rm(result.workDir,{recursive:true,force:true})
  console.log(`video render completed ${row.id}: ${publicUrl}`)
}

await ensureBucket()
const {data:jobs,error}=await admin.from('video_renders').select('id,project_id').eq('status','queued').order('created_at',{ascending:true}).limit(Number(process.env.VIDEO_RENDER_BATCH||2))
if(error) throw error
for(const job of jobs||[]){try{await processOne(job)}catch(e){console.error(`video render failed ${job.id}:`,e);await admin.from('video_renders').update({status:'failed',error:String(e.message||e).slice(0,2000),finished_at:new Date().toISOString()}).eq('id',job.id);await admin.from('video_projects').update({status:'draft',updated_at:new Date().toISOString()}).eq('id',job.project_id)}}
console.log(`video worker processed ${jobs?.length||0} queued renders`)

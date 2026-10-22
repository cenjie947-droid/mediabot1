import { createClient } from '@supabase/supabase-js'

const URL=process.env.SUPABASE_URL
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null
const RETRIES=Math.min(3,Math.max(1,Number(process.env.VIDEO_AUTOMATION_MAX_RETRIES||2)))
const now=()=>new Date().toISOString()
const log=(...x)=>console.log('[video-recovery]',...x)

async function main(){
  if(!db)throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY')
  const {data:projects,error}=await db.from('video_projects').select('id,status,script,director_notes,updated_at').in('status',['failed','draft']).order('updated_at',{ascending:true}).limit(20)
  if(error)throw error
  let recovered=0
  for(const p of projects||[]){
    const notes=p.director_notes&&typeof p.director_notes==='object'?p.director_notes:{}
    const a=notes.automation&&typeof notes.automation==='object'?notes.automation:{}
    const attempts=Number(a.recovery_attempts||0)
    if(attempts>=RETRIES)continue
    const errorText=String(a.error||'').toLowerCase()
    const retryable=!errorText||/timeout|timed out|http 429|http 5\d\d|network|fetch|下载|素材|tts|ai|渲染|render|连接|未返回/.test(errorText)
    if(!retryable)continue
    const {data:scenes}=await db.from('video_scenes').select('id,asset_url,tts_audio_url,voiceover,visual,asset_hint').eq('project_id',p.id)
    const hasScenes=Array.isArray(scenes)&&scenes.length>0
    const nextStatus=hasScenes?'asset_ready':'queued'
    const nextNotes={...notes,automation:{...a,recovery_attempts:attempts+1,last_recovery_at:now(),recovery_reason:errorText||'自动恢复'}}
    const q=await db.from('video_projects').update({status:nextStatus,director_notes:nextNotes,updated_at:now()}).eq('id',p.id).in('status',['failed','draft'])
    if(q.error){log('recovery update failed',p.id,q.error.message);continue}
    if(hasScenes){
      for(const s of scenes){
        if(!s.asset_url&&s.asset_hint)await db.from('video_scenes').update({status:'todo',updated_at:now()}).eq('id',s.id)
        else if(s.tts_audio_url)await db.from('video_scenes').update({status:'vo_ready',updated_at:now()}).eq('id',s.id)
      }
    }
    recovered++;log('recovered',p.id,nextStatus,attempts+1)
  }
  log(`scanned ${projects?.length||0}, recovered ${recovered}`)
}
main().catch(e=>{console.error(e);process.exitCode=1})

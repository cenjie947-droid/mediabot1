import { createClient } from '@supabase/supabase-js'

const URL=process.env.SUPABASE_URL
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null
const RETRIES=Math.min(3,Math.max(1,Number(process.env.VIDEO_AUTOMATION_MAX_RETRIES||2)))
const now=()=>new Date().toISOString()
const log=(...x)=>console.log('[video-recovery]',...x)

function isAutomationProject(p){
  const notes=p.director_notes&&typeof p.director_notes==='object'?p.director_notes:{}
  const a=notes.automation&&typeof notes.automation==='object'?notes.automation:{}
  return Boolean(a.worker==='video-automation-worker'||a.automation===true||p.status==='failed'&&a.started_at)
}
function isRetryable(errorText){
  if(!errorText)return false
  return /timeout|timed out|http 429|http 5\\d\\d|network|fetch|下载|素材|tts|ai|渲染|render|连接|未返回|temporar|econn/i.test(errorText)
}

async function main(){
  if(!db)throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY')
  // Never turn ordinary user drafts into automated jobs. Only recover projects
  // explicitly marked by the automation worker, and only when there is a
  // recorded retryable failure or a failed status with a known automation run.
  const {data:projects,error}=await db.from('video_projects')
    .select('id,status,script,director_notes,updated_at,retry_count')
    .in('status',['failed','draft'])
    .order('updated_at',{ascending:true})
    .limit(50)
  if(error)throw error
  let recovered=0
  for(const p of projects||[]){
    if(!isAutomationProject(p))continue
    const notes=p.director_notes&&typeof p.director_notes==='object'?p.director_notes:{}
    const a=notes.automation&&typeof notes.automation==='object'?notes.automation:{}
    const attempts=Math.max(Number(a.recovery_attempts||0),Number(p.retry_count||0))
    if(attempts>=RETRIES)continue
    const errorText=String(a.error||a.last_error||notes.error||'').toLowerCase()
    if(!isRetryable(errorText))continue

    const {data:scenes,error:sceneError}=await db.from('video_scenes')
      .select('id,asset_url,tts_audio_url,asset_hint')
      .eq('project_id',p.id)
    if(sceneError){log('scene query failed',p.id,sceneError.message);continue}
    const hasScenes=Array.isArray(scenes)&&scenes.length>0
    const nextStatus=hasScenes?'asset_ready':'queued'
    const nextNotes={...notes,automation:{
      ...a,
      recovery_attempts:attempts+1,
      last_recovery_at:now(),
      recovery_reason:errorText
    }}
    const q=await db.from('video_projects')
      .update({status:nextStatus,retry_count:attempts+1,director_notes:nextNotes,updated_at:now()})
      .eq('id',p.id).eq('status',p.status).select('id').maybeSingle()
    if(q.error){log('recovery update failed',p.id,q.error.message);continue}
    if(!q.data)continue

    if(hasScenes){
      for(const s of scenes){
        if(!s.asset_url&&s.asset_hint){
          await db.from('video_scenes').update({status:'todo',updated_at:now()}).eq('id',s.id)
        }else if(s.tts_audio_url){
          await db.from('video_scenes').update({status:'vo_ready',updated_at:now()}).eq('id',s.id)
        }
      }
    }
    recovered++
    log('recovered',p.id,nextStatus,attempts+1)
  }
  log(`scanned ${projects?.length||0}, recovered ${recovered}`)
}
main().catch(e=>{console.error(e);process.exitCode=1})

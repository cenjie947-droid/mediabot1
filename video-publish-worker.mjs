import { createClient } from '@supabase/supabase-js'

const URL=process.env.SUPABASE_URL
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
if(!URL||!KEY) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const BATCH=Math.max(1,Math.min(20,Number(process.env.VIDEO_PUBLISH_BATCH||5)))
const MAX_ATTEMPTS=Math.max(1,Math.min(10,Number(process.env.VIDEO_PUBLISH_MAX_ATTEMPTS||3)))
const TIMEOUT=Math.max(1000,Number(process.env.VIDEO_PUBLISH_TIMEOUT_MS||30000))
const now=()=>new Date().toISOString()
const log=(...args)=>console.log('[video-publish-worker]',...args)

function metaOf(p){return p.publish_meta&&typeof p.publish_meta==='object'?p.publish_meta:{}}
function providerOf(p){return String(p.publish_provider||metaOf(p).provider||'manual').toLowerCase()}
function adapterUrl(provider){
  if(provider==='bridge')return process.env.VIDEO_PUBLISH_BRIDGE_URL||''
  if(provider==='custom')return process.env.VIDEO_PUBLISH_CUSTOM_URL||''
  return ''
}
function retryable(message){return /timeout|timed out|429|http 5\d\d|network|fetch|econn|temporar|rate.?limit/i.test(String(message))}
function manifest(p){
  const m=metaOf(p)
  return {
    project_id:p.id, platform:p.platform||'douyin', provider:providerOf(p),
    idempotency_key:`video-project:${p.id}`,
    title:p.title||'', hook:p.hook||'', cta:p.cta||'',
    duration:p.duration||null,
    script:p.script||{}, structure:p.structure||'',
    render_url:m.render_url||m.output_url||p.renders?.[0]?.output_url||null,
    options:m.publish_options||{},
    external_work_id:p.external_work_id||null,
    external_url:p.external_url||null
  }
}
async function update(p,fields){
  const {error}=await db.from('video_projects').update({...fields,updated_at:now()}).eq('id',p.id).eq('user_id',p.user_id)
  if(error)throw error
}
async function process(p){
  const m=metaOf(p),provider=providerOf(p),attempts=Number(p.publish_attempts||0),payload=manifest(p)
  const renderQuery=await db.from('video_renders').select('output_url,status').eq('project_id',p.id).eq('status','completed').order('finished_at',{ascending:false}).limit(1).maybeSingle()
  if(renderQuery.error)throw renderQuery.error
  payload.render_url=payload.render_url||renderQuery.data?.output_url||null
  if(!payload.render_url){
    await update(p,{publish_queued_at:null,publish_meta:{...m,publish_status:'blocked_no_render',publish_error:'没有找到已完成的视频渲染文件，未提交发布'}})
    return 'blocked-no-render'
  }
  if(p.external_work_id||p.external_url){
    await update(p,{publish_queued_at:null,publish_meta:{...m,publish_status:'published',last_checked_at:now()}})
    return 'already-published'
  }
  if(provider==='manual'||provider==='external'){
    await update(p,{publish_queued_at:null,publish_meta:{...m,publish_status:'awaiting_external_publish',manifest:payload,awaiting_since:m.awaiting_since||now(),last_attempt_at:now()}})
    return 'awaiting-external-publish'
  }
  if(attempts>=MAX_ATTEMPTS){
    await update(p,{status:'failed',publish_queued_at:null,publish_meta:{...m,publish_status:'failed',publish_error:'达到最大自动发布尝试次数'}})
    return 'max-attempts'
  }
  const url=adapterUrl(provider)
  if(!url){
    await update(p,{publish_queued_at:null,publish_meta:{...m,publish_status:'configuration_required',publish_error:`缺少 VIDEO_PUBLISH_${provider.toUpperCase()}_URL；未尝试发布`}})
    return 'adapter-not-configured'
  }
  try{
    const headers={'content-type':'application/json','idempotency-key':payload.idempotency_key}
    if(process.env.VIDEO_PUBLISH_SHARED_SECRET)headers['x-publish-secret']=process.env.VIDEO_PUBLISH_SHARED_SECRET
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(TIMEOUT)})
    const body=await response.text()
    let result={};try{result=JSON.parse(body)}catch{}
    if(!response.ok||result.error)throw new Error(result.error||`adapter HTTP ${response.status}`)
    const workId=result.external_work_id||result.work_id||result.workId||null
    const workUrl=result.external_url||result.work_url||result.workUrl||result.url||null
    const published=Boolean(workId||workUrl)
    const nextMeta={...m,publish_status:published?'published':(result.status||'awaiting_external_publish'),last_attempt_at:now(),adapter_response:result}
    await update(p,{status:published?'published':'ready',external_work_id:workId,external_url:workUrl,publish_attempts:attempts+1,publish_queued_at:null,publish_meta:nextMeta})
    return published?'published':'adapter-accepted-no-work-reference'
  }catch(e){
    const message=String(e?.message||e).slice(0,1000),nextAttempts=attempts+1,canRetry=retryable(message)&&nextAttempts<MAX_ATTEMPTS
    await update(p,{status:canRetry?'ready':'failed',publish_attempts:nextAttempts,publish_queued_at:canRetry?now():null,publish_meta:{...m,publish_status:canRetry?'retry_scheduled':'failed',publish_error:message,last_attempt_at:now(),next_retry_at:canRetry?new Date(Date.now()+Math.min(15,2**nextAttempts)*60000).toISOString():null}})
    if(canRetry) {
      const {error}=await db.from('video_projects').update({publish_queued_at:new Date(Date.now()+Math.min(15,2**nextAttempts)*60000).toISOString()}).eq('id',p.id).eq('user_id',p.user_id)
      if(error)throw error
    }
    log('adapter failed',p.id,message)
    return canRetry?'retry-scheduled':'failed'
  }
}
async function main(){
 const {data:rows,error}=await db.from('video_projects').select('id,user_id,status,platform,title,hook,cta,duration,script,structure,publish_provider,publish_queued_at,publish_attempts,publish_meta,external_work_id,external_url').eq('status','ready').not('publish_queued_at','is',null).lte('publish_queued_at',now()).order('publish_queued_at',{ascending:true}).limit(BATCH)
 if(error)throw error
 const counts={}
 for(const p of rows||[]){try{const result=await process(p);counts[result]=(counts[result]||0)+1}catch(e){log('project error',p.id,e.message);counts.error=(counts.error||0)+1}}
 log(JSON.stringify({scanned:rows?.length||0,counts}))
}
main().catch(e=>{console.error(e);process.exitCode=1})

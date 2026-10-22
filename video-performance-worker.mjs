import { createClient } from '@supabase/supabase-js'
import { findRedFoxDouyinWork } from './redfox-video-assets.mjs'
import { refreshRules } from './video-strategy-routes.mjs'

const URL=process.env.SUPABASE_URL
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null
const limit=Math.min(50,Math.max(1,Number(process.env.VIDEO_PERFORMANCE_BATCH||20)))
const now=()=>new Date().toISOString()
const log=(...x)=>console.log('[video-performance]',...x)

async function main(){
  if(!db)throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY')
  const q=await db.from('video_projects').select('id,user_id,platform,status,external_work_id,external_url,publish_meta').eq('platform','douyin').eq('status','published').not('external_work_id','is',null).order('updated_at',{ascending:true}).limit(limit)
  if(q.error)throw q.error
  let synced=0,failed=0
  for(const p of q.data||[]){
    try{
      const meta=p.publish_meta&&typeof p.publish_meta==='object'?p.publish_meta:{}
      const work=await findRedFoxDouyinWork({workId:p.external_work_id,accountId:meta.accountId,authorUrl:meta.authorUrl,secUserId:meta.secUserId})
      if(!work){failed++;log('work not found',p.id,p.external_work_id);continue}
      const row={project_id:p.id,work_id:String(work.workId||p.external_work_id),platform:'douyin',captured_at:now(),views:Number(work.playCount||work.play_count||work.viewCount||work.view_count||0),likes:Number(work.likeCount||work.like_count||0),comments:Number(work.commentCount||work.comment_count||0),shares:Number(work.shareCount||work.share_count||0),favorites:Number(work.collectCount||work.collect_count||0),raw:work}
      const ins=await db.from('video_performance_snapshots').insert(row)
      if(ins.error)throw ins.error
      await db.from('video_projects').update({publish_meta:{...meta,last_synced_at:now(),last_metrics:row},updated_at:now()}).eq('id',p.id)
      synced++
      try{await refreshRules({db,userId:p.user_id,platform:'douyin'})}catch(e){log('strategy refresh skipped',p.id,e.message)}
    }catch(e){failed++;log('sync failed',p.id,e.message)}
  }
  log(`processed ${q.data?.length||0}, synced ${synced}, failed ${failed}`)
}
main().catch(e=>{console.error(e);process.exitCode=1})

import { createClient } from '@supabase/supabase-js'
import { findRedFoxDouyinWork } from './redfox-video-assets.mjs'
import { refreshRules } from './video-strategy-routes.mjs'

const URL=process.env.SUPABASE_URL
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
const db=URL&&KEY?createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null
const limit=Math.min(50,Math.max(1,Number(process.env.VIDEO_PERFORMANCE_BATCH||20)))
const now=()=>new Date().toISOString()
const log=(...x)=>console.log('[video-performance]',...x)

function metrics(x,fallbackId){return {external_work_id:String(x.workId||x.work_id||x.aweme_id||fallbackId),views:Number(x.viewCount||x.view_count||x.playCount||x.play_count||0),likes:Number(x.likeCount||x.like_count||x.diggCount||x.digg_count||0),comments:Number(x.commentCount||x.comment_count||0),shares:Number(x.shareCount||x.share_count||0),favorites:Number(x.collectCount||x.collect_count||0),reposts:Number(x.repostCount||x.repost_count||x.forwardCount||x.forward_count||0),follower_count:Number(x.followerCount||x.follower_count||0),popularity_score:x.popularityScore==null?null:Number(x.popularityScore)}}

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
      const m=metrics(work,p.external_work_id)
      const row={user_id:p.user_id,project_id:p.id,platform:'douyin',external_work_id:m.external_work_id,views:m.views,likes:m.likes,comments:m.comments,shares:m.shares,favorites:m.favorites,reposts:m.reposts,follower_count:m.follower_count,popularity_score:m.popularity_score,raw:work,recorded_at:now()}
      const ins=await db.from('video_performance_snapshots').insert(row)
      if(ins.error)throw ins.error
      await db.from('video_projects').update({external_work_id:m.external_work_id,external_url:work.workUrl||work.work_url||p.external_url||null,publish_meta:{...meta,last_synced_at:now(),last_metrics:m},updated_at:now()}).eq('id',p.id)
      synced++
      try{await refreshRules(db,p.user_id,p.platform||'douyin',p.id)}catch(e){log('strategy refresh skipped',p.id,e.message)}
    }catch(e){failed++;log('sync failed',p.id,e.message)}
  }
  log(`processed ${q.data?.length||0}, synced ${synced}, failed ${failed}`)
}
main().catch(e=>{console.error(e);process.exitCode=1})

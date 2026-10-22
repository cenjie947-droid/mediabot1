import { createClient } from '@supabase/supabase-js'
import { publishPost } from './server.mjs'
import { syncRedfoxTrends } from './trend-radar.mjs'

const url=process.env.SUPABASE_URL
const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY required')
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const now=new Date().toISOString()
const {data:tasks,error}=await admin.from('publish_tasks').select('id,user_id,post_id').eq('status','queued').lte('run_at',now).order('run_at',{ascending:true}).limit(20)
if(error) throw error
for(const task of tasks||[]){
  try{await admin.from('publish_tasks').update({status:'running',attempts:1}).eq('id',task.id);await publishPost(task.user_id,task.post_id,null)}catch(e){await admin.from('publish_tasks').update({status:'failed',last_error:e.message}).eq('id',task.id)}}

const syncMinutes=Number(process.env.TREND_SYNC_MINUTES||60)
const cutoff=new Date(Date.now()-syncMinutes*60*1000).toISOString()
const {data:accounts}=await admin.from('creator_accounts').select('user_id').limit(5000)
const users=[...new Set((accounts||[]).map(x=>x.user_id).filter(Boolean))]
for(const userId of users){
  const {data:recent}=await admin.from('trend_events').select('last_seen_at').eq('user_id',userId).order('last_seen_at',{ascending:false}).limit(1).maybeSingle()
  if(recent?.last_seen_at && recent.last_seen_at>cutoff) continue
  try{const result=await syncRedfoxTrends(admin,userId);console.log(`trend sync ${userId}:`,JSON.stringify(result))}catch(e){console.warn(`trend sync skipped for ${userId}: ${e.message}`)}
}
console.log(`processed ${tasks?.length||0} scheduled tasks and checked ${users.length} trend users`)

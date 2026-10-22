import { createClient } from '@supabase/supabase-js'
import { publishPost } from './server.mjs'

const url=process.env.SUPABASE_URL
const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY required')
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const now=new Date().toISOString()
const {data:tasks,error}=await admin.from('publish_tasks').select('id,user_id,post_id').eq('status','queued').lte('run_at',now).order('run_at',{ascending:true}).limit(20)
if(error) throw error
for(const task of tasks||[]){
  try{await admin.from('publish_tasks').update({status:'running',attempts:1}).eq('id',task.id);await publishPost(task.user_id,task.post_id,null)}catch(e){await admin.from('publish_tasks').update({status:'failed',last_error:e.message}).eq('id',task.id)}}
console.log(`processed ${tasks?.length||0} scheduled tasks`)

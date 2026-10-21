async function fetchMedia(admin, mediaUrls) {
  const path = Array.isArray(mediaUrls) ? mediaUrls[0] : null
  if (!path) throw new Error('抖音发布需要内容库先上传至少一个视频素材')
  const { data, error } = await admin.storage.from('publish-media').createSignedUrl(path, 300)
  if (error || !data?.signedUrl) throw new Error(`生成视频临时地址失败：${error?.message || 'unknown'}`)
  const r = await fetch(data.signedUrl)
  if (!r.ok) throw new Error(`读取视频素材失败：${r.status}`)
  return { blob: await r.blob(), type: r.headers.get('content-type') || 'video/mp4' }
}

async function douyinPublish(admin, job, account, content, secret) {
  if (!secret?.access_token) throw new Error('抖音账号缺少 access_token，请重新授权')
  const openId = account.external_account_id || secret.metadata?.open_id
  if (!openId) throw new Error('抖音账号缺少 open_id，请重新授权')
  const media = await fetchMedia(admin, content.media_urls)
  const form = new FormData()
  form.append('video', media.blob, `mediabot-${job.id}.mp4`)
  const uploadUrl = new URL('https://open.douyin.com/video/upload/')
  uploadUrl.searchParams.set('open_id', openId)
  const upload = await fetch(uploadUrl, { method:'POST', headers:{'access-token':secret.access_token}, body:form })
  const uploadRaw=await upload.text()
  if(!upload.ok) throw new Error(`抖音上传视频返回 ${upload.status}: ${uploadRaw.slice(0,500)}`)
  const up=JSON.parse(uploadRaw); const videoId=up.data?.video?.video_id
  if(Number(up.data?.error_code||up.extra?.error_code||0)!==0 || !videoId) throw new Error(up.data?.description||up.extra?.description||'抖音视频上传失败')

  const createUrl = new URL('https://open.douyin.com/video/create/')
  createUrl.searchParams.set('open_id', openId)
  const text = [content.title, content.body].filter(Boolean).join('\n\n').slice(0, 2000)
  const create=await fetch(createUrl,{method:'POST',headers:{'access-token':secret.access_token,'Content-Type':'application/json'},body:JSON.stringify({video_id:videoId,text})})
  const createRaw=await create.text()
  if(!create.ok) throw new Error(`抖音创建视频返回 ${create.status}: ${createRaw.slice(0,500)}`)
  const out=JSON.parse(createRaw)
  if(Number(out.data?.error_code||out.extra?.error_code||0)!==0) throw new Error(out.data?.description||out.extra?.description||'抖音发布失败')
  return {external_id:out.data?.item_id||videoId,raw:{upload:up,create:out}}
}

export async function publishJobs(admin,jobs){
  let published=0, failed=0, skipped=0, results=[]
  for(const job of jobs){
    try{
      // Only queued jobs may start. This prevents concurrent runs from re-sending
      // jobs that are already publishing or have reached a terminal state.
      const {data:claimed,error:claimError}=await admin.from('publish_jobs').update({status:'publishing',started_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','queued').select('id').maybeSingle()
      if(claimError) throw new Error('无法锁定发布任务：'+claimError.message)
      if(!claimed){skipped++;results.push({job:job.id,ok:false,skipped:true,reason:'任务已被处理或不再处于排队状态'});continue}
      const {data:account}=await admin.from('social_accounts').select('*').eq('id',job.social_account_id).single()
      const {data:content}=await admin.from('content_items').select('*').eq('id',job.content_id).single()
      const {data:secret}=await admin.schema('private').from('social_account_secrets').select('*').eq('social_account_id',job.social_account_id).single()
      if(!account||!content) throw new Error('账号或内容不存在')
      if(account.user_id!==job.user_id||content.user_id!==job.user_id) throw new Error('发布任务关联的账号或内容不属于该用户')
      if(account.status!=='connected') throw new Error('账号授权状态无效，请重新完成官方授权')
      if(content.platform&&content.platform!=='all'&&content.platform!==job.platform) throw new Error('内容目标平台与发布任务不一致')
      let out
      if(job.platform==='douyin') out=await douyinPublish(admin,job,account,content,secret)
      else throw new Error('小红书真实发布需要官方开放平台应用审核通过后启用；当前版本已预留安全适配器，不使用模拟发布')
      const now=new Date().toISOString()
      const {error:finishError}=await admin.from('publish_jobs').update({status:'published',published_at:now,external_id:out.external_id||null,metadata:out.raw||{},error_message:null,updated_at:now}).eq('id',job.id).eq('status','publishing')
      if(finishError) throw new Error('平台已返回成功，但任务状态更新失败；请核对平台记录，勿直接重试：'+finishError.message)
      const {error:contentError}=await admin.from('content_items').update({status:'published',published_at:now}).eq('id',job.content_id).eq('user_id',job.user_id)
      if(contentError) throw new Error('平台已返回成功，但内容状态更新失败；请核对平台记录：'+contentError.message)
      await admin.from('run_logs').insert({user_id:job.user_id,task_type:'publish',level:'success',message:`发布成功：${content.title}`,metadata:{job_id:job.id,platform:job.platform,external_id:out.external_id}})
      published++; results.push({job:job.id,ok:true,external_id:out.external_id})
    }catch(e){
      failed++
      const message=String(e?.message||e)
      await admin.from('publish_jobs').update({status:'failed',error_message:message,updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','publishing')
      await admin.from('run_logs').insert({user_id:job.user_id,task_type:'publish',level:'error',message:`发布失败：${message}`,metadata:{job_id:job.id,platform:job.platform}})
      results.push({job:job.id,ok:false,error:message})
    }
  }
  return {checked:jobs.length,published,failed,skipped,results}
}

const BASE=(process.env.REDFOX_BASE_URL||'https://redfox.hk').replace(/\/$/,'')
const KEY=process.env.REDFOX_API_KEY||''
function headers(){if(!KEY)throw new Error('未配置 REDFOX_API_KEY');return {'Content-Type':'application/json','REDFOX_API_KEY':KEY}}
export function redfoxConfig(){return {enabled:Boolean(KEY),baseUrl:BASE}}
async function post(path,payload){
  const r=await fetch(`${BASE}${path}`,{method:'POST',headers:headers(),body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)})
  const data=await r.json().catch(()=>({}))
  if(!r.ok||data?.code&&data.code!==2000)throw new Error(data?.msg||data?.message||data?.error||`RedFox HTTP ${r.status}`)
  return data
}
export async function searchRedFoxAssets({query,limit=8}={}){
  const path=process.env.REDFOX_ASSET_SEARCH_PATH||'/story/api/dyData/searchArticle'
  const data=await post(path,{keyword:String(query||'').slice(0,300),offset:0,sortType:'_4'})
  const raw=Array.isArray(data?.data?.list)?data.data.list:Array.isArray(data?.list)?data.list:[]
  return raw.slice(0,Math.min(Math.max(Number(limit)||8,1),20)).map((x,i)=>({
    provider:'redfox',kind:'video',source_url:x.videoUrl||x.video_url||x.workUrl||x.work_url||x.coverUrl||x.cover_url||null,
    title:x.title||x.desc||x.content||`抖音素材 ${i+1}`,
    license_note:'RedFox 检索结果：仅代表数据访问，不代表原视频的二次使用授权；发布前请确认授权范围。',metadata:x
  })).filter(x=>x.source_url)
}
export async function findRedFoxDouyinWork({accountId,authorUrl,secUserId,workId,maxPages=10}={}){
  if(!accountId&&!authorUrl&&!secUserId)throw new Error('缺少 Douyin 账号标识（accountId/authorUrl/secUserId）')
  if(!workId)throw new Error('缺少 Douyin workId')
  const path=process.env.REDFOX_DY_WORK_LIST_PATH||'/story/api/dyData/queryWorkList'
  const pages=Math.min(Math.max(Number(maxPages)||10,1),20)
  for(let page=0;page<pages;page++){
    const data=await post(path,{accountId,authorUrl,secUserId,offset:page*20,sortType:'_2'})
    const list=Array.isArray(data?.data?.list)?data.data.list:Array.isArray(data?.list)?data.list:[]
    const hit=list.find(x=>String(x.workId||x.work_id||'')===String(workId))
    if(hit)return hit
    if(data?.data?.hasMore===false||list.length<20)break
  }
  return null
}

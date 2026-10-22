const BASE=(process.env.REDFOX_BASE_URL||'https://redfox.hk').replace(/\/$/,'')
const KEY=process.env.REDFOX_API_KEY||''

function headers(){
  if(!KEY) throw new Error('未配置 REDFOX_API_KEY')
  return {'Content-Type':'application/json','REDFOX_API_KEY':KEY}
}

export function redfoxConfig(){return {enabled:Boolean(KEY),baseUrl:BASE}}

// Provider-neutral shape. RedFox endpoints can vary by enabled account/plan;
// keep endpoint configurable rather than leaking provider assumptions into the UI.
export async function searchRedFoxAssets({query,type='video',limit=8,source='douyin'}={}){
  const path=process.env.REDFOX_ASSET_SEARCH_PATH||'/story/api/search'
  const payload={query:String(query||'').slice(0,300),type,source,limit:Math.min(Math.max(Number(limit)||8,1),20)}
  const r=await fetch(`${BASE}${path}`,{method:'POST',headers:headers(),body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)})
  const data=await r.json().catch(()=>({}))
  if(!r.ok) throw new Error(data.message||data.error||`RedFox HTTP ${r.status}`)
  const list=Array.isArray(data?.data?.list)?data.data.list:Array.isArray(data?.data)?data.data:[]
  return list.map((x,i)=>({
    provider:'redfox',
    kind:x.kind||x.type||type,
    source_url:x.url||x.sourceUrl||x.videoUrl||x.coverUrl||x.cover_url||null,
    title:x.title||x.desc||x.content||`素材 ${i+1}`,
    license_note:x.licenseNote||'RedFox 数据源：使用前请确认原平台/素材授权与二次使用范围。',
    metadata:x
  })).filter(x=>x.source_url)
}

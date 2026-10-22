const RENDER_BASE_URL=(process.env.VIDEO_RENDER_BASE_URL||'').replace(/\/$/,'')
const RENDER_API_KEY=process.env.VIDEO_RENDER_API_KEY||''

function localRenderer(){return process.env.VIDEO_RENDERER==='local'}

export function renderConfig(){return {provider:localRenderer()?'local':(RENDER_BASE_URL?'http':'pending'),enabled:localRenderer()||Boolean(RENDER_BASE_URL)}}

export async function createRenderJob(project,{scenes=[],settings={}}={}){
  if(!localRenderer()&&!RENDER_BASE_URL) throw new Error('未配置视频渲染器。请设置 VIDEO_RENDER_BASE_URL/VIDEO_RENDER_API_KEY，或 VIDEO_RENDERER=local。')
  if(localRenderer()) return {provider:'local',status:'queued',projectId:project.id,settings}
  const r=await fetch(`${RENDER_BASE_URL}/render`,{method:'POST',headers:{'Content-Type':'application/json',...(RENDER_API_KEY?{Authorization:`Bearer ${RENDER_API_KEY}`}:{})},body:JSON.stringify({project,scenes,settings}),signal:AbortSignal.timeout(30000)})
  const raw=await r.text();let data={};try{data=JSON.parse(raw)}catch{}
  if(!r.ok)throw new Error(data.error||`渲染服务 HTTP ${r.status}`)
  return {provider:'http',...data}
}

export async function getRenderJob(providerJobId){
  if(!RENDER_BASE_URL) return null
  const r=await fetch(`${RENDER_BASE_URL}/render/${encodeURIComponent(providerJobId)}`,{headers:RENDER_API_KEY?{Authorization:`Bearer ${RENDER_API_KEY}`}:{},signal:AbortSignal.timeout(15000)})
  const data=await r.json().catch(()=>({}))
  if(!r.ok)throw new Error(data.error||`渲染服务 HTTP ${r.status}`)
  return data
}

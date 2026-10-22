import crypto from 'node:crypto'

const REDFOX_BASE_URL=(process.env.REDFOX_BASE_URL||'https://redfox.hk').replace(/\/$/,'')
const REDFOX_API_KEY=process.env.REDFOX_API_KEY||''

function endpointConfig(){
  try{return JSON.parse(process.env.REDFOX_TREND_ENDPOINTS_JSON||'{}')}catch(e){throw new Error('REDFOX_TREND_ENDPOINTS_JSON 不是合法 JSON')}
}
function hashKey(s){return crypto.createHash('sha1').update(String(s||'')).digest('hex').slice(0,20)}
function number(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return v;const s=String(v).replace(/,/g,'');const m=s.match(/^([\d.]+)\s*([万亿kw万亿])?$/i);if(!m)return Number(s)||0;const n=Number(m[1]);const u=m[2];return u==='亿'?n*1e8:u==='万'||u?.toLowerCase()==='w'?n*1e4:u?.toLowerCase()==='k'?n*1e3:n}
function findArray(value){if(Array.isArray(value))return value; if(!value||typeof value!=='object')return []; for(const key of ['list','items','records','rows','result','results','data','hotSearch','hotList']){const x=value[key];if(Array.isArray(x))return x;const nested=findArray(x);if(nested.length)return nested} return []}
function titleOf(x){return String(x.title??x.name??x.keyword??x.word??x.hotWord??x.text??x.desc??'').trim()}
function normalize(raw,platform,kind){
  const list=findArray(raw); const observedAt=new Date().toISOString();
  return list.map((x,i)=>{const title=titleOf(x);if(!title)return null;const metrics={views:number(x.views??x.playCount??x.play_count),likes:number(x.likes??x.likeCount??x.like_count),comments:number(x.comments??x.commentCount??x.comment_count),shares:number(x.shares??x.shareCount??x.share_count),favorites:number(x.favorites??x.collectCount??x.collect_count),heat:number(x.hot??x.hotScore??x.hot_score??x.score??x.index)};const rank=Number(x.rank??x.position??x.index??(i+1));return {platform,kind,external_id:String(x.id??x.awemeId??x.videoId??x.itemId??x.url??hashKey(title)),title,url:x.url??x.link??x.shareUrl??'',rank:Number.isFinite(rank)?rank:i+1,hot_score:metrics.heat||Math.max(0,10000-i*100),growth_score:number(x.growth??x.growthScore??x.increase??x.delta),metrics,raw:x,observed_at:observedAt}}).filter(Boolean)
}
async function callEndpoint(spec){
  const url=new URL(spec.url||'',REDFOX_BASE_URL).toString(); const headers={'Content-Type':'application/json','REDFOX_API_KEY':REDFOX_API_KEY};
  const init={method:String(spec.method||'POST').toUpperCase(),headers}; if(init.method==='GET'){if(spec.params)for(const [k,v] of Object.entries(spec.params))new URL(url).searchParams.set(k,v)}else init.body=JSON.stringify(spec.body||{});
  const r=await fetch(url,init); const text=await r.text(); let json;try{json=JSON.parse(text)}catch{throw new Error(`RedFox 返回非 JSON：HTTP ${r.status}`)} if(!r.ok||([401,403].includes(r.status)))throw new Error(json.msg||json.message||`RedFox 请求失败：HTTP ${r.status}`); if(json.code&&Number(json.code)!==2000)throw new Error(json.msg||json.message||`RedFox code ${json.code}`); return json
}
function configuredEndpoints(){const cfg=endpointConfig();const out=[];for(const [platform,groups] of Object.entries(cfg||{})){for(const [kind,spec] of Object.entries(groups||{})){if(spec?.url)out.push({platform,kind,...spec})}}return out}

export function trendConfig(){return {baseUrl:REDFOX_BASE_URL,hasApiKey:Boolean(REDFOX_API_KEY),endpoints:configuredEndpoints().map(x=>({platform:x.platform,kind:x.kind,url:x.url}))}}

export async function syncRedfoxTrends(db,userId){
  if(!REDFOX_API_KEY)throw new Error('未配置 REDFOX_API_KEY')
  const endpoints=configuredEndpoints(); if(!endpoints.length)throw new Error('未配置 REDFOX_TREND_ENDPOINTS_JSON；请把 RedFox 实际热榜接口映射到平台/类型后再同步')
  const summary=[];
  for(const spec of endpoints){
    const {data:source}=await db.from('trend_sources').insert({user_id:userId,provider:'redfox',platform:spec.platform,name:`RedFox ${spec.platform} ${spec.kind}`,enabled:true,config:{url:spec.url,kind:spec.kind},status:'ready'}).select('id').single();
    try{const raw=await callEndpoint(spec);const items=normalize(raw,spec.platform,spec.kind);if(items.length){const rows=items.map(x=>({...x,user_id:userId,source_id:source.id}));const {data,error}=await db.from('trend_items').insert(rows).select('*');if(error)throw error;for(const item of data||[]){const key=hashKey(item.title.toLowerCase().replace(/\s+/g,' '));const {data:event,error:eventError}=await db.from('trend_events').upsert({user_id:userId,canonical_key:key,title:item.title,hot_score:Number(item.hot_score||0),growth_score:Number(item.growth_score||0),platforms:[item.platform],last_seen_at:item.observed_at},{onConflict:'user_id,canonical_key'}).select('*').single();if(eventError)throw eventError;await db.from('trend_event_items').upsert({event_id:event.id,trend_item_id:item.id},{onConflict:'event_id,trend_item_id'})}await db.from('trend_sources').update({last_sync_at:new Date().toISOString(),status:'ready',last_error:null}).eq('id',source.id);summary.push({platform:spec.platform,kind:spec.kind,count:items.length})}else{summary.push({platform:spec.platform,kind:spec.kind,count:0})}}catch(error){await db.from('trend_sources').update({status:'error',last_error:error.message,last_sync_at:new Date().toISOString()}).eq('id',source.id);summary.push({platform:spec.platform,kind:spec.kind,error:error.message})}}
  return summary
}

export async function getTrendDashboard(db,userId,limit=80){
  const {data:events,error}=await db.from('trend_events').select('*').eq('user_id',userId).order('hot_score',{ascending:false}).order('last_seen_at',{ascending:false}).limit(limit);if(error)throw error
  const ids=(events||[]).map(x=>x.id);let evidence=[];if(ids.length){const q=await db.from('trend_event_items').select('event_id,trend_items(*)').in('event_id',ids);evidence=q.data||[]}
  const by=new Map();for(const row of evidence){const list=by.get(row.event_id)||[];if(row.trend_items)list.push(row.trend_items);by.set(row.event_id,list)}
  return (events||[]).map(e=>({...e,items:by.get(e.id)||[]}))
}

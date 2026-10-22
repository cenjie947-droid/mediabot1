import crypto from 'node:crypto'
import { syncDouyinRanks, douyinRankConfig } from './douyin-ranks.mjs'

const REDFOX_BASE_URL=(process.env.REDFOX_BASE_URL||'https://redfox.hk').replace(/\/$/,'')
const REDFOX_API_KEY=process.env.REDFOX_API_KEY||''
const DOUYIN_WORKS_PATH='/story/api/dyData/queryWorkList'

function endpointConfig(){
  try{return JSON.parse(process.env.REDFOX_TREND_ENDPOINTS_JSON||'{}')}catch(e){throw new Error('REDFOX_TREND_ENDPOINTS_JSON 不是合法 JSON')}
}
function hashKey(s){return crypto.createHash('sha1').update(String(s||'')).digest('hex').slice(0,20)}
function number(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return v;const s=String(v).replace(/,/g,'').trim();const m=s.match(/^([\d.]+)\s*([万亿kw])?$/i);if(!m)return Number(s)||0;const n=Number(m[1]);const u=m[2]?.toLowerCase();return u==='亿'?n*1e8:u==='万'||u==='w'?n*1e4:u==='k'?n*1e3:n}
function findArray(value){if(Array.isArray(value))return value; if(!value||typeof value!=='object')return []; for(const key of ['list','items','records','rows','result','results','data','hotSearch','hotList']){const x=value[key];if(Array.isArray(x))return x;const nested=findArray(x);if(nested.length)return nested} return []}
function titleOf(x){return String(x.title??x.name??x.keyword??x.word??x.hotWord??x.text??x.desc??'').trim()}
function normalize(raw,platform,kind){
  const list=findArray(raw); const observedAt=new Date().toISOString();
  return list.map((x,i)=>{const title=titleOf(x);if(!title)return null;const metrics={views:number(x.views??x.playCount??x.play_count),likes:number(x.likes??x.likeCount??x.like_count),comments:number(x.comments??x.commentCount??x.comment_count),shares:number(x.shares??x.shareCount??x.share_count),favorites:number(x.favorites??x.collectCount??x.collect_count),heat:number(x.hot??x.hotScore??x.hot_score??x.score??x.index)};const rank=Number(x.rank??x.position??x.index??(i+1));return {platform,kind,external_id:String(x.id??x.awemeId??x.videoId??x.itemId??x.workId??x.url??hashKey(title)),title,url:x.url??x.link??x.shareUrl??x.workUrl??'',rank:Number.isFinite(rank)?rank:i+1,hot_score:metrics.heat||Math.max(0,10000-i*100),growth_score:number(x.growth??x.growthScore??x.increase??x.delta),metrics,raw:x,observed_at:observedAt}}).filter(Boolean)
}

function normalizeDouyinWork(x){
  return {
    workId:String(x.workId??x.awemeId??x.id??''),
    title:String(x.title??'').trim(),
    content:String(x.content??''),
    workUrl:String(x.workUrl??x.url??''),
    coverUrl:String(x.coverUrl??''),
    workType:String(x.workType??''),
    duration:number(x.duration),
    publishTime:x.publishTime??null,
    crawlTime:x.crawlTime??null,
    accountId:String(x.authorId??x.accountId??''),
    accountName:String(x.accountName??''),
    secUid:String(x.secUid??x.secUidId??''),
    avatarUrl:String(x.avatarUrl??''),
    followerCount:number(x.followerCount),
    likeCount:number(x.likeCount),
    commentCount:number(x.commentCount),
    shareCount:number(x.shareCount),
    repostCount:number(x.repostCount),
    collectCount:number(x.collectCount),
    isPromotion:Number(x.isPromotion||0),
    raw:x
  }
}

async function callEndpoint(spec){
  const url=new URL(spec.url||'',REDFOX_BASE_URL).toString(); const headers={'Content-Type':'application/json','REDFOX_API_KEY':REDFOX_API_KEY};
  const init={method:String(spec.method||'POST').toUpperCase(),headers}; if(init.method==='GET'){const target=new URL(url);if(spec.params)for(const [k,v] of Object.entries(spec.params))target.searchParams.set(k,v);init.body=undefined;return callRaw(target.toString(),init)} init.body=JSON.stringify(spec.body||{});return callRaw(url,init)
}
async function callRaw(url,init){const r=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});const text=await r.text();let json;try{json=JSON.parse(text)}catch{throw new Error(`RedFox 返回非 JSON：HTTP ${r.status}`)}if(!r.ok||[401,403].includes(r.status))throw new Error(json.msg||json.message||`RedFox 请求失败：HTTP ${r.status}`);if(json.code&&Number(json.code)!==2000)throw new Error(json.msg||json.message||`RedFox code ${json.code}`);return json}
function configuredEndpoints(){const cfg=endpointConfig();const out=[];for(const [platform,groups] of Object.entries(cfg||{})){for(const [kind,spec] of Object.entries(groups||{})){if(spec?.url)out.push({platform,kind,...spec})}}return out}

export function trendConfig(){return {baseUrl:REDFOX_BASE_URL,hasApiKey:Boolean(REDFOX_API_KEY),endpoints:configuredEndpoints().map(x=>({platform:x.platform,kind:x.kind,url:x.url})),douyin:{accountWorksPath:DOUYIN_WORKS_PATH,enabled:Boolean(REDFOX_API_KEY),ranks:douyinRankConfig()}}}

export async function queryDouyinAccountWorks({accountId='',authorUrl='',secUserId='',offset=0,sortType='_2',publishTimeStart='',publishTimeEnd='',source=''}={}, {db,userId,persist=true}={}){
  if(!REDFOX_API_KEY)throw new Error('未配置 REDFOX_API_KEY')
  if(!accountId&&!authorUrl&&!secUserId)throw new Error('至少提供 accountId、authorUrl 或 secUserId 之一')
  const body={accountId,authorUrl,secUserId,offset:Math.max(0,Number(offset)||0),sortType:['_0','_2','_4'].includes(sortType)?sortType:'_2'}
  if(publishTimeStart)body.publishTimeStart=String(publishTimeStart)
  if(publishTimeEnd)body.publishTimeEnd=String(publishTimeEnd)
  if(source)body.source=String(source)
  const raw=await callRaw(`${REDFOX_BASE_URL}${DOUYIN_WORKS_PATH}`,{method:'POST',headers:{'Content-Type':'application/json','REDFOX_API_KEY':REDFOX_API_KEY},body:JSON.stringify(body)})
  const data=raw?.data||{}
  const list=Array.isArray(data.list)?data.list:findArray(data)
  const works=list.map(normalizeDouyinWork).filter(x=>x.workId||x.title)
  if(persist&&db&&userId&&works.length){
    let sourceRow=await db.from('trend_sources').select('id').eq('user_id',userId).eq('provider','redfox').eq('platform','douyin').eq('name','RedFox 抖音账号作品').maybeSingle()
    if(!sourceRow.data){sourceRow=await db.from('trend_sources').insert({user_id:userId,provider:'redfox',platform:'douyin',name:'RedFox 抖音账号作品',enabled:true,config:{path:DOUYIN_WORKS_PATH,sortType:body.sortType},status:'ready'}).select('id').single()}
    if(sourceRow.error)throw sourceRow.error
    const rows=works.map(work=>({user_id:userId,source_id:sourceRow.data.id,platform:'douyin',kind:'account_work',external_id:work.workId,title:work.title||work.content.slice(0,50)||'未命名作品',url:work.workUrl,rank:null,hot_score:work.likeCount+work.shareCount*2+work.commentCount*2, growth_score:0, metrics:{views:0,likes:work.likeCount,comments:work.commentCount,shares:work.shareCount,favorites:work.collectCount,reposts:work.repostCount,duration:work.duration,followerCount:work.followerCount,isPromotion:work.isPromotion,workType:work.workType,publishTime:work.publishTime},raw:work.raw,observed_at:new Date().toISOString()}))
    const {error}=await db.from('trend_items').insert(rows);if(error)throw error
    await db.from('trend_sources').update({last_sync_at:new Date().toISOString(),status:'ready',last_error:null}).eq('id',sourceRow.data.id)
  }
  return {total:Number(data.total||works.length),hasMore:Boolean(data.hasMore),offset:body.offset,sortType:body.sortType,accountName:works[0]?.accountName||'',works}
}

export async function syncRedfoxTrends(db,userId){
  if(!REDFOX_API_KEY)throw new Error('未配置 REDFOX_API_KEY')
  const endpoints=configuredEndpoints(); const summary=[]
  for(const spec of endpoints){
    const {data:source}=await db.from('trend_sources').insert({user_id:userId,provider:'redfox',platform:spec.platform,name:`RedFox ${spec.platform} ${spec.kind}`,enabled:true,config:{url:spec.url,kind:spec.kind},status:'ready'}).select('id').single()
    try{const raw=await callEndpoint(spec);const items=normalize(raw,spec.platform,spec.kind);if(items.length){const rows=items.map(x=>({...x,user_id:userId,source_id:source.id}));const {data,error}=await db.from('trend_items').insert(rows).select('*');if(error)throw error;for(const item of data||[]){const key=hashKey(item.title.toLowerCase().replace(/\s+/g,' '));const {data:event,error:eventError}=await db.from('trend_events').upsert({user_id:userId,canonical_key:key,title:item.title,hot_score:Number(item.hot_score||0),growth_score:Number(item.growth_score||0),platforms:[item.platform],last_seen_at:item.observed_at},{onConflict:'user_id,canonical_key'}).select('*').single();if(eventError)throw eventError;await db.from('trend_event_items').upsert({event_id:event.id,trend_item_id:item.id},{onConflict:'event_id,trend_item_id'})}await db.from('trend_sources').update({last_sync_at:new Date().toISOString(),status:'ready',last_error:null}).eq('id',source.id);summary.push({platform:spec.platform,kind:spec.kind,count:items.length})}else{summary.push({platform:spec.platform,kind:spec.kind,count:0})}}catch(error){await db.from('trend_sources').update({status:'error',last_error:error.message,last_sync_at:new Date().toISOString()}).eq('id',source.id);summary.push({platform:spec.platform,kind:spec.kind,error:error.message})}
  }
  const {data:rankSource}=await db.from('trend_sources').select('last_sync_at').eq('user_id',userId).eq('provider','redfox').eq('platform','douyin').eq('name','RedFox 抖音每日热门作品榜').maybeSingle()
  const rankFresh=rankSource?.last_sync_at && Date.now()-new Date(rankSource.last_sync_at).getTime()<12*60*60*1000
  if(!rankFresh){
    try{summary.push({platform:'douyin',kind:'daily_ranks',...(await syncDouyinRanks(db,userId))})}
    catch(error){summary.push({platform:'douyin',kind:'daily_ranks',error:error.message})}
  }
  return summary
}

export async function getTrendDashboard(db,userId,limit=80){
  const {data:events,error}=await db.from('trend_events').select('*').eq('user_id',userId).order('hot_score',{ascending:false}).order('last_seen_at',{ascending:false}).limit(limit);if(error)throw error
  const ids=(events||[]).map(x=>x.id);let evidence=[];if(ids.length){const q=await db.from('trend_event_items').select('event_id,trend_items(*)').in('event_id',ids);evidence=q.data||[]}
  const by=new Map();for(const row of evidence){const list=by.get(row.event_id)||[];if(row.trend_items)list.push(row.trend_items);by.set(row.event_id,list)}
  return (events||[]).map(e=>({...e,items:by.get(e.id)||[]}))
}

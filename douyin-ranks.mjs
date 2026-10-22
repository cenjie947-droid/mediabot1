const BASE_URL=(process.env.REDFOX_BASE_URL||'https://redfox.hk').replace(/\/$/,'')
const API_KEY=process.env.REDFOX_API_KEY||''
const HOT_PATH='/story/api/dy/search/likesRank'
const GROWTH_PATH='/story/api/dy/search/getDailyRank'

const CATEGORIES=['小剧场','财富理财','二次元','身体锻炼','居家装修','数码科技','科学普及','旅行','美食','动物','明星娱乐','汽车','亲子','人文','三农','潮流风尚','游戏','生活记录','体育','舞蹈才艺','学习教育','休闲玩乐','影视','音乐','颜值造型','健康医学','综艺','个人成长']

function dayOffset(days){
  const d=new Date(Date.now()+days*86400000)
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${day}`
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function text(v){return v==null?'':String(v)}
function hashKey(s){let h=0;for(const ch of String(s||'')){h=((h<<5)-h)+ch.charCodeAt(0);h|=0}return `dy_${Math.abs(h).toString(36)}`}
async function call(path,body){
  if(!API_KEY) throw new Error('未配置 REDFOX_API_KEY')
  const r=await fetch(`${BASE_URL}${path}`,{method:'POST',headers:{'Content-Type':'application/json','REDFOX_API_KEY':API_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
  const raw=await r.text();let j
  try{j=JSON.parse(raw)}catch{throw new Error(`RedFox 返回非 JSON：HTTP ${r.status}`)}
  if(!r.ok||Number(j.code||2000)!==2000) throw new Error(j.msg||j.message||`RedFox 请求失败：HTTP ${r.status}`)
  return j
}
function hotRows(data){
  return (Array.isArray(data)?data:[]).map((x,i)=>{
    const likes=num(x.likeCount),shares=num(x.shareCount),comments=num(x.commentCount),collects=num(x.collectCount)
    const fallback=likes+shares*2+comments*2+collects
    const score=num(x.totalScore)||fallback
    return {externalId:text(x.workId),title:text(x.title||x.content).trim(),url:text(x.workUrl),rank:i+1,hotScore:score,growthScore:0,metrics:{likes,shares,comments,collects,duration:num(x.duration),followerCount:num(x.followerCount),category:text(x.category),recencyScore:num(x.recencyScore),relevanceScore:num(x.relevanceScore),popularityScore:num(x.popularityScore),totalScore:num(x.totalScore),accountId:text(x.accountId),accountName:text(x.accountName),coverUrl:text(x.coverUrl),workType:text(x.workType),publishTime:text(x.publishTime),commentTopKeywords:x.commentTopKeywords||[]},raw:x}
  }).filter(x=>x.externalId&&x.title)
}
function growthRows(data){
  return (Array.isArray(data)?data:[]).map((x,i)=>{
    const likes=num(x.add_digg_count),shares=num(x.add_share_count),comments=num(x.add_comment_count),collects=num(x.add_collect_count),forwards=num(x.add_forward_count)
    const growth=likes+shares*2+comments*2+collects+forwards
    return {externalId:text(x.aweme_id),title:text(x.aweme_desc).trim(),url:text(x.share_url),rank:i+1,hotScore:growth,growthScore:growth,metrics:{addLikes:likes,addShares:shares,addComments:comments,addCollects:collects,addForwards:forwards,totalLikes:num(x.use_digg_count),totalShares:num(x.use_share_count),totalComments:num(x.use_comment_count),totalCollects:num(x.use_collect_count),totalForwards:num(x.use_forward_count),category:text(x.category),authorId:text(x.author_user_id),accountName:text(x.user_nickname),avatarUrl:text(x.user_avatar),publishTime:x.create_time_str||null,rankDate:x.rank_date_str||null,anaTime:num(x.ana_time)},raw:x}
  }).filter(x=>x.externalId&&x.title)
}
async function ensureSource(db,userId,name,config){
  const q=await db.from('trend_sources').select('id,last_sync_at').eq('user_id',userId).eq('provider','redfox').eq('platform','douyin').eq('name',name).maybeSingle()
  if(q.error)throw q.error
  if(q.data)return q.data
  const ins=await db.from('trend_sources').insert({user_id:userId,provider:'redfox',platform:'douyin',name,enabled:true,config,status:'ready'}).select('id,last_sync_at').single()
  if(ins.error)throw ins.error
  return ins.data
}
async function persistRows(db,userId,source,kind,rows,observedAt){
  for(const item of rows){
    const existing=await db.from('trend_items').select('id').eq('user_id',userId).eq('platform','douyin').eq('kind',kind).eq('external_id',item.externalId).order('observed_at',{ascending:false}).limit(1).maybeSingle()
    if(existing.error)throw existing.error
    const payload={user_id:userId,source_id:source.id,platform:'douyin',kind,external_id:item.externalId,title:item.title,url:item.url,rank:item.rank,hot_score:item.hotScore,growth_score:item.growthScore,metrics:item.metrics,raw:item.raw,observed_at:observedAt}
    const saved=existing.data?await db.from('trend_items').update(payload).eq('id',existing.data.id).select('id').single():await db.from('trend_items').insert(payload).select('id').single()
    if(saved.error)throw saved.error
    const canonical=hashKey(item.title.toLowerCase().replace(/\s+/g,' '))
    const event=await db.from('trend_events').upsert({user_id:userId,canonical_key:canonical,title:item.title,hot_score:item.hotScore,growth_score:item.growthScore,content_score:Math.max(item.hotScore,item.growthScore),platforms:['douyin'],last_seen_at:observedAt,evidence:{kind,rank:item.rank,metrics:item.metrics}},{onConflict:'user_id,canonical_key'}).select('id').single()
    if(event.error)throw event.error
    const link=await db.from('trend_event_items').upsert({event_id:event.data.id,trend_item_id:saved.data.id},{onConflict:'event_id,trend_item_id'})
    if(link.error)throw link.error
  }
}
export function douyinRankConfig(){return {enabled:Boolean(API_KEY),hotPath:HOT_PATH,growthPath:GROWTH_PATH,categories:CATEGORIES,schedule:'hot after 10:00; growth after 16:00'}}
export async function syncDouyinRanks(db,userId,{category=process.env.DOUYIN_RANK_CATEGORY||'全部',date=dayOffset(-1)}={}){
  if(!API_KEY)throw new Error('未配置 REDFOX_API_KEY')
  const hotType=category==='全部'?'':String(category), growthType=category||'全部'
  const [hot,growth]=await Promise.all([call(HOT_PATH,{type:hotType,startTime:date,endTime:date}),call(GROWTH_PATH,{type:growthType,startTime:date})])
  const hotData=hotRows(hot?.data),growthData=growthRows(growth?.data),observedAt=new Date().toISOString()
  const hotSource=await ensureSource(db,userId,'RedFox 抖音每日热门作品榜',{path:HOT_PATH,type:category,date})
  const growthSource=await ensureSource(db,userId,'RedFox 抖音每日点赞飙升榜',{path:GROWTH_PATH,type:category,date})
  await persistRows(db,userId,hotSource,'douyin_daily_hot',hotData,observedAt)
  await persistRows(db,userId,growthSource,'douyin_daily_like_growth',growthData,observedAt)
  await db.from('trend_sources').update({last_sync_at:observedAt,status:'ready',last_error:null,config:{path:HOT_PATH,type:category,date}}).eq('id',hotSource.id)
  await db.from('trend_sources').update({last_sync_at:observedAt,status:'ready',last_error:null,config:{path:GROWTH_PATH,type:category,date}}).eq('id',growthSource.id)
  return {date,category,hotCount:hotData.length,growthCount:growthData.length}
}

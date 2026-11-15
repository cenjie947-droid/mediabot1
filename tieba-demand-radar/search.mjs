import {classifyDemand} from './engine.mjs';
const API='https://qianfan.baidubce.com/v2/ai_search/web_search';
function normalizeQuery(input){
 const q=String(input||'').trim();
 const lower=q.toLowerCase();
 for(const prefix of ['site:tieba.baidu.com/p','site:tieba.baidu.com/'])if(lower.startsWith(prefix))return q.slice(prefix.length).replace(/^\\/?\\s*/,'').trim();
 return q;
}
export async function searchPublicPosts(queries,apiKey,fetchImpl=fetch){
 if(!apiKey)throw Object.assign(new Error('未配置百度千帆搜索 API Key。请在 Render 服务环境变量中设置 BAIDU_QIANFAN_API_KEY。'),{status:503,code:'SEARCH_KEY_MISSING'});
 if(!Array.isArray(queries)||!queries.length)throw Object.assign(new Error('至少提供一个搜索词'),{status:400,code:'INVALID_QUERIES'});
 const clean=queries.slice(0,5).map(normalizeQuery).filter(Boolean);
 if(!clean.length)throw Object.assign(new Error('搜索词不能为空'),{status:400,code:'INVALID_QUERIES'});
 const all=[];
 for(const query of clean){
  const response=await fetchImpl(API,{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:query}],search_source:'baidu_search_v2',edition:'standard',resource_type_filter:[{type:'web',top_k:20}],search_filter:{match:{site:['tieba.baidu.com']}},search_recency_filter:'month'}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Object.assign(new Error('百度搜索接口返回 '+response.status+'：'+(await response.text()).slice(0,300)),{status:502,code:'UPSTREAM_SEARCH_ERROR'});
  const payload=await response.json(),refs=Array.isArray(payload.references)?payload.references:[];
  for(const r of refs){
   const url=String(r.url||'');
   let parsed;try{parsed=new URL(url)}catch{continue}
   if(parsed.protocol!=='https:'||parsed.hostname!=='tieba.baidu.com')continue;
   const title=String(r.title||'').trim(),snippet=String(r.snippet||r.summary||r.content||'').trim();
   if(!title&&!snippet)continue;
   all.push({title,content:snippet,url,source:r.website||r.web_anchor||'百度搜索',publishedAt:r.date||null,query,...classifyDemand({title,content:snippet,forum:'贴吧',url})});
  }
 }
 const seen=new Set();
 return all.filter(x=>{if(seen.has(x.url))return false;seen.add(x.url);return true;}).sort((a,b)=>b.score-a.score).slice(0,50);
}

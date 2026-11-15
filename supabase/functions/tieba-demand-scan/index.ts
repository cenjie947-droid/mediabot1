const URL0=Deno.env.get("SUPABASE_URL")!;
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGIN="https://tieba-demand-radar.onrender.com";
const CORS={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-radar-cron-token","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:CORS});
async function rpc(name:string,args:Record<string,unknown>){
 const r=await fetch(URL0+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SERVICE,"Authorization":"Bearer "+SERVICE,"Content-Type":"application/json"},body:JSON.stringify(args)});
 if(!r.ok)throw new Error("DB "+name+" failed: "+(await r.text()).slice(0,200));
 return await r.json();
}
async function getSecret(name:string){const x=await rpc("radar_get_secret",{p_name:name});return typeof x==="string"?x:"";}
async function validUser(req:Request){
 const h=req.headers.get("authorization")||"",token=h.startsWith("Bearer ")?h.slice(7):"";
 if(!token)return false;
 const key=await getSecret("publishable_key");
 const r=await fetch(URL0+"/auth/v1/user",{headers:{"apikey":key,"Authorization":"Bearer "+token}});
 return r.ok;
}
function assess(title:string,content:string,url:string,query:string){
 const s=title+" "+content;
 const exclusions:[string,RegExp][]=[["线下/实物需求",/上门|到店|线下|面交|陪诊|搬家|维修|跑腿|现场安装|实体店|寄快递|求购二手|租房|找房|包车|接送/],["广告或高风险内容",/广告|推广|加群|招代理|刷单|博彩|赌博|贷款|色情|代考|刷单返利|投资稳赚/]];
 const ex=exclusions.find(([,re])=>re.test(s));
 const categories:[string,RegExp][]=[["书籍",/小说|书籍|网文|漫画|作者|章节|书名|找书|轻小说|出版物/],["影视",/电影|电视剧|动漫|动画|片名|剧集|找片|纪录片|短剧|综艺/],["游戏",/游戏|手游|单机|steam|主机游戏|模组|mod/i],["音乐",/歌曲|音乐|旋律|歌词|bgm|配乐|歌名/i],["软件与工具",/软件|工具|插件|脚本|程序|app|应用|源码|自动化|浏览器扩展/i],["设计与创作",/设计|海报|logo|建模|渲染|剪辑|配音|绘画|插画|分镜|动画制作/i],["开发与技术",/代码|编程|开发|网站|小程序|接口|api|部署|服务器|数据库|报错|bug/i],["写作与翻译",/写作|文案|润色|翻译|校对|简历|论文|报告|小说创作/],["数据与办公",/数据|表格|excel|爬虫|录入|ppt|word|pdf|统计分析/i],["资料",/资料|文献|教程|文件|电子书|课程|素材|模板/]];
 const category=categories.find(([,re])=>re.test(s))?.[0]||"其他";
 const request=/求|寻找|想找|有没有|哪里有|谁有|求助|推荐|帮忙|急需|需要|找不到|只记得|忘了名字/.test(s);
 const online=/链接|下载|在线|电子版|软件|网站|远程|文件|代码|资料|教程|文案|翻译|设计|剪辑|游戏|小说|电影|工具|表格|海报/.test(s);
 const score=Math.max(0,Math.min(100,30+Math.min(30,(content.length>=30?8:0)+(content.length>=100?10:0)+(content.length>=220?12:0))+8+5+(request?15:0)+(online?12:0)-(ex?100:0)));
 const qualified=!ex&&request&&(online||category!=="其他");
 return {category,score,is_excluded:!!ex,exclude_reason:ex?.[0]||null,qualified,recommendation:ex?"排除":qualified&&score>=55?"优先跟进":qualified?"待复核":"低优先级",search_query:query,source:"百度搜索"};
}
const DEFAULTS=["找书吧 求书 小说 只记得剧情","找电影吧 求电影 只记得剧情","求软件 工具 脚本 自动化","求设计 剪辑 建模 远程","求代码 网站 开发 文案 翻译 资料"];
async function scan(queries:string[]){
 const key=await getSecret("baidu_qianfan_api_key");
 if(!key)throw Object.assign(new Error("尚未配置百度千帆 API Key。请在需求雷达的设置页保存密钥。"),{status:503});
 await rpc("radar_reserve_quota",{p_calls:queries.length});
 const all:any[]=[];
 for(const q of queries){
  const response=await fetch("https://qianfan.baidubce.com/v2/ai_search/web_search",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:q}],search_source:"baidu_search_v2",edition:"standard",resource_type_filter:[{type:"web",top_k:20}],search_filter:{match:{site:["tieba.baidu.com"]}},search_recency_filter:"month"}),signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error("百度搜索接口 "+response.status+": "+(await response.text()).slice(0,200));
  const payload=await response.json();
  if(payload.code&&!Array.isArray(payload.references))throw new Error("百度搜索错误 "+payload.code+": "+(payload.message||""));
  for(const ref of (Array.isArray(payload.references)?payload.references:[])){
   const u=String(ref.url||"");let parsed:URL;try{parsed=new URL(u)}catch{continue}
   if(parsed.protocol!=="https:"||parsed.hostname!=="tieba.baidu.com")continue;
   const title=String(ref.title||"").trim(),content=String(ref.snippet||ref.summary||ref.content||"").trim();
   if(!title&&!content)continue;
   const a=assess(title,content,u,q),dt=ref.date?Date.parse(String(ref.date)):NaN;
   all.push({source_url:u,title:title||"（无标题）",content,category:a.category,score:a.score,is_excluded:a.is_excluded,exclude_reason:a.exclude_reason,qualified:a.qualified,recommendation:a.recommendation,published_at:Number.isFinite(dt)?new Date(dt).toISOString():null,search_query:q,source:String(ref.website||ref.web_anchor||"百度搜索"),raw_data:{snippet:content.slice(0,1200),query:q}});
  }
 }
 const map=new Map<string,any>();for(const x of all){const prev=map.get(x.source_url);if(!prev||x.score>prev.score)map.set(x.source_url,x)}
 const rows=[...map.values()].sort((a,b)=>b.score-a.score).slice(0,100);
 const stored=rows.length?await rpc("radar_ingest_scan",{p_rows:rows}):0;
 return {ok:true,scanned:all.length,unique:rows.length,stored,results:rows,scannedAt:new Date().toISOString(),mode:"rules"};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
 if(req.method!=="POST")return reply(405,{error:"POST required"});
 try{
  const body=await req.json();
  const expected=await getSecret("radar_cron_token");
  const cronHeader=req.headers.get("x-radar-cron-token")||"";
  const cron=!!expected&&!!cronHeader&&cronHeader===expected;
  if(!cron&&!await validUser(req))return reply(401,{error:"请先登录需求雷达后再操作"});
  if(body.action==="save_key"){
   const apiKey=String(body.apiKey||"").trim();
   if(apiKey.length<20||apiKey.length>500)return reply(400,{error:"API Key 格式不正确"});
   await rpc("radar_set_secret",{p_name:"baidu_qianfan_api_key",p_value:apiKey});
   return reply(200,{ok:true,message:"密钥已加密保存到 Supabase Vault"});
  }
  if(body.action==="scan"){
   const queries=Array.isArray(body.queries)?body.queries.map((x:unknown)=>String(x||"").trim()).filter(Boolean).slice(0,5):DEFAULTS;
   if(!queries.length)return reply(400,{error:"没有有效搜索词"});
   return reply(200,await scan(queries));
  }
  return reply(400,{error:"unknown action"});
 }catch(e){
  const status=Number((e as any)?.status)||500;
  console.error("tieba-demand-scan:",e instanceof Error?e.message:"unknown error");
  return reply(status,{error:e instanceof Error?e.message:"扫描失败"});
 }
});

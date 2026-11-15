import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {classifyDemand,buildSearchQueries,buildContactDraft} from './engine.mjs';
import {searchPublicPosts} from './search.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const htmlPath=path.join(root,'index.html');
const html=await readFile(htmlPath,'utf8');
const inlineScripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
if(!inlineScripts.length)throw new Error('No inline app script found');
for(const [i,source] of inlineScripts.entries())new Script(source,{filename:'index-inline-'+i+'.js'});
console.log('Inline browser JavaScript syntax check passed ('+inlineScripts.length+' script).');
const send=(res,status,type,body)=>{res.writeHead(status,{'content-type':type,'x-content-type-options':'nosniff','cache-control':'no-store'});res.end(body)};
const searchHits=new Map();\nconst server=http.createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/healthz')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'tieba-demand-radar',version:'2.2.0',inlineScriptsChecked:inlineScripts.length,publicSearchConfigured:Boolean(process.env.BAIDU_QIANFAN_API_KEY)}));
 if(req.method==='POST'&&req.url==='/api/search'){const ip=req.socket.remoteAddress||'unknown',now=Date.now(),hits=(searchHits.get(ip)||[]).filter(t=>now-t<3600000);if(hits.length>=5)return send(res,429,'application/json; charset=utf-8',JSON.stringify({error:'该网络地址每小时最多扫描 5 次，请稍后再试。',code:'RATE_LIMITED'}));searchHits.set(ip,[...hits,now]);let raw='';req.on('data',c=>{raw+=c;if(raw.length>20000)req.destroy()});req.on('end',async()=>{try{const d=JSON.parse(raw||'{}');const results=await searchPublicPosts(d.queries||[],process.env.BAIDU_QIANFAN_API_KEY);send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,results,scannedAt:new Date().toISOString()}))}catch(e){send(res,e.status||500,'application/json; charset=utf-8',JSON.stringify({error:e.message||'Search failed',code:e.code||'SEARCH_FAILED'}))}});return}
 if(req.method==='POST'&&req.url==='/api/analyze'){let raw='';req.on('data',c=>{raw+=c;if(raw.length>200000)req.destroy()});req.on('end',()=>{try{const d=JSON.parse(raw||'{}');send(res,200,'application/json; charset=utf-8',JSON.stringify({...classifyDemand(d),searchQueries:buildSearchQueries(d),contactDraft:buildContactDraft(d)}))}catch{send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'Invalid JSON'}))}});return}
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html'))return send(res,200,'text/html; charset=utf-8',html);
 send(res,404,'text/plain; charset=utf-8','Not found');
});
server.listen(port,'0.0.0.0',()=>console.log('Tieba Demand Radar listening on '+port));

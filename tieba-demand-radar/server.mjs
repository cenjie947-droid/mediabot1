import http from 'node:http';import {readFile} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {classifyDemand,buildSearchQueries,buildContactDraft} from './engine.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||3000);
const send=(r,s,t,b)=>{r.writeHead(s,{'content-type':t,'x-content-type-options':'nosniff','cache-control':'no-store'});r.end(b)};
const server=http.createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/healthz')return send(res,200,'application/json; charset=utf-8',JSON.stringify({ok:true,service:'tieba-demand-radar',version:'2.0.0'}));
 if(req.method==='POST'&&req.url==='/api/analyze'){let raw='';req.on('data',c=>{raw+=c;if(raw.length>200000)req.destroy()});req.on('end',()=>{try{const d=JSON.parse(raw||'{}');send(res,200,'application/json; charset=utf-8',JSON.stringify({...classifyDemand(d),searchQueries:buildSearchQueries(d),contactDraft:buildContactDraft(d)}))}catch{send(res,400,'application/json; charset=utf-8',JSON.stringify({error:'Invalid JSON'}))}});return}
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){try{return send(res,200,'text/html; charset=utf-8',await readFile(path.join(root,'index.html')))}catch{return send(res,500,'text/plain; charset=utf-8','Application file unavailable')}}
 send(res,404,'text/plain; charset=utf-8','Not found');
});server.listen(port,'0.0.0.0',()=>console.log('Tieba Demand Radar listening on '+port));
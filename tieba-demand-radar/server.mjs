import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
const port=Number(process.env.PORT||3000);
const server=http.createServer(async(req,res)=>{
  if(req.url==='/healthz'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,service:'tieba-demand-radar',version:'1.0.0'}));return;}
  if(req.url==='/'||req.url==='/index.html'){
    try{const body=await readFile(path.join(root,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body);}
    catch{res.writeHead(500);res.end('Application file unavailable');}return;
  }
  res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');
});
server.listen(port,'0.0.0.0',()=>console.log('Tieba Demand Radar listening on '+port));

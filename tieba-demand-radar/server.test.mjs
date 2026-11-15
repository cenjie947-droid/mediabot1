import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('HTTP health, app shell, PWA assets and API endpoints',async(t)=>{
 const port=19000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),BAIDU_QIANFAN_API_KEY:''},stdio:['ignore','pipe','pipe']});
 await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('server start timeout')),5000))]);
 t.after(()=>{if(!child.killed)child.kill('SIGTERM')});
 const base='http://127.0.0.1:'+port;
 for(const route of ['/?from=mobile','/','/index.html','/app/']){
  const response=await fetch(base+route);
  assert.equal(response.status,200,route);
  assert.match(await response.text(),/需求雷达/);
 }
 for(const [route,expected] of [['/manifest.webmanifest','application/manifest+json'],['/sw.js','text/javascript'],['/icon.svg','image/svg+xml']]){
  const response=await fetch(base+route);
  assert.equal(response.status,200,route);
  assert.ok(response.headers.get('content-type').includes(expected),route);
 }
 const health=await fetch(base+'/healthz');
 assert.equal(health.status,200);
 assert.deepEqual(await health.json(),{ok:true,service:'tieba-demand-radar',version:'2.4.1',inlineScriptsChecked:1,publicSearchConfigured:false});
 const response=await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'求一本小说',content:'只记得主角在雪山遇见老人，后来寻找父亲。',forum:'找书吧',url:'https://tieba.baidu.com/p/123'})});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.category,'书籍');
 assert.ok(result.searchQueries.length>=2);
 assert.match(result.contactDraft,/还需要吗/);
 const search=await fetch(base+'/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({queries:['site:tieba.baidu.com/p 求书']})});
 assert.equal(search.status,503);
 assert.equal((await search.json()).code,'SEARCH_KEY_MISSING');
 const bad=await fetch(base+'/api/analyze',{method:'POST',headers:{'content-type':'application/json'},body:'{bad'});
 assert.equal(bad.status,400);
});

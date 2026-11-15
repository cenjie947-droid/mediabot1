import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('all inline browser scripts parse successfully',async()=>{
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 const scripts=[...html.matchAll(/<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(x=>x[1]);
 assert.ok(scripts.length>0,'inline application script exists');
 for(const [i,source] of scripts.entries())assert.doesNotThrow(()=>new vm.Script(source,{filename:'index-inline-'+i+'.js'}));
});

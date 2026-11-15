import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPublicPosts} from './search.mjs';
test('未配置密钥时明确报错，不伪造结果',async()=>{await assert.rejects(()=>searchPublicPosts(['site:tieba.baidu.com/p 求书'],''),e=>e.code==='SEARCH_KEY_MISSING'&&e.status===503)});
test('仅保留贴吧来源并去重',async()=>{
 const fake=async()=>new Response(JSON.stringify({references:[{title:'求一本小说',snippet:'只记得雪山情节，求书名',url:'https://tieba.baidu.com/p/123'},{title:'重复',snippet:'same',url:'https://tieba.baidu.com/p/123'},{title:'外站',snippet:'no',url:'https://example.com/'}]}),{status:200});
 const rows=await searchPublicPosts(['site:tieba.baidu.com/p 求书'],'fake-key',fake);
 assert.equal(rows.length,1);assert.equal(rows[0].category,'书籍');
});

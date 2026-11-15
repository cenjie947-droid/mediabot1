import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPublicPosts} from './search.mjs';
test('未配置密钥时明确报错，不伪造结果',async()=>{await assert.rejects(()=>searchPublicPosts(['site:tieba.baidu.com/p 求书'],''),e=>e.code==='SEARCH_KEY_MISSING'&&e.status===503)});
test('使用官方 site 过滤参数，只保留贴吧域名并去重',async()=>{
 let sent;
 const fake=async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({references:[
  {title:'求一本小说',snippet:'只记得雪山情节，求书名',url:'https://tieba.baidu.com/p/123',website:'百度贴吧'},
  {title:'重复',snippet:'same',url:'https://tieba.baidu.com/p/123'},
  {title:'外站',snippet:'no',url:'https://example.com/'},
  {title:'仿冒子域',snippet:'no',url:'https://tieba.baidu.com.evil.example/p/2'}
 ]}),{status:200})};
 const rows=await searchPublicPosts(['site:tieba.baidu.com/p 求书'],'fake-key',fake);
 assert.deepEqual(sent.search_filter.match.site,['tieba.baidu.com']);
 assert.equal(sent.messages[0].content,'求书');
 assert.equal(rows[0].url,'https://tieba.baidu.com/p/123');
 assert.equal(rows.length,1);assert.equal(rows[0].category,'书籍');
});
test('空关键词安全拒绝',async()=>{await assert.rejects(()=>searchPublicPosts(['site:tieba.baidu.com/p '],'fake-key'),e=>e.code==='INVALID_QUERIES')});

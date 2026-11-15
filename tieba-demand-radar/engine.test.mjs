import test from 'node:test';import assert from 'node:assert/strict';
import {classifyDemand,isDuplicate,buildSearchQueries,buildContactDraft,normalizeText} from './engine.mjs';
test('分类书籍和影视',()=>{assert.equal(classifyDemand({title:'求一本小说',content:'雪山剧情'}).category,'书籍');assert.equal(classifyDemand({title:'求电影片名',content:'科幻片'}).category,'影视')});
test('排除线下服务和广告',()=>{assert.equal(classifyDemand({title:'求上门维修',content:'到店'}).excluded,true);assert.equal(classifyDemand({title:'广告推广加群',content:'招代理刷单'}).excluded,true)});
test('详细需求评分高于模糊需求',()=>{const a=classifyDemand({title:'求书',content:'求书'}),b=classifyDemand({title:'求小说',content:'求助，只记得主角在雪山遇到老人，后来寻找失踪父亲。',forum:'找书吧',url:'https://tieba.baidu.com/p/1'});assert.ok(b.score>a.score)});
test('按链接和规范化文本去重',()=>{assert.equal(isDuplicate({url:'https://x/1',title:'A'},{url:'https://x/1',title:'B'}),true);assert.equal(isDuplicate({title:'求一本书！',content:'主角在雪山。'},{title:'求一本书',content:'主角在雪山'}),true);assert.equal(normalizeText('Ａ B！'),'ab')});
test('生成搜索词和联系草稿',()=>{assert.ok(buildSearchQueries({title:'求书',content:'雪山故事',forum:'找书吧'}).length>=2);assert.match(buildContactDraft({title:'求书',forum:'找书吧'}),/还需要吗/)});

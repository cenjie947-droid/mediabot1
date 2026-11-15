export function normalizeText(value='') {
 return String(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
}
export function classifyDemand({title='',content='',forum='',url=''}={}) {
 const text=[title,content,forum].join(' ');
 const exclusions=[
  ['线下/实物需求',/上门|到店|线下|面交|陪诊|搬家|维修|跑腿|现场安装|实体店|寄快递|求购二手|租房|找房|包车|接送/],
  ['广告或高风险内容',/广告|推广|加群|招代理|刷单|博彩|赌博|贷款|色情|代考|刷单返利|投资稳赚/]
 ];
 const exclusion=exclusions.find(([,re])=>re.test(text));
 const categories=[
  ['书籍',/小说|书籍|网文|漫画|作者|章节|书名|找书|轻小说|出版物/],
  ['影视',/电影|电视剧|动漫|动画|片名|剧集|找片|纪录片|短剧|综艺/],
  ['游戏',/游戏|手游|单机|steam|主机游戏|模组|mod/i],
  ['音乐',/歌曲|音乐|旋律|歌词|bgm|配乐|歌名/i],
  ['软件与工具',/软件|工具|插件|脚本|程序|app|应用|源码|自动化|浏览器扩展/i],
  ['设计与创作',/设计|海报|logo|建模|渲染|剪辑|配音|绘画|插画|分镜|动画制作/i],
  ['开发与技术',/代码|编程|开发|网站|小程序|接口|api|部署|服务器|数据库|报错|bug/i],
  ['写作与翻译',/写作|文案|润色|翻译|校对|简历|论文|报告|小说创作/],
  ['数据与办公',/数据|表格|excel|爬虫|录入|ppt|word|pdf|统计分析/i],
  ['资料',/资料|文献|教程|文件|电子书|课程|素材|模板/]
 ];
 const category=categories.find(([,re])=>re.test(text))?.[0]||'其他';
 const requestSignal=/求|寻找|想找|有没有|哪里有|谁有|求助|推荐|帮忙|急需|需要|找不到|只记得|忘了名字/.test(text);
 const onlineSignal=/链接|下载|在线|电子版|网盘|软件|网站|远程|文件|代码|资料|教程|文案|翻译|设计|剪辑|游戏|小说|电影|工具|表格|海报/.test(text);
 const detail=Math.min(30,(String(content).length>=30?8:0)+(String(content).length>=100?10:0)+(String(content).length>=220?12:0));
 const score=Math.max(0,Math.min(100,30+detail+(url?8:0)+(forum?5:0)+(requestSignal?15:0)+(onlineSignal?12:0)-(exclusion?100:0)));
 const qualified=!exclusion&&requestSignal&&(onlineSignal||category!=='其他');
 return {category,score,excluded:Boolean(exclusion),excludeReason:exclusion?.[0]||null,requestSignal,onlineSignal,qualified,recommendation:exclusion?'排除':qualified&&score>=55?'优先跟进':qualified?'待复核':'低优先级'};
}
export function isDuplicate(a,b) {
 if(a.url&&b.url&&a.url===b.url)return true;
 const ak=normalizeText([a.title,a.content].join(' ')).slice(0,100),bk=normalizeText([b.title,b.content].join(' ')).slice(0,100);
 return ak.length>=8&&ak===bk;
}
export function buildSearchQueries(d) {
 const title=String(d.title||'').trim(),content=String(d.content||'').trim(),forum=String(d.forum||'').trim(),excerpt=content.replace(/\s+/g,' ').slice(0,90);
 return [...new Set([title,[title,excerpt].filter(Boolean).join(' '),[forum,title].filter(Boolean).join(' ')].filter(x=>x.trim().length>1))];
}
export function buildContactDraft(d) {
 return '你好，看到你之前在'+(d.forum||'贴吧')+'发布了寻找需求「'+(d.title||'')+'」。想问一下你现在还需要吗？如果需要，我可以先把匹配线索和来源发给你核对，确认符合后再继续。';
}

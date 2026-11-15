export function normalizeText(value='') { return String(value).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,''); }
export function classifyDemand({title='',content='',forum='',url=''}={}) {
 const text=[title,content,forum].join(' ');
 const rules=[['线下/实物需求',/上门|到店|线下|面交|陪诊|搬家|维修|跑腿|现场安装|实体店|寄快递|求购二手|租房|找房|包车|接送/],['广告或高风险内容',/广告|推广|加群|招代理|刷单|博彩|赌博|贷款|色情|代考|刷单返利|投资稳赚/]];
 const exclusion=rules.find(([,re])=>re.test(text));
 let category='其他';
 if(/小说|书籍|网文|漫画|作者|章节|书名|找书/.test(text))category='书籍';
 else if(/电影|电视剧|动漫|动画|片名|剧集|找片/.test(text))category='影视';
 else if(/游戏|手游|单机|steam/i.test(text))category='游戏';
 else if(/歌曲|音乐|旋律|歌词|bgm/i.test(text))category='音乐';
 else if(/软件|工具|插件|脚本|程序|app|应用|源码|自动化/.test(text))category='软件与工具';
 else if(/设计|海报|logo|建模|渲染|剪辑|配音|绘画|插画|分镜/.test(text))category='设计与创作';
 else if(/代码|编程|开发|网站|小程序|接口|api|部署|服务器|数据库|报错|bug/.test(text))category='开发与技术';
 else if(/写作|文案|润色|翻译|校对|简历|论文|报告/.test(text))category='写作与翻译';
 else if(/数据|表格|excel|爬虫|录入|ppt|word|pdf|统计分析/.test(text))category='数据与办公';
 else if(/资料|文献|教程|文件|电子书|课程|素材|模板/.test(text))category='资料';
 const detail=Math.min(24,(String(content).length>=30?8:0)+(String(content).length>=100?8:0)+(String(content).length>=220?8:0));
 const score=Math.max(0,Math.min(100,35+detail+(url?10:0)+(forum?7:0)+(/[？?]|求|寻找|想找|求助/.test(text)?12:0)-(exclusion?100:0)));
 return {category,score,excluded:Boolean(exclusion),excludeReason:exclusion?.[0]||null,recommendation:exclusion?'排除':score>=55?'优先跟进':'人工复核'};
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
export function buildContactDraft(d) { return '你好，看到你之前在'+(d.forum||'贴吧')+'发布了寻找需求「'+(d.title||'')+'」。想问一下你现在还需要吗？如果需要，我可以先把匹配线索和来源发给你核对，确认符合后再继续。'; }

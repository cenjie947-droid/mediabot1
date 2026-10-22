const state={supabase:null,projectId:null,timer:null,loading:false,perfTimer:null}

async function client(){
  if(state.supabase)return state.supabase
  try{
    const {createClient}=await import('@supabase/supabase-js')
    const u=import.meta.env.VITE_SUPABASE_URL,k=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    if(u&&k)state.supabase=createClient(u,k,{auth:{persistSession:true,autoRefreshToken:true}})
  }catch{}
  return state.supabase
}

async function authFetch(path,options={}){
  const sb=await client();
  const s=await sb?.auth.getSession();
  const token=s?.data?.session?.access_token;
  if(!token)return null;
  const headers=new Headers(options.headers||{});headers.set('Authorization',`Bearer ${token}`)
  if(options.body)headers.set('Content-Type','application/json')
  const r=await fetch(path,{...options,headers});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'请求失败');
  return j
}

function esc(v){return String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]))}
function projectId(){return document.querySelector('.project-row.active')?.dataset.project||null}
function resultBox(){return document.querySelector('.render-result')}

function renderStatus(r){
  const box=resultBox();if(!box)return;
  const status=r?.status||'queued';
  const label={queued:'排队中',rendering:'渲染中',completed:'已完成',failed:'失败',cancelled:'已取消'}[status]||status;
  const pct=status==='queued'?10:status==='rendering'?55:status==='completed'?100:status==='failed'?100:0;
  const output=r?.output_url;
  const error=r?.error;
  box.innerHTML=`<div class="render-live"><div class="render-live-head"><span>最近任务：<b>${esc(label)}</b></span><span>${pct}%</span></div><div class="render-progress"><i style="width:${pct}%"></i></div>${status==='rendering'?'<small>正在处理镜头、字幕、旁白并生成 MP4，请保持页面打开。</small>':''}${output&&status==='completed'?`<video class="render-player" controls playsinline preload="metadata" src="${esc(output)}"></video><div><a class="primary small" href="${esc(output)}" target="_blank" rel="noreferrer">打开成片</a></div>`:''}${error?`<div class="render-error">${esc(error)}</div>`:''}${status==='failed'?'<button class="secondary small" id="retryRender">↻ 重试渲染</button>':''}</div>`;
  document.querySelector('#retryRender')?.addEventListener('click',retry)
}

function perfBox(){return document.querySelector('#videoPerformancePanel')}
function fmtNum(v){return Number(v||0).toLocaleString('zh-CN')}
function performanceMarkup(rows=[]){
  const latest=rows[0]||{};
  const prev=rows[1]||{};
  const delta=(a,b)=>b?Math.round((Number(a||0)-Number(b||0))/Number(b)*100):null;
  const cards=[['播放',latest.views],['点赞',latest.likes],['评论',latest.comments],['分享',latest.shares],['收藏',latest.favorites]];
  return `<div class="video-perf-inner"><div class="perf-cards">${cards.map(([n,v])=>`<div class="perf-card"><small>${n}</small><b>${fmtNum(v)}</b>${prev.recorded_at&&delta(v,prev[n==='播放'?'views':n==='点赞'?'likes':n==='评论'?'comments':n==='分享'?'shares':'favorites'])!=null?`<span>${delta(v,prev[n==='播放'?'views':n==='点赞'?'likes':n==='评论'?'comments':n==='分享'?'shares':'favorites'])>=0?'↑':'↓'} ${Math.abs(delta(v,prev[n==='播放'?'views':n==='点赞'?'likes':n==='评论'?'comments':n==='分享'?'shares':'favorites']))}% vs 上次</span>`:''}</div>`).join('')}</div><div class="perf-meta">${latest.external_work_id?`作品 ID：${esc(latest.external_work_id)}`:'尚未绑定抖音作品'} · 最近同步：${latest.recorded_at?new Date(latest.recorded_at).toLocaleString('zh-CN'):'—'}</div><div class="perf-actions"><button class="secondary small" id="syncPerformance">↻ 同步抖音数据</button><button class="secondary small" id="analyzePerformance">✦ AI 复盘</button></div><div id="perfAnalysis"></div></div>`
}

async function loadPerformance(){
  const id=projectId(),box=perfBox();if(!id||!box)return;
  try{const r=await authFetch(`/api/video/projects/${id}/performance`);box.innerHTML=performanceMarkup(r?.data||[]);bindPerformance()}catch(e){box.innerHTML=`<div class="video-perf-error">效果数据加载失败：${esc(e.message)}</div>`}
}

function ensurePerformancePanel(){
  const director=document.querySelector('.director-panel');if(!director||!projectId())return;
  if(!document.querySelector('#videoPerformancePanel')){
    const el=document.createElement('div');el.id='videoPerformancePanel';el.className='panel video-performance-panel';el.innerHTML='<div class="panel-title"><div><span class="eyebrow">PERFORMANCE LOOP</span><h3>发布效果</h3></div><span>RedFox</span></div><div class="empty-box">正在读取作品表现…</div>';
    director.appendChild(el)
  }
  loadPerformance()
}

function bindPerformance(){
  document.querySelector('#syncPerformance')?.addEventListener('click',async()=>{
    const b=document.querySelector('#syncPerformance');if(b){b.disabled=true;b.textContent='同步中…'}
    try{const r=await authFetch(`/api/video/projects/${projectId()}/performance/sync`,{method:'POST',body:JSON.stringify({})});await loadPerformance();alert(r?.work?'已同步最新作品数据':'同步完成')}catch(e){alert(e.message)}finally{if(b){b.disabled=false;b.textContent='↻ 同步抖音数据'}}
  })
  document.querySelector('#analyzePerformance')?.addEventListener('click',async()=>{
    const out=document.querySelector('#perfAnalysis');if(!out)return;out.innerHTML='<small>AI 正在复盘这条视频…</small>'
    try{const r=await authFetch(`/api/video/projects/${projectId()}/performance`);const rows=r?.data||[];if(!rows.length){out.innerHTML='<small>还没有表现数据，先同步一次。</small>';return}const x=rows[0];const prompt=`你是短视频运营分析师。请根据这条抖音视频的真实表现数据做复盘，只输出JSON：summary, strengths, weaknesses, next_experiment。数据：views=${x.views}, likes=${x.likes}, comments=${x.comments}, shares=${x.shares}, favorites=${x.favorites}, followers=${x.follower_count}, popularity=${x.popularity_score}`;const a=await authFetch('/api/ai/generate',{method:'POST',body:JSON.stringify({mode:'video',topic:prompt})});out.innerHTML=`<div class="perf-ai"><b>${esc(a.summary||'复盘完成')}</b><p>${esc(a.next_experiment||'')}</p>${Array.isArray(a.strengths)?`<ul>${a.strengths.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}</div>`}catch(e){out.innerHTML=`<small>AI 复盘失败：${esc(e.message)}</small>`}
  })
}

async function poll(){
  const id=projectId();
  if(!id){state.projectId=null;return}
  if(state.loading)return;
  state.projectId=id;state.loading=true;
  try{
    const r=await authFetch(`/api/video/projects/${id}`)
    const render=r?.renders?.[0]
    if(render){renderStatus(render);if(!['completed','failed','cancelled'].includes(render.status))schedule()}
  }catch{}
  finally{state.loading=false;ensurePerformancePanel()}
}
function schedule(){clearTimeout(state.timer);state.timer=setTimeout(poll,2500)}
async function retry(){
  const id=projectId();if(!id)return;
  const b=document.querySelector('#retryRender');if(b){b.disabled=true;b.textContent='提交中…'}
  try{const r=await authFetch(`/api/video/projects/${id}/render`,{method:'POST',body:JSON.stringify({settings:{width:1080,height:1920,fps:30,format:'mp4'}})});renderStatus(r?.data||{status:'queued'});schedule()}catch(e){if(b){b.disabled=false;b.textContent='↻ 重试渲染'};alert(e.message)}
}
function observe(){
  const root=document.querySelector('#app')||document.body
  const mo=new MutationObserver(()=>{const id=projectId();if(id!==state.projectId){state.projectId=id;clearTimeout(state.timer);if(id)schedule()}else if(id&&!document.querySelector('#videoPerformancePanel'))ensurePerformancePanel()})
  mo.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-project']})
  if(projectId())schedule()
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe()

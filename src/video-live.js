const state={supabase:null,projectId:null,timer:null,loading:false}

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
  finally{state.loading=false}
}

function schedule(){clearTimeout(state.timer);state.timer=setTimeout(poll,2500)}

async function retry(){
  const id=projectId();if(!id)return;
  const b=document.querySelector('#retryRender');if(b){b.disabled=true;b.textContent='提交中…'}
  try{
    const r=await authFetch(`/api/video/projects/${id}/render`,{method:'POST',body:JSON.stringify({settings:{width:1080,height:1920,fps:30,format:'mp4'}})})
    renderStatus(r?.data||{status:'queued'});schedule()
  }catch(e){if(b){b.disabled=false;b.textContent='↻ 重试渲染'};alert(e.message)}
}

function observe(){
  const root=document.querySelector('#app')||document.body
  const mo=new MutationObserver(()=>{
    const id=projectId()
    if(id!==state.projectId){state.projectId=id;clearTimeout(state.timer);if(id)schedule()}
  })
  mo.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-project']})
  if(projectId())schedule()
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe()

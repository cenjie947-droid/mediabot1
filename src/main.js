import { createClient } from '@supabase/supabase-js'
import './style.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('MediaBot: missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})

const pages = [
  ['dashboard', '总览'], ['studio', '创作者台'], ['accounts', '广场账号'], ['posts', '发帖记录'],
  ['effects', '效果分析'], ['leaderboard', '排行榜'], ['templates', '模板中心'], ['materials', '素材库'], ['ai', 'AI 助手'], ['me', '个人中心'],
  ['hot', '爆款雷达'], ['remix', '自动剪辑'], ['create', 'AI 写文案'], ['library', '内容库'], ['schedule', '发布计划'], ['tasks', '云端任务'], ['logs', '运行日志']
]

let user = null
let active = 'dashboard'
let data = { hot: [], content: [], tasks: [], logs: [], accounts: [], radar: [], radarPrefs: { watched_categories: ['伤感','情感'], production_mode: 'market' } }
let radarCategory = '全部赛道'
const radarCategories = ['伤感','搞笑','情感','美食','美女','汽车','宠物','知识','影视','游戏','财经','其他']

const $ = (selector) => document.querySelector(selector)
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]))
const empty = (text) => `<div class="empty">${esc(text)}</div>`
const card = (title, body) => `<div class="card"><h3>${title}</h3>${body}</div>`

$('#app').innerHTML = `
  <div class="shell">
    <aside>
      <div class="brand">Media<span>Bot</span><small>AI Content OS · v7</small></div>
      <nav id="nav"></nav>
      <div id="userbox" class="userbox"></div>
    </aside>
    <main>
      <header class="app-header">
        <div class="header-title"><b id="title">Dashboard</b><span>内容运营中枢 <i class="status-pip"></i> 工作区已就绪</span></div>
        <div class="header-tools">
          <label class="global-search"><span>⌕</span><input id="globalSearch" type="search" placeholder="搜索功能，如：剪辑、排期…" aria-label="搜索功能"></label>
          <button id="globalCreate" class="header-create">＋ 快速创作</button>
          <button id="logout" class="ghost hidden">退出</button>
        </div>
      </header>
      <section id="view"></section>
    </main>
  </div>
  <div id="auth" class="auth">
    <div class="auth-card">
      <div class="logo">Media<span>Bot</span></div>
      <h1>AI 内容运营平台</h1>
      <p>登录后管理热点、文案、内容和发布任务</p>
      <form id="authForm">
        <input id="email" type="email" placeholder="邮箱" autocomplete="email" required>
        <input id="password" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password" minlength="6" required>
        <button id="loginBtn" type="submit">登录</button>
        <button type="button" id="signup" class="secondary">注册账号</button>
        <div id="authMsg" role="status"></div>
      </form>
    </div>
  </div>`

const nav = $('#nav')
const navGroups = [
  { title: '工作台', ids: ['dashboard', 'studio', 'posts', 'effects', 'leaderboard'] },
  { title: '内容创作', ids: ['hot', 'ai', 'templates', 'materials', 'remix'] },
  { title: '账号与发布', ids: ['accounts', 'schedule', 'tasks'] },
  { title: '账户', ids: ['me', 'logs'] }
]
for (const group of navGroups) {
  const section = document.createElement('div')
  section.className = 'nav-section'
  const heading = document.createElement('div')
  heading.className = 'nav-section-title'
  heading.textContent = group.title
  section.appendChild(heading)
  for (const id of group.ids) {
    const [, label] = pages.find((item) => item[0] === id) || [id, id]
    const button = document.createElement('button')
    button.dataset.page = id
    button.textContent = label
    button.addEventListener('click', () => {
      active = id
      render()
    })
    section.appendChild(button)
  }
  nav.appendChild(section)
}

$('#globalCreate')?.addEventListener('click', goCreate)
$('#globalSearch')?.addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase()
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.hidden = Boolean(query) && !button.textContent.toLowerCase().includes(query)
  })
  document.querySelectorAll('.nav-section').forEach((section) => {
    const buttons = [...section.querySelectorAll('[data-page]')]
    section.hidden = Boolean(query) && !buttons.some((button) => !button.hidden)
  })
})
$('#globalSearch')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  const query = event.target.value.trim().toLowerCase()
  const match = pages.find(([, label]) => label.toLowerCase().includes(query))
  if (match) { active = match[0]; event.target.value = ''; document.querySelectorAll('[data-page]').forEach((b) => { b.hidden = false }); document.querySelectorAll('.nav-section').forEach((s) => { s.hidden = false }); render() }
})

function setAuthMessage(message, kind = '') {
  const box = $('#authMsg')
  box.className = kind
  box.textContent = message
}

async function currentSession() {
  const { data: result, error } = await supabase.auth.getSession()
  if (error) throw error
  if (result.session) return result.session

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) throw refreshError
  return refreshed.session
}

async function requireSession() {
  const session = await currentSession()
  if (!session?.access_token || !session?.user) throw new Error('登录状态已失效，请重新登录')
  return session
}

async function apiFetch(url, options = {}) {
  const session = await requireSession()
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(url, { ...options, headers })
}

async function load() {
  if (!user) return
  const results = await Promise.all([
    supabase.from('hot_topics').select('*').order('ai_score', { ascending: false }).limit(20),
    supabase.from('content_items').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('scheduled_tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('run_logs').select('*').order('created_at', { ascending: false }).limit(30),
    supabase.from('social_accounts').select('*').order('created_at', { ascending: false }),
    supabase.from('radar_video_snapshots').select('*').order('snapshot_at', { ascending: false }).limit(500),
    supabase.from('radar_preferences').select('*').maybeSingle()
  ])
  const failed = results.find((x) => x.error)
  if (failed?.error) throw failed.error
  data = {
    hot: results[0].data || [], content: results[1].data || [], tasks: results[2].data || [], logs: results[3].data || [], accounts: results[4].data || [],
    radar: results[5].data || [], radarPrefs: results[6].data || { watched_categories: ['伤感','情感'], production_mode: 'market' }
  }
  render()
}

function render() {
  document.querySelectorAll('[data-page]').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === active)
  })
  $('#title').textContent = pages.find((item) => item[0] === active)?.[1] || 'Dashboard'
  const view = $('#view')

  if (active === 'dashboard') {
    const readyContent = data.content.filter(x => ['draft','ready','generated','completed'].includes(String(x.status || '').toLowerCase())).length
    const pendingTasks = data.tasks.filter(x => x.enabled).length
    const connectedAccounts = data.accounts.filter(x => x.status === 'connected').length
    const recentContent = data.content.slice(0, 4)
    const recentTasks = data.tasks.slice(0, 4)
    view.innerHTML = `
      <div class="hero workbench-hero">
        <div><span class="eyebrow">YOUR CONTENT WORKSPACE</span><h1>把灵感，变成下一条好内容。</h1><p>从发现热点、生成文案到管理发布计划，在一个工作台完成内容生产。</p>
          <div class="workbench-actions"><button id="newContentBtn">＋ 创建内容</button><button id="goHotBtn" class="hero-secondary">查看热点 ↗</button></div>
        </div><div class="hero-orbit" aria-hidden="true"><div class="orbit-ring"></div><div class="orbit-core">Mb<span>✳</span></div><i>IDEA → POST</i></div>
      </div>
      <div class="workflow-card">
        <div class="workflow-intro"><span class="eyebrow dark-eyebrow">CONTENT WORKFLOW</span><h3>从灵感到发布，一条流程完成</h3><p>先找方向，再生产内容，最后安排发布。</p></div>
        <div class="workflow-steps">
          <button data-workflow="hot"><span class="workflow-number">01</span><b>发现热点</b><small>找选题与趋势</small><i>↗</i></button>
          <span class="workflow-connector">→</span>
          <button data-workflow="create"><span class="workflow-number">02</span><b>生成文案</b><small>整理标题与内容</small><i>↗</i></button>
          <span class="workflow-connector">→</span>
          <button data-workflow="remix"><span class="workflow-number">03</span><b>制作视频</b><small>用自己的素材剪辑</small><i>↗</i></button>
          <span class="workflow-connector">→</span>
          <button data-workflow="schedule"><span class="workflow-number">04</span><b>安排发布</b><small>进入发布计划</small><i>↗</i></button>
        </div>
      </div>
      <div class="section-heading"><div><span class="eyebrow dark-eyebrow">OVERVIEW</span><h2>运营概览</h2></div><span class="muted">数据来自当前账号已保存的记录</span></div>
      <div class="stats workbench-stats">
        <div class="stat"><div class="stat-top"><span>热点素材</span><span class="stat-icon">↗</span></div><b>${data.hot.length}</b><small>已收集热点</small></div>
        <div class="stat"><div class="stat-top"><span>内容资产</span><span class="stat-icon">▤</span></div><b>${data.content.length}</b><small>已保存内容</small></div>
        <div class="stat"><div class="stat-top"><span>待执行任务</span><span class="stat-icon">◷</span></div><b>${pendingTasks}</b><small>已启用的自动任务</small></div>
        <div class="stat"><div class="stat-top"><span>已接入账号</span><span class="stat-icon">◎</span></div><b>${connectedAccounts}</b><small>已连接的平台账号</small></div>
      </div>
      <div class="workbench-grid">
        <div class="card"><div class="panel-heading"><div><span class="eyebrow dark-eyebrow">QUICK START</span><h3>快速开始</h3></div><span class="panel-mark">✳</span></div>
          <div class="quick-actions">
            <button class="quick-action" id="quickHot"><span class="quick-icon">↗</span><span><b>发现内容方向</b><small>浏览热点与样本趋势</small></span><span class="quick-arrow">→</span></button>
            <button class="quick-action" id="quickWrite"><span class="quick-icon">✎</span><span><b>生成 AI 文案</b><small>从主题开始制作内容</small></span><span class="quick-arrow">→</span></button>
            <button class="quick-action" id="quickEdit"><span class="quick-icon">▶</span><span><b>制作视频</b><small>使用自己的视频素材剪辑</small></span><span class="quick-arrow">→</span></button>
            <button class="quick-action" id="quickAccounts"><span class="quick-icon">◎</span><span><b>管理发布账号</b><small>查看平台接入状态</small></span><span class="quick-arrow">→</span></button>
          </div>
        </div>
        <div class="card"><div class="panel-heading"><div><span class="eyebrow dark-eyebrow">CONTENT LIBRARY</span><h3>最近的内容</h3></div><button class="text-button" id="viewLibrary">查看全部 ↗</button></div>
          ${recentContent.map(x => `<div class="content-line"><div class="content-thumb">${esc((x.platform || '文').slice(0,1).toUpperCase())}</div><div class="content-meta"><b>${esc(x.title || '未命名内容')}</b><small>${esc(x.platform || '未指定平台')} · ${esc(x.status || '草稿')}</small></div><span class="content-score">${x.ai_score ?? '—'}</span></div>`).join('') || empty('还没有内容，先创建你的第一条文案。')}
        </div>
      </div>
      <div class="workbench-grid lower-grid">
        <div class="card"><div class="panel-heading"><div><span class="eyebrow dark-eyebrow">TRENDING</span><h3>热点速览</h3></div><button class="text-button" id="viewHot">进入雷达 ↗</button></div>
          ${data.hot.slice(0,4).map((x,i) => `<div class="trend-line"><span class="trend-rank">${String(i+1).padStart(2,'0')}</span><div><b>${esc(x.title || '未命名热点')}</b><small>${esc(x.source || '来源未记录')}</small></div><strong>${x.ai_score ?? '—'}</strong></div>`).join('') || empty('当前没有已保存热点。')}
        </div>
        <div class="card"><div class="panel-heading"><div><span class="eyebrow dark-eyebrow">AUTOMATION</span><h3>自动任务</h3></div><button class="text-button" id="viewTasks">管理任务 ↗</button></div>
          ${recentTasks.map(x => `<div class="task-line"><span class="task-dot ${x.enabled ? 'is-on' : ''}"></span><div><b>${esc(x.name || '未命名任务')}</b><small>${esc(x.cron_expression || x.task_type || '未设置运行周期')}</small></div><span class="task-state">${x.enabled ? '运行中' : '已暂停'}</span></div>`).join('') || empty('还没有自动任务。')}
        </div>
      </div>`
    $('#newContentBtn').addEventListener('click', goCreate)
    $('#goHotBtn').addEventListener('click', () => { active='hot'; render() })
    $('#quickHot').addEventListener('click', () => { active='hot'; render() })
    $('#quickWrite').addEventListener('click', goCreate)
    $('#quickEdit').addEventListener('click', () => { active='remix'; render() })
    $('#quickAccounts').addEventListener('click', () => { active='accounts'; render() })
    $('#viewLibrary').addEventListener('click', () => { active='library'; render() })
    $('#viewHot').addEventListener('click', () => { active='hot'; render() })
    $('#viewTasks').addEventListener('click', () => { active='tasks'; render() })
  } else if (active === 'studio') {
    renderStudio(view)
  } else if (active === 'ai') {
    renderAIStudio(view)
  } else if (active === 'materials') {
    renderMaterials(view)
  } else if (active === 'posts') {
    view.innerHTML = card('发帖记录', `<div class="filter-row"><span>已保存的帖子与内容记录</span><button id="postsCreate">＋ 新建内容</button></div>` + (data.content.map((x) => `<div class="post-record"><div class="post-platform">${esc((x.platform || '内容').slice(0,1).toUpperCase())}</div><div class="post-record-main"><b>${esc(x.title || '未命名内容')}</b><small>${esc(x.platform || '未指定平台')} · ${esc(x.status || '草稿')} · ${x.created_at ? new Date(x.created_at).toLocaleString() : '时间未记录'}</small></div><span class="status-chip">${esc(x.status || '草稿')}</span><button class="secondary" data-post-queue="${esc(x.id)}">加入发布队列</button></div>`).join('') || empty('暂无发帖记录。先去创作者台创建内容。')));
    $('#postsCreate').addEventListener('click', () => { active='create'; render() })
    document.querySelectorAll('[data-post-queue]').forEach(button=>button.addEventListener('click',()=>queuePublish(button.dataset.postQueue)))
  } else if (active === 'effects') {
    const published = data.content.filter(x => ['published','posted','success','completed'].includes(String(x.status || '').toLowerCase())).length
    const drafts = data.content.filter(x => ['draft','ready','generated'].includes(String(x.status || '').toLowerCase())).length
    view.innerHTML = `<div class="page-intro"><span class="eyebrow dark-eyebrow">PERFORMANCE</span><h1>效果分析</h1><p>汇总当前 MediaBot 已保存的数据。未接入平台统计 API 的指标不会编造。</p></div><div class="stats"><div class="stat"><span>内容总数</span><b>${data.content.length}</b><small>已保存内容</small></div><div class="stat"><span>已发布状态</span><b>${published}</b><small>以记录状态统计</small></div><div class="stat"><span>待完善内容</span><b>${drafts}</b><small>草稿与待处理</small></div><div class="stat"><span>已连接账号</span><b>${data.accounts.filter(x=>x.status==='connected').length}</b><small>平台授权状态</small></div></div>` + card('内容表现明细', data.content.map(x=>`<div class="post-record"><div class="post-record-main"><b>${esc(x.title || '未命名内容')}</b><small>${esc(x.platform || '未指定平台')} · ${esc(x.status || '草稿')}</small></div><strong>${x.ai_score ?? '—'}</strong></div>`).join('') || empty('还没有可分析的内容记录。'))
  } else if (active === 'leaderboard') {
    view.innerHTML = `<div class="page-intro"><span class="eyebrow dark-eyebrow">RANKING</span><h1>排行榜</h1><p>基于当前已保存的热点评分排序，不冒充平台实时榜单。</p></div>` + card('热点内容排行', data.hot.slice().sort((a,b)=>Number(b.ai_score||0)-Number(a.ai_score||0)).map((x,i)=>`<div class="post-record"><div class="rank-number">${String(i+1).padStart(2,'0')}</div><div class="post-record-main"><b>${esc(x.title || '未命名热点')}</b><small>${esc(x.source || '来源未记录')}</small></div><strong>${x.ai_score ?? '—'}</strong></div>`).join('') || empty('暂无热点评分。可先前往爆款雷达录入样本。'))
  } else if (active === 'templates') {
    const templates = [{title:'小红书种草笔记',platform:'小红书',body:'标题：一个让我反复回购的好物\\n开头：先说使用前遇到的问题\\n正文：真实体验、三个亮点、适合人群\\n结尾：邀请读者分享体验'},{title:'抖音口播脚本',platform:'抖音',body:'开头3秒：提出痛点或反差\\n中段：给出三个具体信息点\\n结尾：总结并引导互动'},{title:'知识科普内容',platform:'全平台',body:'提出常见误区\\n用简单例子解释原理\\n给出可执行的三步建议'}]
    view.innerHTML = `<div class="page-intro"><span class="eyebrow dark-eyebrow">TEMPLATES</span><h1>模板中心</h1><p>选择模板后可复制到 AI 写文案页面继续编辑。</p></div><div class="template-grid">${templates.map((t,i)=>`<article class="template-card"><span class="template-tag">${esc(t.platform)}</span><h3>${esc(t.title)}</h3><p>${esc(t.body).replace(/\\n/g,'<br>')}</p><button data-template="${i}">使用模板 ↗</button></article>`).join('')}</div>`
    document.querySelectorAll('[data-template]').forEach(b=>b.addEventListener('click',()=>{ active='create'; render(); const body=$('#body'); if(body) body.value=templates[Number(b.dataset.template)].body; const title=$('#ctitle'); if(title) title.value=templates[Number(b.dataset.template)].title }))
  } else if (active === 'me') {
    view.innerHTML = `<div class="page-intro"><span class="eyebrow dark-eyebrow">ACCOUNT</span><h1>个人中心</h1><p>管理当前登录身份与平台接入状态。</p></div>` + card('账号信息', `<div class="profile-row"><span>登录邮箱</span><b>${esc(user?.email || '未登录')}</b></div><div class="profile-row"><span>用户 ID</span><code>${esc(user?.id || '—')}</code></div><div class="profile-row"><span>身份验证</span><b>Supabase Auth</b></div><div class="profile-row"><span>已连接平台</span><b>${data.accounts.filter(x=>x.status==='connected').length}</b></div><button id="profileLogout" class="secondary">退出登录</button>`)
    $('#profileLogout').addEventListener('click',()=>supabase.auth.signOut())
  } else if (active === 'hot') {
    renderRadar(view)
  } else if (active === 'create') {
    view.innerHTML = card('AI 自动写文案', `
      <form id="contentForm" class="form">
        <input id="ctitle" placeholder="输入热点 / 主题，例如：AI 电商新玩法" required>
        <select id="platform"><option value="all">全平台</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option></select>
        <select id="tone"><option>专业但有网感</option><option>轻松口语化</option><option>观点犀利</option><option>干货教程</option></select>
        <select id="length"><option>中等</option><option>短</option><option>长</option></select>
        <textarea id="body" placeholder="补充你的写作要求（可选）"></textarea>
        <label>抖音视频素材（发布抖音时必填）<input id="mediaFile" type="file" accept="video/mp4,video/webm"></label>
        <button id="generateBtn" type="submit">✨ AI 真正生成</button>
        <div id="aiResult"></div>
      </form>`)
  } else if (active === 'remix') {
    renderRemixLab(view)
  } else if (active === 'library') {
    view.innerHTML = card('内容库', data.content.map((x) => `<div class="row"><div><b>${esc(x.title)}</b><small>${esc(x.platform)} · ${esc(x.status)} · 素材 ${Array.isArray(x.media_urls) && x.media_urls.length ? '已上传' : '无'}</small></div><div class="mini-actions"><strong>${x.ai_score ?? '-'}</strong><button data-queue-publish="${x.id}">加入发布队列</button></div></div>`).join('') || empty('暂无内容'))
    document.querySelectorAll('[data-queue-publish]').forEach((button) => button.addEventListener('click', () => queuePublish(button.dataset.queuePublish)))
  } else if (active === 'schedule') {
    const scheduled = data.content.filter(x => x.scheduled_at).sort((a,b) => new Date(a.scheduled_at)-new Date(b.scheduled_at))
    const available = data.content.filter(x => !x.scheduled_at)
    view.innerHTML = `<div class="page-intro"><span class="eyebrow dark-eyebrow">PUBLISH PLANNER</span><h1>发布计划</h1><p>安排已保存内容的发布时间。保存计划不代表平台已经自动发布，自动发布还需要平台授权与后台任务支持。</p></div><div class="card"><h3>安排新计划</h3><form id="scheduleForm" class="form"><label>选择内容<select id="scheduleContent" required>${available.map(x => `<option value="${esc(x.id)}">${esc(x.title || '未命名内容')}</option>`).join('')}</select></label><label>发布时间<input id="scheduleTime" type="datetime-local" required></label><button type="submit" ${available.length ? '' : 'disabled'}>保存计划</button><div id="scheduleMsg" role="status"></div></form>${available.length ? '' : '<p class="muted">没有未排期内容，请先创建内容。</p>'}</div><div class="section-heading"><div><span class="eyebrow dark-eyebrow">UPCOMING</span><h2>已安排内容</h2></div></div><div class="card">${scheduled.map(x => `<div class="post-record"><div class="post-record-main"><b>${esc(x.title || '未命名内容')}</b><small>${new Date(x.scheduled_at).toLocaleString()} · ${esc(x.status || '草稿')}</small></div><button class="secondary" data-unschedule="${esc(x.id)}">取消排期</button></div>`).join('') || empty('暂无发布计划。')}</div>`
    $('#scheduleForm')?.addEventListener('submit', async e => { e.preventDefault(); const id=$('#scheduleContent').value, when=$('#scheduleTime').value, msg=$('#scheduleMsg'); const time=new Date(when); if(!id || !when || Number.isNaN(time.getTime()) || time.getTime()<=Date.now()){msg.textContent='请选择有效的未来时间。';return} const btn=e.submitter; btn.disabled=true; msg.textContent='正在保存…'; try { const {error}=await supabase.from('content_items').update({scheduled_at:time.toISOString()}).eq('id',id).eq('user_id',user.id); if(error) throw error; await load() } catch(err) { msg.textContent='保存失败：'+err.message } finally { btn.disabled=false } })
    document.querySelectorAll('[data-unschedule]').forEach(button => button.addEventListener('click', async () => { if(!confirm('确定取消排期？内容不会被删除。')) return; button.disabled=true; try { const {error}=await supabase.from('content_items').update({scheduled_at:null}).eq('id',button.dataset.unschedule).eq('user_id',user.id); if(error) throw error; await load() } catch(err) { alert('取消失败：'+err.message); button.disabled=false } }))
  } else if (active === 'accounts') {
    view.innerHTML = card('账号接入', `<div class="accounts">${['xiaohongshu', 'douyin'].map((platform) => {
      const account=data.accounts.find(x=>x.platform===platform && x.status==='connected')
      const name=platform==='douyin'?'抖音':'小红书'
      return `<div class="account"><b>${name}</b><span>${account ? `已连接：${esc(account.account_name || '')}` : '未连接'}</span>${platform==='douyin' ? `<button data-oauth="douyin">🔐 授权连接</button>` : `<button data-oauth="xiaohongshu">查看接入配置</button>`}</div>`
    }).join('')}</div><p class="muted">抖音走官方 OAuth + 官方视频发布接口；小红书本版本不伪造“模拟发布”，等你提供已审核的官方开放平台应用参数后启用真实适配器。</p>`)
    document.querySelectorAll('[data-oauth]').forEach((button) => button.addEventListener('click', () => startOAuth(button.dataset.oauth)))
  } else if (active === 'tasks') {
    view.innerHTML = card('云端定时任务', `
      <div class="toolbar"><button id="runNowBtn">▶ 立即运行自动化</button><button id="seedTasksBtn" class="secondary">创建默认自动任务</button></div>
      ${data.tasks.map((x) => `<div class="row"><div><b>${esc(x.name)}</b><small>${esc(x.task_type)} · ${esc(x.cron_expression || '')}</small></div><span>${x.enabled ? '运行中' : '已暂停'}</span></div>`).join('') || empty('暂无任务')}`)
    $('#runNowBtn').addEventListener('click', runAutomationNow)
    $('#seedTasksBtn').addEventListener('click', seedAutomationTasks)
  } else {
    view.innerHTML = card('运行日志', data.logs.map((x) => `<div class="log"><span>${new Date(x.created_at).toLocaleString()}</span><b>${esc(x.level)}</b><p>${esc(x.message)}</p></div>`).join('') || empty('暂无日志'))
  }

  document.querySelectorAll('[data-workflow]').forEach((button) => button.addEventListener('click', () => { active = button.dataset.workflow; render() }))
  bindForms()
}


function renderStudio(view) {
  view.innerHTML = `
    <div class="page-intro"><span class="eyebrow dark-eyebrow">CREATOR STUDIO</span><h1>创作者台</h1><p>从选题、文案到素材和发布，集中完成每一步创作。</p></div>
    <div class="studio-hero"><div><span class="studio-kicker">TODAY'S WORKSPACE</span><h2>今天准备创作什么？</h2><p>先选方向，再完成内容，最后安排发布。</p><div class="studio-actions"><button id="studioStartAI">✦ AI 生成文案</button><button id="studioBrowseHot" class="secondary">查看热门选题</button></div></div><div class="studio-symbol">✳</div></div>
    <div class="studio-step-grid">
      <button class="studio-step" data-studio-go="hot"><span>01 · 选题</span><b>发现热门方向</b><small>查看已收集热点与样本趋势</small><i>↗</i></button>
      <button class="studio-step" data-studio-go="ai"><span>02 · 创作</span><b>生成标题和正文</b><small>按平台和语气制作内容</small><i>↗</i></button>
      <button class="studio-step" data-studio-go="materials"><span>03 · 素材</span><b>管理创作素材</b><small>查看上传的视频、图片与音频</small><i>↗</i></button>
      <button class="studio-step" data-studio-go="schedule"><span>04 · 发布</span><b>安排发布计划</b><small>将内容加入发布队列</small><i>↗</i></button>
    </div>
    <div class="section-heading"><div><span class="eyebrow dark-eyebrow">RECENT CONTENT</span><h2>最近创作</h2></div><button class="text-button" id="studioAllPosts">查看全部 ↗</button></div>
    <div class="card studio-recent">${data.content.slice(0,6).map(x=>`<div class="post-record"><div class="post-platform">${esc((x.platform||'文').slice(0,1).toUpperCase())}</div><div class="post-record-main"><b>${esc(x.title||'未命名内容')}</b><small>${esc(x.platform||'未指定平台')} · ${esc(x.status||'草稿')} · ${x.created_at?new Date(x.created_at).toLocaleString():'时间未记录'}</small></div><button class="secondary" data-studio-edit="${esc(x.id)}">继续处理</button></div>`).join('')||empty('还没有内容，先创建第一条文案。')}</div>`
  $('#studioStartAI').addEventListener('click',()=>{active='ai';render()})
  $('#studioBrowseHot').addEventListener('click',()=>{active='hot';render()})
  $('#studioAllPosts').addEventListener('click',()=>{active='posts';render()})
  document.querySelectorAll('[data-studio-go]').forEach(b=>b.addEventListener('click',()=>{active=b.dataset.studioGo;render()}))
  document.querySelectorAll('[data-studio-edit]').forEach(b=>b.addEventListener('click',()=>{active='posts';render()}))
}

function renderAIStudio(view) {
  view.innerHTML = `
    <div class="page-intro"><span class="eyebrow dark-eyebrow">AI CREATION</span><h1>AI 助手</h1><p>生成原创内容草稿，保存后可继续编辑、安排发布。需要配置可用的 AI 服务密钥。</p></div>
    <div class="ai-studio-layout"><div class="card"><div class="ai-title"><span class="ai-avatar">✦</span><div><h3>内容创作助手</h3><small>根据主题生成社交媒体内容</small></div></div><form id="aiStudioForm" class="form">
      <label>创作主题<input id="aiStudioTopic" placeholder="例如：新手如何挑选适合自己的相机" required></label>
      <div class="studio-form-row"><label>发布平台<select id="aiStudioPlatform"><option value="all">通用</option><option value="xiaohongshu">小红书</option><option value="douyin">抖音</option></select></label><label>内容类型<select id="aiStudioType"><option>实用教程</option><option>种草分享</option><option>口播脚本</option><option>热点评论</option><option>故事分享</option></select></label></div>
      <div class="studio-form-row"><label>表达风格<select id="aiStudioTone"><option>自然、有网感</option><option>专业可信</option><option>轻松幽默</option><option>观点鲜明</option></select></label><label>篇幅<select id="aiStudioLength"><option>中等</option><option>简短</option><option>详细</option></select></label></div>
      <label>补充要求<textarea id="aiStudioNotes" rows="4" placeholder="受众、重点、需要避开的内容……"></textarea></label>
      <button type="submit" id="aiStudioSubmit">生成内容草稿</button><div id="aiStudioMsg" role="status"></div>
    </form></div><div class="card ai-side-card"><h3>创作小建议</h3><div class="ai-tip"><b>先明确目标</b><p>说明内容要解决的问题，以及希望读者看完后做什么。</p></div><div class="ai-tip"><b>加入真实细节</b><p>补充自己的经历、产品信息或实际素材，避免空泛表达。</p></div><div class="ai-tip"><b>发布前检查</b><p>确认事实、版权、平台规范和素材授权。</p></div><button id="aiStudioTemplates" class="secondary">浏览创作模板</button></div></div>`
  $('#aiStudioTemplates').addEventListener('click',()=>{active='templates';render()})
  $('#aiStudioForm').addEventListener('submit',e=>{
    e.preventDefault()
    const topic=$('#aiStudioTopic').value.trim()
    const platform=$('#aiStudioPlatform').value
    const type=$('#aiStudioType').value
    const tone=$('#aiStudioTone').value
    const length=$('#aiStudioLength').value
    const notes=$('#aiStudioNotes').value.trim()
    active='create';render()
    if($('#ctitle')) $('#ctitle').value=topic
    if($('#platform')) $('#platform').value=platform
    if($('#tone')) $('#tone').value=tone
    if($('#length')) $('#length').value=length
    if($('#body')) $('#body').value=[type,notes].filter(Boolean).join('。')
    const result=$('#aiResult')
    if(result) result.textContent='主题和创作要求已带入 AI 写文案页面。点击“AI 真正生成”开始生成。'
  })
}

async function renderMaterials(view) {
  view.innerHTML = `
    <div class="page-intro"><span class="eyebrow dark-eyebrow">ASSET LIBRARY</span><h1>素材库</h1><p>集中管理你上传的创作素材。文件保存在当前账号对应的存储空间中。</p></div>
    <div class="card"><h3>上传新素材</h3><p class="muted">支持图片、视频和音频。单个文件最大 1GB；请只上传自己拥有或获授权使用的内容。</p><form id="materialsUploadForm" class="materials-upload"><input id="materialsFiles" type="file" accept="image/*,video/*,audio/*" multiple required><button id="materialsUploadBtn" type="submit">上传所选素材</button><span id="materialsUploadMsg" role="status"></span></form></div>
    <div class="section-heading"><div><span class="eyebrow dark-eyebrow">YOUR ASSETS</span><h2>已上传素材</h2></div><button id="materialsRefresh" class="secondary">刷新</button></div>
    <div id="materialsGrid" class="materials-grid"><div class="empty">正在读取素材库…</div></div>`
  $('#materialsRefresh').addEventListener('click',()=>loadMaterialsList())
  $('#materialsUploadForm').addEventListener('submit',uploadMaterials)
  await loadMaterialsList()
}

async function loadMaterialsList() {
  const grid=$('#materialsGrid'); if(!grid)return
  grid.innerHTML=empty('正在读取素材库…')
  try{
    const response=await apiFetch('/api/video/assets')
    const payload=await response.json()
    if(!response.ok)throw new Error(payload.error||'读取素材失败')
    const assets=payload.data||[]
    if(!assets.length){grid.innerHTML=empty('素材库还是空的。上传视频、图片或音频后会显示在这里。');return}
    grid.innerHTML=assets.map(a=>{
      const kind=String(a.mime_type||'').startsWith('video/')?'视频':String(a.mime_type||'').startsWith('image/')?'图片':String(a.mime_type||'').startsWith('audio/')?'音频':'文件'
      return `<article class="material-card"><div class="material-preview">${kind==='图片'?'<span>▧</span>':kind==='视频'?'<span>▶</span>':kind==='音频'?'<span>♫</span>':'<span>▤</span>'}</div><div class="material-info"><b title="${esc(a.file_name)}">${esc(a.file_name||'未命名素材')}</b><small>${kind} · ${(Number(a.size_bytes||0)/1024/1024).toFixed(1)} MB</small><small>${a.created_at?new Date(a.created_at).toLocaleString():'时间未记录'}</small></div></article>`
    }).join('')
  }catch(e){grid.innerHTML=`<div class="notice">暂时无法读取素材列表：${esc(e.message)}。请确认服务端素材接口和 publish-media 存储桶已配置。</div>`}
}

async function uploadMaterials(event) {
  event.preventDefault()
  const files=[...($('#materialsFiles').files||[])],msg=$('#materialsUploadMsg'),btn=$('#materialsUploadBtn')
  if(!files.length)return
  if(files.some(f=>f.size>1024*1024*1024)){msg.textContent='单个文件不能超过 1GB';return}
  btn.disabled=true;msg.textContent='正在上传…'
  try{
    for(const file of files){
      const folder=file.type.startsWith('video/')?'videos':file.type.startsWith('audio/')?'music':'references'
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)
      const storagePath=user.id+'/'+folder+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safeName
      const {error}=await supabase.storage.from('publish-media').upload(storagePath,file,{upsert:false,contentType:file.type})
      if(error)throw error
      const response=await apiFetch('/api/video/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storagePath,fileName:file.name,mimeType:file.type,sizeBytes:file.size})})
      const payload=await response.json()
      if(!response.ok)throw new Error(payload.error||'素材登记失败')
    }
    $('#materialsFiles').value='';msg.textContent='上传完成。';await loadMaterialsList()
  }catch(e){msg.textContent='上传失败：'+e.message}
  finally{btn.disabled=false}
}


function renderRadar(view) {
  const byVideo = new Map()
  for (const row of data.radar) {
    if (!byVideo.has(row.video_key)) byVideo.set(row.video_key, [])
    byVideo.get(row.video_key).push(row)
  }
  const videos = [...byVideo.values()].map(rows => {
    const latest=rows[0], previous=rows.find(r=>new Date(r.snapshot_at)<new Date(latest.snapshot_at))
    const hours=previous?Math.max((new Date(latest.snapshot_at)-new Date(previous.snapshot_at))/3600000,0.01):0
    return {...latest, historyCount:rows.length, previous, hourly:previous?Math.max(0,(Number(latest.views||0)-Number(previous.views||0))/hours):null}
  }).filter(v=>radarCategory==='全部赛道'||v.category===radarCategory)
  const stats=new Map()
  videos.forEach(v=>{
    const c=stats.get(v.category)||{category:v.category,count:0,views:0,likes:0,comments:0,shares:0,hourly:0,tracked:0}
    c.count++; ['views','likes','comments','shares'].forEach(k=>c[k]+=Number(v[k]||0))
    if(v.hourly!==null){c.hourly+=v.hourly;c.tracked++} stats.set(v.category,c)
  })
  const ranked=[...stats.values()].sort((a,b)=>(b.tracked?b.hourly/b.tracked:-1)-(a.tracked?a.hourly/a.tracked:-1))
  const n=v=>Number(v||0).toLocaleString('zh-CN')
  const selected=data.radarPrefs.watched_categories||['伤感','情感']
  const mode=data.radarPrefs.production_mode||'market'
  const top=(mode==='vertical'?ranked.filter(c=>selected.includes(c.category)):ranked)[0]
  view.innerHTML = '<div class="radar-hero"><div><span class="eyebrow">MEDIABOT · MARKET RADAR</span><h1>🔥 爆款市场雷达</h1><p>先看市场正在升温什么，再决定今天生产什么。</p></div><div class="radar-hero-tag">手动数据模式</div></div>' +
    '<div class="notice">暂未接入抖音官方热点数据。数字只来自你手动录入的公开视频样本，不代表全平台总量；没有来源的数据不会被伪造。</div>' +
    '<div class="radar-stats"><div class="radar-stat"><span>视频样本</span><b>'+n(videos.length)+'</b></div><div class="radar-stat"><span>样本累计播放</span><b>'+n(videos.reduce((a,v)=>a+Number(v.views||0),0))+'</b></div><div class="radar-stat"><span>可计算增速</span><b>'+n(videos.filter(v=>v.hourly!==null).length)+'</b></div><div class="radar-stat"><span>关注赛道</span><b>'+n(selected.length)+'</b></div></div>' +
    '<div class="card"><h3>🎯 关注赛道与生产模式</h3><p class="muted">关注赛道表示你想观察什么，不等于系统必须生产什么。</p><div class="radar-checks">'+radarCategories.map(c=>'<label><input type="checkbox" data-watch-category="'+esc(c)+'" '+(selected.includes(c)?'checked':'')+'> '+esc(c)+'</label>').join('')+'</div><div class="toolbar radar-mode"><label>生产模式 <select id="radarMode"><option value="market" '+(mode==='market'?'selected':'')+'>🚀 爆款跟随模式</option><option value="vertical" '+(mode==='vertical'?'selected':'')+'>🎯 账号垂直模式</option></select></label><button id="saveRadarPrefs">保存偏好</button></div><div class="recommendation"><b>当前样本建议</b><p>'+(top?'增长较快的样本赛道：<strong>'+esc(top.category)+'</strong>':'样本不足。录入视频后，隔一段时间再次记录同一视频的播放量，才能判断增速。')+'</p><small>建议只基于已录入样本，不代表全平台排名。</small></div></div>' +
    '<div class="card"><h3>📈 赛道趋势（样本数据）</h3><div class="toolbar"><label>筛选赛道 <select id="radarCategory">'+['全部赛道',...radarCategories].map(c=>'<option '+(radarCategory===c?'selected':'')+'>'+esc(c)+'</option>').join('')+'</select></label><span class="muted">增长速度根据同一视频的历史快照计算</span></div><div class="table-wrap"><table class="radar-table"><thead><tr><th>赛道</th><th>样本数</th><th>播放</th><th>点赞</th><th>评论</th><th>转发</th><th>平均每小时增播</th></tr></thead><tbody>'+ranked.filter(c=>radarCategory==='全部赛道'||c.category===radarCategory).map(c=>'<tr><td><b>'+esc(c.category)+'</b></td><td>'+n(c.count)+'</td><td>'+n(c.views)+'</td><td>'+n(c.likes)+'</td><td>'+n(c.comments)+'</td><td>'+n(c.shares)+'</td><td>'+(c.tracked?n(Math.round(c.hourly/c.tracked)):'等待第二次记录')+'</td></tr>').join('')+'<tr></tr></tbody></table></div></div>' +
    '<div class="card"><h3>＋ 录入爆款视频 / 更新数据快照</h3><p class="muted">同一条视频重复录入时，请保持链接一致。每次录入都会保存新快照。完播率和留存率仅在真实获得时填写。</p><form id="radarForm" class="form radar-form"><div class="radar-form-grid">'+
    '<label>视频链接 *<input id="rvUrl" type="url" required placeholder="https://..."></label><label>视频标题 *<input id="rvTitle" required placeholder="填写视频标题"></label><label>内容赛道 *<select id="rvCategory">'+radarCategories.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label><label>作者名称<input id="rvCreator" placeholder="可选"></label><label>发布时间<input id="rvPublished" type="datetime-local"></label><label>播放量 *<input id="rvViews" type="number" min="0" value="0" required></label><label>点赞量<input id="rvLikes" type="number" min="0" value="0"></label><label>评论量<input id="rvComments" type="number" min="0" value="0"></label><label>转发量<input id="rvShares" type="number" min="0" value="0"></label><label>收藏量<input id="rvFavorites" type="number" min="0" value="0"></label></div><details><summary>可选：账号后台观看数据</summary><div class="radar-form-grid extra-fields"><label>平均观看时长（秒）<input id="rvAvgWatch" type="number" min="0" step="0.1"></label><label>完播率（%）<input id="rvCompletion" type="number" min="0" max="100" step="0.1"></label><label>3秒留存率（%）<input id="rvRetention3" type="number" min="0" max="100" step="0.1"></label><label>5秒留存率（%）<input id="rvRetention5" type="number" min="0" max="100" step="0.1"></label><label>10秒留存率（%）<input id="rvRetention10" type="number" min="0" max="100" step="0.1"></label></div></details><label>备注<textarea id="rvNotes" rows="2" placeholder="数据来源或视频特点（可选）"></textarea></label><button id="saveRadarVideo" type="submit">保存本次快照</button><div id="radarFormMsg" role="status"></div></form></div>' +
    '<div class="card"><h3>🎬 已录入视频</h3><div class="table-wrap"><table class="radar-table"><thead><tr><th>视频 / 赛道</th><th>播放</th><th>点赞</th><th>发布时间</th><th>样本增速</th><th>记录次数</th><th>最后记录</th></tr></thead><tbody>'+videos.map(v=>'<tr><td><a href="'+esc(v.video_url)+'" target="_blank" rel="noopener noreferrer">'+esc(v.title)+'</a><small>'+esc(v.category)+' · '+esc(v.creator_name||'作者未填')+'</small></td><td>'+n(v.views)+'</td><td>'+n(v.likes)+'</td><td>'+(v.published_at?new Date(v.published_at).toLocaleString():'未填写')+'</td><td>'+(v.hourly===null?'等待第二次记录':n(Math.round(v.hourly))+'/小时')+'</td><td>'+v.historyCount+'</td><td>'+new Date(v.snapshot_at).toLocaleString()+'</td></tr>').join('')+'<tr></tr></tbody></table></div></div>'
  $('#radarCategory').addEventListener('change',e=>{radarCategory=e.target.value;render()})
  $('#saveRadarPrefs').addEventListener('click',saveRadarPreferences)
  $('#radarForm').addEventListener('submit',saveRadarSnapshot)
}

async function renderRemixLab(view) {
  view.innerHTML = `
    <div class="remix-hero">
      <div><span class="eyebrow">MEDIABOT · VIDEO REMIX</span><h1>🎬 自动剪辑实验室</h1><p>提供爆款参考和自己的视频素材，AI分析镜头后自动筛选、剪辑并合成新视频。不生成AI视频画面。</p></div>
      <div class="radar-hero-tag">素材由你提供</div>
    </div>
    <div class="notice">建议上传你有权使用的爆款参考视频，系统会分析抽样画面与语音内容；仅粘贴链接时，若平台限制访问，系统不会假装已经看过。最终成片只使用你的自有素材。</div>
    <div class="card">
      <h3>① 上传素材并选择分类</h3>
      <p class="muted">可批量上传视频，另可上传爆款截图和多首已获授权的背景音乐。系统会根据剪辑情绪和音乐文件名线索自动挑选；建议将音乐命名为“悬疑_紧张.mp3”“治愈_温暖.mp3”等。视频用于剪辑，截图只用于参考分析。</p>
      <div class="remix-upload-grid">
        <label>视频素材（可多选）<input id="remixVideoFiles" type="file" accept="video/*" multiple></label>
        <label>爆款参考视频（可选）<input id="remixReferenceVideo" type="file" accept="video/*"></label>
        <label>爆款参考截图（可选）<input id="remixReferenceImage" type="file" accept="image/*"></label>
        <label>背景音乐（可选）<input id="remixMusicFile" type="file" accept="audio/*"></label>
      </div>
      <button id="uploadRemixFiles">上传所选文件</button><span id="remixUploadMsg" class="muted"></span>
    </div>
    <div class="card">
      <h3>② 告诉 AI 你要参考哪条爆款</h3>
      <form id="remixForm" class="form">
        <label>内容分类<select id="remixCategory"><option>搞笑</option><option>情感</option><option>知识</option><option>美食</option><option>生活</option><option>影视</option><option>宠物</option><option>汽车</option><option>游戏</option><option>其他</option></select></label>
        <label>爆款视频链接（可选）<input id="remixReferenceUrl" type="url" placeholder="粘贴抖音视频链接"></label>
        <label>爆款内容说明（建议填写）<textarea id="remixReferenceNotes" rows="3" placeholder="例如：开头是反转，前半段制造悬念，结尾有情绪释放。链接无法读取时，说明越具体越好。"></textarea></label>
        <div><b>选择要参与剪辑的视频素材</b><div id="remixAssetList" class="remix-asset-list"><div class="empty">正在读取素材库…</div></div></div>
        <label>背景音乐 <select id="remixMusicChoice"><option value="">不额外添加音乐，保留原片声音</option></select></label>
        <label>参考截图 <select id="remixImageChoice"><option value="">不使用参考截图</option></select></label>
        <label>已上传的参考视频 <select id="remixReferenceVideoChoice"><option value="">不使用参考视频</option></select></label>
        <button id="startRemixBtn" type="submit">✨ 一键上传、分析并自动剪辑</button>
        <div id="remixJobStatus" role="status"></div>
      </form>
    </div>
    <div class="card"><h3>③ 最近生成的成片</h3><div id="remixRecent"><div class="empty">尚无剪辑记录</div></div></div>`
  $('#uploadRemixFiles').addEventListener('click', uploadRemixFiles)
  $('#remixForm').addEventListener('submit', startRemixJob)
  await refreshRemixAssets()
  await refreshRecentRemixes()
}

async function uploadRemixFiles({ quiet = false } = {}) {
  const button=$('#uploadRemixFiles'),msg=$('#remixUploadMsg')
  const uploaded={videoIds:[],referenceVideoId:'',imageId:'',musicId:''}
  const videoFiles=[...($('#remixVideoFiles').files||[])], referenceVideoFile=$('#remixReferenceVideo')?.files?.[0], imageFile=$('#remixReferenceImage').files?.[0], musicFile=$('#remixMusicFile').files?.[0]
  const files=[...videoFiles,...(referenceVideoFile?[referenceVideoFile]:[]),...(imageFile?[imageFile]:[]),...(musicFile?[musicFile]:[])]
  if(!files.length) { if(!quiet) msg.textContent='没有新文件，将使用已上传的素材'; return uploaded }
  if(files.some(f=>f.size>1024*1024*1024)) { const error=new Error('单个文件不能超过1GB'); if(quiet) throw error; msg.textContent=error.message; return uploaded }
  if(button) {button.disabled=true;button.textContent='上传中…'} msg.textContent=''
  try {
    for(const file of files) {
      const folder=file===referenceVideoFile?'references':file.type.startsWith('video/')?'videos':file.type.startsWith('audio/')?'music':'references'
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)
      const storagePath=user.id+'/'+folder+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safeName
      const {error:uploadError}=await supabase.storage.from('publish-media').upload(storagePath,file,{upsert:false,contentType:file.type})
      if(uploadError) throw uploadError
      const response=await apiFetch('/api/video/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storagePath,fileName:file.name,mimeType:file.type,sizeBytes:file.size})})
      const result=await response.json()
      if(!response.ok) throw new Error(result.error||'素材登记失败')
      const id=result.data?.id
      if(file===referenceVideoFile) uploaded.referenceVideoId=id||''
      else if(videoFiles.includes(file)) {if(id) uploaded.videoIds.push(id)}
      else if(file===imageFile) uploaded.imageId=id||''
      else if(file===musicFile) uploaded.musicId=id||''
    }
    $('#remixVideoFiles').value='';if($('#remixReferenceVideo')) $('#remixReferenceVideo').value='';$('#remixReferenceImage').value='';$('#remixMusicFile').value=''
    msg.textContent='上传成功。'
    await refreshRemixAssets()
    return uploaded
  } catch(e) { msg.textContent='上传失败：'+e.message;msg.className='error'; if(quiet) throw e }
  finally { if(button) {button.disabled=false;button.textContent='上传所选文件'} }
}

async function refreshRemixAssets() {
  const box=$('#remixAssetList')
  if(!box) return
  try {
    const response=await apiFetch('/api/video/assets')
    const payload=await response.json()
    if(!response.ok) throw new Error(payload.error||'读取素材失败')
    const assets=payload.data||[]
    const videos=assets.filter(a=>String(a.mime_type).startsWith('video/') && !String(a.storage_path).includes('/references/'))
    const referenceVideos=assets.filter(a=>String(a.mime_type).startsWith('video/') && String(a.storage_path).includes('/references/'))
    const audios=assets.filter(a=>String(a.mime_type).startsWith('audio/'))
    const images=assets.filter(a=>String(a.mime_type).startsWith('image/'))
    box.innerHTML=videos.length?videos.map(a=>'<label class="remix-asset"><input type="checkbox" data-remix-asset="'+esc(a.id)+'"><span><b>'+esc(a.file_name)+'</b><small>'+(Number(a.size_bytes)/1024/1024).toFixed(1)+' MB · '+new Date(a.created_at).toLocaleString()+'</small></span></label>').join(''):empty('先上传你自己的视频素材')
    const music=$('#remixMusicChoice'),image=$('#remixImageChoice')
    const referenceVideo=$('#remixReferenceVideoChoice')
    if(referenceVideo) referenceVideo.innerHTML='<option value="">不使用已上传参考视频</option>'+referenceVideos.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.file_name)+'</option>').join('')
    music.innerHTML='<option value="auto">AI自动选择音乐库中最匹配的一首</option><option value="">不额外添加音乐，保留原片声音</option>'+audios.map(a=>'<option value="'+esc(a.id)+'">手动指定：'+esc(a.file_name)+'</option>').join('')
    image.innerHTML='<option value="">不使用参考截图</option>'+images.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.file_name)+'</option>').join('')
  } catch(e) { box.innerHTML='<div class="error">'+esc(e.message)+'</div>' }
}

async function startRemixJob(event) {
  event.preventDefault()
  const button=$('#startRemixBtn'),status=$('#remixJobStatus')
  button.disabled=true;button.textContent='上传素材并开始分析…';status.textContent='正在准备素材，然后自动分析画面、规划剪辑并生成成片。'
  try {
    const uploaded=await uploadRemixFiles({quiet:true})
    const assetIds=uploaded.videoIds.length?uploaded.videoIds:[...document.querySelectorAll('[data-remix-asset]:checked')].map(x=>x.dataset.remixAsset)
    if(!assetIds.length) throw new Error('请先选择或上传至少一个自己的视频素材')
    const category=$('#remixCategory')?.value||'其他'
    const notes='内容分类：'+category+'。'+($('#remixReferenceNotes').value.trim()||'')
    const response=await apiFetch('/api/video/remix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetIds,referenceUrl:$('#remixReferenceUrl').value.trim(),referenceNotes:notes,musicAssetId:uploaded.musicId||$('#remixMusicChoice').value,referenceImageAssetId:uploaded.imageId||$('#remixImageChoice').value,referenceVideoAssetId:uploaded.referenceVideoId||$('#remixReferenceVideoChoice')?.value||''})})
    const payload=await response.json()
    if(!response.ok) throw new Error(payload.error||'创建剪辑任务失败')
    status.textContent='任务已开始。后台正在分析镜头并合成视频…'
    await pollRemixJob(payload.job.id)
  } catch(e) { status.innerHTML='<div class="error">'+esc(e.message)+'</div>' }
  finally { button.disabled=false;button.textContent='✨ 一键上传、分析并自动剪辑' }
}

async function pollRemixJob(id) {
  const status=$('#remixJobStatus')
  const started=Date.now()
  while(Date.now()-started<20*60*1000) {
    await new Promise(resolve=>setTimeout(resolve,3000))
    const response=await apiFetch('/api/video/remix/'+encodeURIComponent(id))
    const payload=await response.json()
    if(!response.ok) throw new Error(payload.error||'读取剪辑任务失败')
    const job=payload.job
    if(job.status==='completed') {
      const plan=job.edit_plan||{}
      status.innerHTML='<div class="remix-result"><h4>成片已生成：'+esc(plan.title||'自动剪辑视频')+'</h4><p>时长：'+esc(plan.durationSeconds||'-')+' 秒 · '+(plan.musicApplied?'已混入配乐：'+esc(plan.selectedMusicName||'自动选择'):'未额外添加音乐')+'</p>'+(plan.hook?'<p>开头思路：'+esc(plan.hook)+'</p>':'')+(job.output_url?'<video controls playsinline src="'+esc(job.output_url)+'"></video><p><a href="'+esc(job.output_url)+'" target="_blank" rel="noopener noreferrer">打开 / 保存成片</a></p>':'<p>成片已保存，但暂时无法生成预览链接。</p>')+'<details><summary>查看剪辑方案</summary><pre>'+esc(JSON.stringify(plan,null,2))+'</pre></details>'+(job.content_id?'<button data-remix-queue="'+esc(job.content_id)+'">加入发布队列</button>':'')+'<p class="muted">'+esc(plan.disclaimer||'')+'</p></div>'
      status.querySelectorAll('[data-remix-queue]').forEach(b=>b.addEventListener('click',()=>queuePublish(b.dataset.remixQueue)))
      await refreshRecentRemixes()
      return
    }
    if(job.status==='failed') throw new Error(job.error_message||'自动剪辑失败')
    status.textContent=job.status==='rendering'?'正在合成视频…':'正在分析爆款参考与素材关键帧…'
  }
  throw new Error('任务仍在后台运行；可稍后刷新页面，在最近生成的成片中查看结果。')
}

async function refreshRecentRemixes() {
  const box=$('#remixRecent')
  if(!box) return
  try {
    const {data,error}=await supabase.from('video_remix_jobs').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(10)
    if(error) throw error
    box.innerHTML=(data||[]).length?(data||[]).map(j=>'<div class="row"><div><b>'+esc(j.edit_plan?.title||'自动剪辑任务')+'</b><small>'+new Date(j.created_at).toLocaleString()+' · '+esc(j.status)+'</small>'+(j.error_message?'<small class="error">'+esc(j.error_message)+'</small>':'')+'</div>'+(j.status==='completed'?'<button data-open-remix="'+esc(j.id)+'">查看成片</button>'+(j.content_id?'<button data-queue-publish="'+esc(j.content_id)+'">加入发布队列</button>':''):'')+'</div>').join(''):empty('尚无剪辑记录')
    box.querySelectorAll('[data-queue-publish]').forEach(button=>button.addEventListener('click',()=>queuePublish(button.dataset.queuePublish)))
    box.querySelectorAll('[data-open-remix]').forEach(button=>button.addEventListener('click',async()=>{
      try { const r=await apiFetch('/api/video/remix/'+encodeURIComponent(button.dataset.openRemix));const p=await r.json();if(!r.ok)throw new Error(p.error||'读取失败');const j=p.job;const plan=j.edit_plan||{};const status=$('#remixJobStatus');status.innerHTML='<div class="remix-result"><h4>'+esc(plan.title||'自动剪辑视频')+'</h4>'+(j.output_url?'<video controls playsinline src="'+esc(j.output_url)+'"></video><p><a href="'+esc(j.output_url)+'" target="_blank" rel="noopener noreferrer">打开 / 保存成片</a></p>':'')+'<pre>'+esc(JSON.stringify(plan,null,2))+'</pre></div>' } catch(e) { alert(e.message) }
    }))
  } catch(e) { box.innerHTML='<div class="error">'+esc(e.message)+'</div>' }
}

async function saveRadarPreferences() {
  try {
    const watchedCategories=[...document.querySelectorAll('[data-watch-category]:checked')].map(x=>x.dataset.watchCategory)
    const {error}=await supabase.from('radar_preferences').upsert({user_id:user.id,watched_categories:watchedCategories,production_mode:$('#radarMode').value,updated_at:new Date().toISOString()},{onConflict:'user_id'})
    if(error) throw error
    await load(); alert('雷达偏好已保存')
  } catch(e) { alert('保存失败：'+e.message) }
}

async function saveRadarSnapshot(event) {
  event.preventDefault()
  const button=$('#saveRadarVideo'),msg=$('#radarFormMsg'),val=id=>$('#'+id)?.value??''
  button.disabled=true;button.textContent='保存中…';msg.textContent=''
  try {
    const payload={videoUrl:val('rvUrl').trim(),title:val('rvTitle').trim(),category:val('rvCategory'),creatorName:val('rvCreator').trim(),publishedAt:val('rvPublished')?new Date(val('rvPublished')).toISOString():null,views:val('rvViews'),likes:val('rvLikes'),comments:val('rvComments'),shares:val('rvShares'),favorites:val('rvFavorites'),avgWatchSeconds:val('rvAvgWatch'),completionRate:val('rvCompletion'),retention3s:val('rvRetention3'),retention5s:val('rvRetention5'),retention10s:val('rvRetention10'),notes:val('rvNotes')}
    const response=await apiFetch('/api/radar/snapshots',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
    const result=await response.json()
    if(!response.ok) throw new Error(result.error||'保存失败')
    msg.textContent='已保存。稍后再次录入同一视频，即可计算增速。'
    $('#radarForm').reset()
    await load()
  } catch(e) { msg.textContent='保存失败：'+e.message;msg.className='error' }
  finally { button.disabled=false;button.textContent='保存本次快照' }
}

function bindForms() {
  const form = $('#contentForm')
  if (!form) return
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = $('#generateBtn')
    const result = $('#aiResult')
    button.disabled = true
    button.textContent = 'AI 正在生成…'
    result.innerHTML = ''
    try {
      const response = await apiFetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: $('#ctitle').value.trim(),
          platform: $('#platform').value,
          tone: $('#tone').value,
          length: $('#length').value,
          requirements: $('#body').value,
          mediaUrls: await uploadMediaIfAny()
        })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'AI 生成失败')
      result.innerHTML = `<div class="ai-preview"><b>生成成功：${esc(payload.result.title || $('#ctitle').value)}</b><div class="score">${payload.result.ai_score ?? '-'} 分</div><p>${esc($('#platform').value === 'douyin' ? payload.result.douyin : payload.result.xiaohongshu)}</p><small>${(payload.result.hashtags || []).map((tag) => `#${esc(tag)}`).join(' ')}</small></div>`
      await load()
    } catch (error) {
      result.innerHTML = `<div class="error">${esc(error.message)}</div>`
    } finally {
      button.disabled = false
      button.textContent = '✨ AI 真正生成'
    }
  })
}

async function uploadMediaIfAny() {
  const file=$('#mediaFile')?.files?.[0]
  if(!file) return []
  if(!user) throw new Error('请先登录')
  if(file.size>128*1024*1024) throw new Error('视频不能超过 128MB')
  const path=`${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`
  const {error}=await supabase.storage.from('publish-media').upload(path,file,{upsert:false,contentType:file.type})
  if(error) throw error
  return [path]
}

async function fetchRealHot(){
  try{ const r=await apiFetch('/api/hot-topics/fetch-now',{method:'POST'}); const p=await r.json(); if(!r.ok) throw new Error(p.error||'抓取失败'); alert(`真实热点抓取 ${p.result?.fetched??0} 条，新增 ${p.result?.inserted??0} 条，AI 已评分 ${p.scored?.scored??0} 条`); await load() }catch(e){alert(e.message)}
}
async function scoreHot(){
  try{ const r=await apiFetch('/api/hot-topics/fetch-now',{method:'POST'}); const p=await r.json(); if(!r.ok) throw new Error(p.error||'评分失败'); alert(`已处理热点：新增 ${p.result?.inserted??0}，AI 评分 ${p.scored?.scored??0}`); await load() }catch(e){alert(e.message)}
}
async function startOAuth(platform){
  if(platform==='xiaohongshu') return alert('小红书真实发布需要官方开放平台应用审核通过后的 Client ID/Secret 与发布权限。v7 已预留安全适配器。')
  try{ const r=await apiFetch('/api/oauth/douyin/start',{method:'POST'}); const p=await r.json(); if(!r.ok) throw new Error(p.error||'OAuth 启动失败'); window.location.href=p.url }catch(e){alert(e.message)}
}

function goCreate() {
  active = 'create'
  render()
}

async function addDemoHot() {
  try {
    const response = await apiFetch('/api/hot-topics/demo-score', { method: 'POST' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || '热点写入失败')
    await load()
  } catch (error) {
    alert(error.message)
  }
}

async function runAutomationNow() {
  try {
    const response = await apiFetch('/api/automation/run-now', { method: 'POST' })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || '自动化执行失败')
    alert(`自动化完成：执行 ${payload.due ?? 0} 个任务`)
    await load()
  } catch (error) {
    alert(error.message)
  }
}

async function seedAutomationTasks() {
  try {
    const rows = [
      { user_id: user.id, name: '自动抓取热点', task_type: 'hot_fetch', cron_expression: '0 * * * *', next_run_at: new Date().toISOString(), enabled: true, config: {} },
      { user_id: user.id, name: 'AI 热点评分', task_type: 'ai_score', cron_expression: '10 * * * *', next_run_at: new Date().toISOString(), enabled: true, config: { limit: 8 } },
      { user_id: user.id, name: 'AI 自动生成内容', task_type: 'generate', cron_expression: '20 * * * *', next_run_at: new Date().toISOString(), enabled: true, config: { min_score: 80, limit: 3 } },
      { user_id: user.id, name: '发布队列执行', task_type: 'publish', cron_expression: '*/15 * * * *', next_run_at: new Date().toISOString(), enabled: true, config: { limit: 5 } }
    ]
    const { error } = await supabase.from('scheduled_tasks').insert(rows)
    if (error) throw error
    alert('默认自动任务已创建')
    await load()
  } catch (error) {
    alert(error.message)
  }
}

async function queuePublish(contentId){
  const accounts=data.accounts.filter(x=>x.status==='connected')
  if(!accounts.length) return alert('请先连接抖音/小红书账号')
  const labels=accounts.map((a,i)=>`${i+1}. ${a.platform==='douyin'?'抖音':'小红书'} - ${a.account_name||''}`).join('\n')
  const pick=Number(prompt(`选择账号：\n${labels}\n输入序号`))-1
  if(!accounts[pick]) return
  const when=prompt('定时发布时间（可留空，立即进入队列）：\n例如 2026-10-19 20:00')
  let scheduledAt=null
  if(when?.trim()){ const d=new Date(when.replace(' ','T')); if(Number.isNaN(d.getTime())) return alert('时间格式无效'); scheduledAt=d.toISOString() }
  try{ const r=await apiFetch('/api/publish/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contentId,socialAccountId:accounts[pick].id,scheduledAt})}); const p=await r.json(); if(!r.ok) throw new Error(p.error||'加入队列失败'); alert('已加入发布队列。注意：加入队列不等于已发布，最终结果以后台任务状态和平台返回结果为准。'); await load() }catch(e){alert(e.message)}
}

async function addAccount(platform) {
  // A database row is not proof of platform authorization. Never mark an account
  // connected unless the official OAuth callback has completed and tokens are stored.
  try {
    const { error } = await supabase.from('social_accounts').insert({
      user_id: user.id,
      platform,
      account_name: platform === 'douyin' ? '待授权抖音账号' : '待授权小红书账号',
      status: 'pending'
    })
    if (error) throw error
    await load()
    alert('已创建待授权记录。此操作不会连接平台或启用发布；请使用官方授权流程。')
  } catch (error) {
    alert(error.message)
  }
}

function generateHot(topic) {
  active = 'create'
  render()
  $('#ctitle').value = topic
  $('#body').value = '请结合这个热点，给出适合社交媒体传播的原创内容。'
}

function generateFromTopHot() {
  const topic = [...data.hot].sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0))[0]
  if (!topic) return alert('暂无热点')
  generateHot(topic.title)
}

async function login() {
  const email = $('#email').value.trim()
  const password = $('#password').value
  setAuthMessage('登录中…')
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) setAuthMessage(error.message, 'error')
}

async function signup() {
  const email = $('#email').value.trim()
  const password = $('#password').value
  if (password.length < 6) return setAuthMessage('密码至少需要 6 位。', 'error')
  setAuthMessage('注册中…')
  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const emailRedirectTo = isLocal ? undefined : `${window.location.origin}/`
  const { data: result, error } = await supabase.auth.signUp({ email, password, ...(emailRedirectTo ? { options: { emailRedirectTo } } : {}) })
  if (error) return setAuthMessage(error.message, 'error')
  if (result.session) {
    setAuthMessage('注册成功，已自动登录。', 'success')
  } else {
    setAuthMessage(isLocal ? '注册成功。请在手机邮箱中点击验证链接完成验证。验证完成后回到这台电脑，再点击登录。手机上的链接最后可能跳回 localhost，这是本地开发环境的正常现象。' : '注册成功。请检查邮箱完成验证后再登录。', 'success')
  }
}

if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  const note = document.createElement('div')
  note.className = 'muted'
  note.style.marginTop = '10px'
  note.textContent = '本机测试提示：手机可以完成邮箱验证，但验证后不要期待手机打开 localhost。验证完成后回到电脑登录即可。正式上线后会自动使用公网地址。'
  $('#authForm').appendChild(note)
}

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  await login()
})
$('#signup').addEventListener('click', signup)
$('#logout').addEventListener('click', () => supabase.auth.signOut())

supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user || null
  $('#auth').classList.toggle('hidden', Boolean(user))
  $('#logout').classList.toggle('hidden', !user)
  $('#userbox').innerHTML = user ? `<b>${esc(user.email)}</b><small>已登录</small>` : ''
  setTimeout(async () => {
    if (!user) return render()
    try { await load() } catch (error) { $('#view').innerHTML = `<div class="error">数据加载失败：${esc(error.message)}</div>` }
  }, 0)
})

const oauthParams = new URLSearchParams(window.location.search)
if (oauthParams.get('oauth') === 'success') alert(`账号授权成功：${oauthParams.get('platform') || ''}`)
if (oauthParams.get('oauth_error')) alert(`账号授权失败：${oauthParams.get('oauth_error')}`)

currentSession().then((session) => {
  user = session?.user || null
  $('#auth').classList.toggle('hidden', Boolean(user))
  $('#logout').classList.toggle('hidden', !user)
  $('#userbox').innerHTML = user ? `<b>${esc(user.email)}</b><small>已登录</small>` : ''
  if (user) load().catch((error) => { $('#view').innerHTML = `<div class="error">数据加载失败：${esc(error.message)}</div>` })
  else render()
}).catch(() => render())

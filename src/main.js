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
  ['dashboard', 'Dashboard'],
  ['hot', '热点中心'],
  ['create', 'AI 写文案'],
  ['library', '内容库'],
  ['schedule', '发布计划'],
  ['accounts', '账号接入'],
  ['tasks', '云端任务'],
  ['logs', '运行日志']
]

let user = null
let active = 'dashboard'
let data = { hot: [], content: [], tasks: [], logs: [], accounts: [] }

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
      <header>
        <div><b id="title">Dashboard</b><span>内容运营中枢</span></div>
        <button id="logout" class="ghost hidden">退出</button>
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
for (const [id, label] of pages) {
  const button = document.createElement('button')
  button.dataset.page = id
  button.textContent = label
  button.addEventListener('click', () => {
    active = id
    render()
  })
  nav.appendChild(button)
}

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
    supabase.from('social_accounts').select('*').order('created_at', { ascending: false })
  ])
  const failed = results.find((x) => x.error)
  if (failed?.error) throw failed.error
  data = {
    hot: results[0].data || [],
    content: results[1].data || [],
    tasks: results[2].data || [],
    logs: results[3].data || [],
    accounts: results[4].data || []
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
    view.innerHTML = `
      <div class="hero"><div><h1>今天，继续做出好内容。</h1><p>热点 → 评分 → 写作 → 排期 → 发布。</p></div><button id="newContentBtn">+ 新建 AI 内容</button></div>
      <div class="stats">
        ${[['热点', data.hot.length], ['内容', data.content.length], ['任务', data.tasks.filter((x) => x.enabled).length], ['账号', data.accounts.filter((x) => x.status === 'connected').length]].map((x) => `<div class="stat"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('')}
      </div>
      ${card('高分热点', data.hot.slice(0, 5).map((x) => `<div class="row"><div><b>${esc(x.title)}</b><small>${esc(x.source || '')}</small></div><strong>${x.ai_score ?? '-'}</strong></div>`).join('') || empty('暂无热点'))}`
    $('#newContentBtn').addEventListener('click', goCreate)
  } else if (active === 'hot') {
    view.innerHTML = card('🔥 真实热点中心', `
      <div class="toolbar"><button id="fetchHotBtn">🌐 抓取真实热点</button><button id="scoreHotBtn" class="secondary">✨ AI 评分未评分热点</button><button id="demoHotBtn" class="secondary">写入示例</button></div>
      <p class="muted">默认热点源：Google News RSS（AI / 短视频 / 电商 / 科技）。你也可以在 Render 配置 HOT_FEEDS 自定义 RSS/Atom。</p>
      <div class="hot-grid">${data.hot.map((x) => `
        <div class="hot-card">
          <div class="hot-head"><b>${esc(x.title)}</b><span class="score">${x.ai_score ?? '-'}</span></div>
          <small>${esc(x.source || '')} · 热度 ${x.heat_score ?? '-'} · ${x.discovered_at ? new Date(x.discovered_at).toLocaleString() : ''}</small>
          <p>${esc(x.recommendation || '等待 AI 评分')}</p>
          <div class="mini-actions"><button data-generate-topic="${esc(x.title)}">生成内容</button></div>
        </div>`).join('') || empty('暂无热点，点击“抓取真实热点”')}
      </div>`)
    $('#fetchHotBtn').addEventListener('click', fetchRealHot)
    $('#scoreHotBtn').addEventListener('click', scoreHot)
    $('#demoHotBtn').addEventListener('click', addDemoHot)
    document.querySelectorAll('[data-generate-topic]').forEach((button) => { button.addEventListener('click', () => generateHot(button.dataset.generateTopic)) })
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
  } else if (active === 'library') {
    view.innerHTML = card('内容库', data.content.map((x) => `<div class="row"><div><b>${esc(x.title)}</b><small>${esc(x.platform)} · ${esc(x.status)} · 素材 ${Array.isArray(x.media_urls) && x.media_urls.length ? '已上传' : '无'}</small></div><div class="mini-actions"><strong>${x.ai_score ?? '-'}</strong><button data-queue-publish="${x.id}">加入发布队列</button></div></div>`).join('') || empty('暂无内容'))
    document.querySelectorAll('[data-queue-publish]').forEach((button) => button.addEventListener('click', () => queuePublish(button.dataset.queuePublish)))
  } else if (active === 'schedule') {
    view.innerHTML = card('发布计划', data.content.filter((x) => x.scheduled_at).map((x) => `<div class="row"><div><b>${esc(x.title)}</b><small>${new Date(x.scheduled_at).toLocaleString()}</small></div><span>${esc(x.status)}</span></div>`).join('') || empty('暂无排期'))
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

  bindForms()
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
  try{ const r=await apiFetch('/api/publish/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contentId,socialAccountId:accounts[pick].id,scheduledAt})}); const p=await r.json(); if(!r.ok) throw new Error(p.error||'加入队列失败'); alert('已加入真实发布队列'); await load() }catch(e){alert(e.message)}
}

async function addAccount(platform) {
  try {
    const { error } = await supabase.from('social_accounts').insert({
      user_id: user.id,
      platform,
      account_name: platform === 'douyin' ? '示例抖音账号' : '示例小红书账号',
      status: 'connected'
    })
    if (error) throw error
    await load()
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

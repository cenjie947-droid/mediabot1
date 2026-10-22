const state = { timer: null, id: null, context: [], patched: false }
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]))

async function api(path, options = {}) {
  const { createClient } = await import('@supabase/supabase-js')
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase 未配置')
  const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  const session = await supabase.auth.getSession()
  const token = session?.data?.session?.access_token
  if (!token) throw new Error('登录状态已失效')
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, headers })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || '请求失败')
  return result
}

function projectId() {
  return document.querySelector('.project-row.active')?.dataset.project || null
}

function panel() {
  let box = document.querySelector('#videoStrategy')
  if (!box) {
    const director = document.querySelector('.director-panel')
    if (!director || !projectId()) return null
    box = document.createElement('div')
    box.id = 'videoStrategy'
    box.className = 'panel'
    director.appendChild(box)
  }
  return box
}

function renderStrategy(result) {
  const box = panel()
  if (!box) return
  const rules = result?.data || []
  state.context = rules
  window.__videoStrategyContext = rules.map(rule => ({
    type: rule.rule_type,
    title: rule.title,
    insight: rule.insight,
    recommendation: rule.recommendation,
    confidence: rule.confidence
  }))
  box.innerHTML = `<div class="strategy-head"><div><span class="eyebrow">LEARNING LOOP</span><h3>内容策略</h3><p>真实作品数据 → 可执行规则 → 下一条视频 Director。</p></div><button class="secondary small" id="refreshStrategy">↻ 更新策略</button></div>${
    rules.length
      ? `<div class="strategy-grid">${rules.map(rule => `<article class="strategy-card"><span>${esc(rule.rule_type)}</span><b>${esc(rule.title)}</b><p>${esc(rule.insight)}</p><strong>→ ${esc(rule.recommendation)}</strong><small>置信度 ${Math.round(Number(rule.confidence || 0) * 100)}%</small></article>`).join('')}</div>`
      : '<div class="strategy-empty">还没有足够的数据形成策略。发布并同步几次表现数据后，这里会自动形成下一条视频的实验规则。</div>'
  }`
  document.querySelector('#refreshStrategy')?.addEventListener('click', refreshStrategy)
}

async function loadStrategy() {
  const id = projectId()
  if (!id || id === state.id) return
  state.id = id
  try {
    renderStrategy(await api(`/api/video/projects/${id}/strategy`))
  } catch {}
}

async function refreshStrategy() {
  const id = projectId()
  if (!id) return
  const button = document.querySelector('#refreshStrategy')
  if (button) { button.disabled = true; button.textContent = '分析中…' }
  try {
    renderStrategy(await api(`/api/video/projects/${id}/strategy/refresh`, {
      method: 'POST',
      body: '{}'
    }))
  } catch (error) {
    alert(error.message)
  } finally {
    if (button) { button.disabled = false; button.textContent = '↻ 更新策略' }
  }
}

function patchDirectorGenerate() {
  if (state.patched) return
  const original = window.fetch
  if (typeof original !== 'function') return

  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.endsWith('/api/ai/generate') && init.body && state.context.length) {
        const body = JSON.parse(init.body)
        if (body.mode === 'video') {
          const rules = state.context.slice(0, 8).map(rule =>
            `- ${rule.title}: ${rule.recommendation}（置信度 ${Math.round(Number(rule.confidence || 0) * 100)}%）`
          ).join('\\n')
          body.topic = `${body.topic}

【账号历史表现策略，必须用于本次方案】
${rules}
要求：优先遵守这些规则，但只改变 1-2 个变量进行下一轮实验；不要机械复制历史视频。`
          init = { ...init, body: JSON.stringify(body) }
        }
      }
    } catch {}
    return original(input, init)
  }
  state.patched = true
}

function observe() {
  const root = document.querySelector('#app') || document.body
  patchDirectorGenerate()
  new MutationObserver(() => {
    const id = projectId()
    if (id !== state.id) {
      state.id = null
      clearTimeout(state.timer)
      if (id) state.timer = setTimeout(loadStrategy, 200)
    } else if (id && !document.querySelector('#videoStrategy')) {
      renderStrategy({ data: state.context })
    }
  }).observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-project']
  })
  loadStrategy()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observe, { once: true })
} else {
  observe()
}

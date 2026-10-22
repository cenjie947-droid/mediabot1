const KEY = 'mediabot.videoDirectorContext'
let pendingEventId = null

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null }
}

function write(event, profile) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      eventId: event.id,
      title: event.title,
      hotScore: event.hot_score,
      growthScore: event.growth_score,
      contentScore: event.content_score,
      personalFitScore: event.personal_fit_score,
      fitReasons: event.fit_reasons || [],
      matchedKeywords: event.matched_keywords || [],
      platforms: event.platforms || [],
      profile: {
        sampleSize: profile?.sample_size || 0,
        keywords: (profile?.keywords || []).slice(0, 10)
      },
      evidence: (event.items || []).slice(0, 8).map(item => ({
        platform: item.platform,
        kind: item.kind,
        title: item.title,
        metrics: item.metrics,
        content: item.raw?.content || item.raw?.aweme_desc || ''
      }))
    }))
  } catch {}
}

async function resolve(original, init) {
  if (!pendingEventId) return null
  try {
    const response = await original('/api/trends?limit=80', init)
    const event = (response.data || []).find(item => String(item.id) === String(pendingEventId))
    if (event) {
      write(event, response.profile)
      return read()
    }
  } catch {}
  return null
}

function install() {
  if (window.__videoContextBridge) return
  window.__videoContextBridge = true

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-video]')
    if (button) pendingEventId = button.dataset.video
  }, true)

  const original = window.fetch
  if (typeof original !== 'function') return

  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || ''
      if (url.endsWith('/api/ai/generate') && init.body) {
        const body = JSON.parse(init.body)
        if (body.mode === 'video') {
          let context = read()
          if (!context || String(context.eventId) !== String(pendingEventId)) {
            context = await resolve(original, init)
          }
          if (context) {
            const history = (context.profile?.keywords || [])
              .map(item => item.keyword)
              .filter(Boolean)
              .join('、') || '暂无足够历史样本'

            body.topic = `${body.topic}

【本账号个性化创作上下文】
热点：${context.title}
机会分：${context.contentScore ?? '—'}，账号匹配度：${context.personalFitScore ?? '—'}
匹配原因：${(context.fitReasons || []).join('；') || '—'}
匹配关键词：${(context.matchedKeywords || []).join('、') || '—'}
账号历史高表现主题：${history}
历史样本数：${context.profile?.sampleSize || 0}
实验原则：优先延续账号已验证的主题与结构，只改变 1～2 个变量；必须原创表达，不复制任何样本。
热点证据：${JSON.stringify(context.evidence || [])}`
            init = { ...init, body: JSON.stringify(body) }
          }
        }
      }
    } catch {}
    return original(input, init)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true })
} else {
  install()
}

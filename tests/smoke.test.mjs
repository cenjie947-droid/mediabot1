import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('required application entry points exist', async () => {
  const [html, app, server, pkg] = await Promise.all([
    read('../index.html'), read('../src/main.js'), read('../server.mjs'), read('../package.json')
  ])
  assert.ok(html.includes('id="app"'), 'HTML app root must exist')
  assert.ok(app.includes('createClient('), 'Supabase client initialization must exist')
  assert.ok(server.includes('/api/health'), 'health endpoint must exist')
  assert.ok(pkg.includes('"build"'), 'production build script must exist')
})

test('server has protected API auth and avoids hardcoded provider credentials', async () => {
  const server = await read('../server.mjs')
  assert.ok(server.includes('async function auth('), 'auth middleware must exist')
  assert.ok(server.toLowerCase().includes('req.headers.authorization'), 'Bearer header must be checked')
  assert.ok(server.includes('auth.getUser()'), 'token must be validated with Supabase')
  assert.doesNotMatch(server, /sk-[A-Za-z0-9]{20,}|client_secret\s*[:=]\s*["'][^"']+["']/i)
})

test('demo fixtures are synthetic and contain no token-like fields', async () => {
  const fixture = await read('./fixtures/demo-data.json')
  const data = JSON.parse(fixture)
  assert.match(data._notice, /Synthetic UI fixtures only/i)
  assert.ok(Array.isArray(data.contentItems) && data.contentItems.length >= 1)
  assert.ok(Array.isArray(data.hotTopics) && data.hotTopics.length >= 1)
  assert.doesNotMatch(fixture, /access_token|refresh_token|service_role|sk-[A-Za-z0-9]{20,}/i)
})

test('scheduling UI validates future time before writing', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes('getTime()<=Date.now()'), 'past schedule times must be rejected')
  assert.ok(app.includes('scheduled_at:null'), 'schedule cancellation must clear scheduled_at')
  assert.ok(app.includes("eq('user_id',user.id)"), 'updates must be scoped to current user')
})

test('placeholder social accounts must never be marked as authorized', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes("status: 'pending'"), 'placeholder account records must remain pending')
  assert.ok(app.includes('official OAuth callback has completed'), 'authorization must be confirmed by the real OAuth flow')
  assert.ok(app.includes("x.status==='connected'"), 'publishing choices must only include connected accounts')
})

test('queue UI does not claim a post was published merely because it was queued', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes('加入队列不等于已发布'), 'queue confirmation must distinguish queued from published')
  assert.ok(!app.includes("alert('已加入真实发布队列')"), 'misleading success message must be removed')
})

test('API-key-free demo mode uses synthetic content and clearly stays read-only', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes('进入演示模式（无需 API 密钥）'), 'login page must offer demo entry')
  assert.ok(app.includes('演示模式：当前为虚构样例数据'), 'demo must disclose synthetic data')
  assert.ok(app.includes("if (demoMode) throw new Error('演示模式为只读状态"), 'API writes must be blocked in demo mode')
  assert.ok(app.includes("if (demoMode) return alert('演示模式为只读状态"), 'mutation handlers must be blocked in demo mode')
  assert.ok(app.includes("id:'demo-content-001'"), 'demo must show sample content')
})

test('application can boot without Supabase credentials for demo-only testing', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes('const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_KEY)'), 'missing credentials must be detected')
  assert.ok(app.includes("SUPABASE_URL || 'http://127.0.0.1:54321'"), 'client initialization must not crash without URL')
  assert.ok(app.includes('if (!hasSupabaseConfig) return null'), 'session lookup must skip unconfigured Supabase')
  assert.ok(app.includes('真实登录需要填写 Supabase 配置'), 'real login must explain missing setup')
})

test('demo mode blocks schedule mutations and labels sample accounts honestly', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes("if (demoMode) { $('#scheduleMsg').textContent='演示模式为只读状态，排期不会保存。'; return }"), 'schedule save must be blocked in demo mode')
  assert.ok(app.includes("if (demoMode) return alert('演示模式为只读状态，排期不会更改。')"), 'schedule cancellation must be blocked in demo mode')
  assert.ok(app.includes('（未授权）'), 'sample social accounts must not look like real platform authorizations')
  assert.ok(app.includes("if (demoMode) { demoMode=false; user=null;"), 'demo logout must exit demo mode without signing out a fake user')
})


test('AI generation forwards creator requirements into the model prompt', async () => {
  const server = await read('../server.mjs')
  const app = await read('../src/main.js')
  assert.ok(server.includes("requirements = ''"), 'server must accept optional creator requirements')
  assert.ok(server.includes('用户补充要求：${String(requirements || \'\').trim() || \'无\'}'), 'creator requirements must be included in the AI prompt')
  assert.ok(app.includes("requirements: $('#body').value"), 'form requirements must be sent to the API')
})


test('saved content editing is user-scoped and demo mode remains read-only', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes('function openContentEditor(id)'), 'saved content editor must be available')
  assert.ok(app.includes(".eq('id',editingContentId).eq('user_id',user.id)"), 'updates must be scoped to the current user')
  assert.ok(app.includes("if (demoMode) return alert('演示模式为只读状态，不能编辑样例内容。')"), 'demo content must not be editable')
  assert.ok(app.includes('data-post-edit='), 'post history must expose editing')
  assert.ok(app.includes('data-library-edit='), 'content library must expose editing')
})


test('AI generation result links directly to its saved content', async () => {
  const app = await read('../src/main.js')
  assert.ok(app.includes('payload.content.id'), 'generated database row must be used for editing')
  assert.ok(app.includes('id="editGeneratedContent"'), 'success result must offer direct editing')
  assert.ok(app.includes('id="openGeneratedLibrary"'), 'success result must offer a content library link')
  assert.ok(app.includes("editingContent?.platform==='douyin'?'selected':''"), 'editor must restore the saved platform')
})

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

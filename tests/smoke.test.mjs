import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('required application entry points exist', async () => {
  const [html, app, server, pkg] = await Promise.all([
    read('../index.html'), read('../src/main.js'), read('../server.mjs'), read('../package.json')
  ])
  assert.match(html, /<div[^>]+id=["']app["']|<main[^>]+id=["']app["']|id=["']view["']/i)
  assert.match(app, /createClient\('@supabase\/supabase-js'\)|createClient\(/)
  assert.match(server, /app\.get\(['"]\/api\/health['"]/)
  assert.match(pkg, /"build"\s*:/)
})

test('server has protected API auth and avoids hardcoded provider credentials', async () => {
  const server = await read('../server.mjs')
  assert.match(server, /async function auth\(/)
  assert.match(server, /req\.headers\.authorization/i)
  assert.match(server, /auth\.getUser\(\)/)
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
  assert.match(app, /getTime\(\)<=Date\.now\(\)/)
  assert.match(app, /scheduled_at:null/)
  assert.match(app, /eq\('user_id',user\.id\)/)
})

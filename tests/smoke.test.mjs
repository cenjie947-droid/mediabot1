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


test('publish queue rejects unauthorized accounts and invalid schedules', async () => {
  const server = await read('../server.mjs')
  assert.ok(server.includes("account.status !== 'connected'"), 'only officially connected accounts may be queued')
  assert.ok(server.includes('定时发布时间必须晚于当前时间'), 'past schedules must be rejected')
  assert.ok(server.includes('内容目标平台与所选账号不一致'), 'content and target platform must match')
  assert.ok(server.includes(".eq('id',content.id).eq('user_id',req.user.id)"), 'content status update must be scoped to the authenticated user')
})


test('Douyin publisher passes its storage client into media retrieval', async () => {
  const publisher = await read('../publishers.mjs')
  assert.ok(publisher.includes('async function douyinPublish(admin, job, account, content, secret)'), 'publisher must receive the admin client')
  assert.ok(publisher.includes('fetchMedia(admin, content.media_urls)'), 'media retrieval must use the passed admin client')
  assert.ok(publisher.includes('douyinPublish(admin,job,account,content,secret)'), 'publish worker must pass the admin client')
})


test('publish worker claims only queued jobs and checks account/content ownership', async () => {
  const publisher = await read('../publishers.mjs')
  assert.ok(publisher.includes(".eq('id',job.id).eq('status','queued').select('id').maybeSingle()"), 'job must be atomically claimed only from queued state')
  assert.ok(publisher.includes('account.user_id!==job.user_id||content.user_id!==job.user_id'), 'job associations must belong to its user')
  assert.ok(publisher.includes("if(account.status!=='connected')"), 'worker must recheck account authorization')
  assert.ok(publisher.includes('skipped'), 'already-claimed jobs must be skipped')
})


test('publish execution only selects jobs whose scheduled time is due', async () => {
  const server = await read('../server.mjs')
  const automation = await read('../automation.mjs')
  assert.ok(server.includes(".or('scheduled_at.is.null,scheduled_at.lte.'+now)"), 'manual run must not execute future scheduled jobs')
  assert.ok(automation.includes(".or('scheduled_at.is.null,scheduled_at.lte.'+now)"), 'scheduled worker must wait until scheduled_at is due')
})


test('cron worker processes due publish jobs independently of user automation rules', async () => {
  const automation = await read('../automation.mjs')
  const worker = await read('../worker.mjs')
  assert.ok(automation.includes('export async function runDuePublishJobs'), 'automation module must expose due publishing worker')
  assert.ok(automation.includes(".eq('status','queued').or('scheduled_at.is.null,scheduled_at.lte.'+now)"), 'only due queued jobs may be processed')
  assert.ok(worker.includes('runAutomation, runDuePublishJobs'), 'cron worker must invoke the due publisher')
  assert.ok(worker.includes('const publishing = await runDuePublishJobs()'), 'every cron run must check the publish queue')
})


test('cron command works with Render-provided environment variables when no local .env file exists', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  assert.ok(pkg.scripts.automation.includes('--env-file-if-exists=.env'), 'automation command must not require a local .env file on hosted cron')
  assert.ok(pkg.scripts.automation.includes('worker.mjs'), 'automation command must start the worker')
})


test('repository includes the core v7 schema migration referenced by deployment docs', async () => {
  const sql = await read('../supabase/migrations/20261022_core_v7_schema.sql')
  const readme = await read('../README.md')
  for (const table of ['social_accounts','content_items','hot_topics','publish_jobs','scheduled_tasks','run_logs','ai_generations']) assert.ok(sql.includes('create table if not exists public.' + table), 'missing core table ' + table)
  assert.ok(sql.includes('public.social_account_secrets'), 'protected token storage must match OAuth writes')
  assert.ok(sql.includes('revoke all on public.social_account_secrets from public, anon, authenticated'), 'client roles must not access account tokens')
  const publishers = await read('../publishers.mjs')
  assert.ok(publishers.includes("admin.from('social_account_secrets')"), 'publisher must read the same token table as OAuth')
  assert.ok(sql.includes("values ('publish-media','publish-media',false"), 'media bucket must be private')
  assert.ok(readme.includes('20261022_core_v7_schema.sql'), 'setup docs must list the core migration')
})


test('Render cron has a compatible Node version and Douyin publish credentials', async () => {
  const pkg = JSON.parse(await read('../package.json'))
  const render = await read('../render.yaml')
  assert.ok(pkg.engines?.node && pkg.engines.node.includes('22.6'), 'Node version must support --env-file-if-exists')
  const cron = render.split('name: mediabot-automation')[1] || ''
  assert.ok(cron.includes('key: DOUYIN_CLIENT_KEY'), 'cron must receive Douyin client key to publish')
  assert.ok(cron.includes('key: DOUYIN_CLIENT_SECRET'), 'cron must receive Douyin client secret to publish')
})


test('ambiguous successful platform publish requires review instead of retryable failure', async () => {
  const publisher = await read('../publishers.mjs')
  const migration = await read('../supabase/migrations/20261022_core_v7_schema.sql')
  assert.ok(publisher.includes("message.includes('平台已返回成功') ? 'needs_review' : 'failed'"), 'uncertain success must not be marked as an ordinary failed job')
  assert.ok(migration.includes("'needs_review'"), 'database status constraint must allow review state')
  assert.ok(publisher.includes(".eq('id',job.id).eq('status','publishing')"), 'status update must only affect the job currently claimed by this worker')
})


test('publish job history API is authenticated, user-scoped, bounded, and exposes review status', async () => {
  const server = await read('../server.mjs')
  const migration = await read('../supabase/migrations/20261022_core_v7_schema.sql')
  assert.ok(server.includes("app.get('/api/publish/jobs', auth"), 'publish history must require authentication')
  assert.ok(server.includes(".eq('user_id',req.user.id).order('created_at'"), 'history must only return the current user jobs')
  assert.ok(server.includes("Math.min(100,Number(req.query.limit)||30)"), 'history page size must be capped')
  assert.ok(server.includes("res.set('Cache-Control','no-store')"), 'sensitive publishing history must not be cached')
  assert.ok(migration.includes("'needs_review'"), 'history must be able to surface manual-review status')
})


test('post history UI loads and displays real publish job statuses including manual review', async () => {
  const main = await read('../src/main.js')
  assert.ok(main.includes("apiFetch('/api/publish/jobs?limit=50')"), 'UI must fetch current user publish history')
  assert.ok(main.includes("needs_review:'需要人工核对'"), 'ambiguous results must be clearly labeled')
  assert.ok(main.includes("card('发布队列记录'"), 'publish queue history must be visible on post history page')
  assert.ok(main.includes("esc(job.error_message)"), 'job error messages must be escaped before rendering')
})


test('demo fixture initializes publish history safely without authenticated API access', async () => {
  const main = await read('../src/main.js')
  assert.ok(main.includes('tasks: [], jobs: [], logs:'), 'demo fixture must initialize empty publish history')
  assert.ok(main.includes('(data.jobs || []).map(job =>'), 'post history must tolerate missing jobs data')
  assert.ok(main.includes("if (demoMode) throw new Error('演示模式为只读状态"), 'demo mode must not call authenticated write APIs')
})

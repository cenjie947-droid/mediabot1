import { runAutomation, runDuePublishJobs } from './automation.mjs'
console.log('[MediaBot] automation worker started')
try {
  const automation = await runAutomation()
  const publishing = await runDuePublishJobs()
  const result = { automation, publishing }
  console.log(JSON.stringify(result, null, 2))
  process.exit(automation.results?.some(x=>!x.ok) || publishing.failed > 0 ? 1 : 0)
} catch (e) {
  console.error(e)
  process.exit(1)
}

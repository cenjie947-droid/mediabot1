import { runAutomation } from './automation.mjs'
console.log('[MediaBot] automation worker started')
try {
  const result = await runAutomation()
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.results?.some(x=>!x.ok) ? 1 : 0)
} catch (e) {
  console.error(e)
  process.exit(1)
}

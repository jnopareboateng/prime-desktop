import { PROBE_CATALOG } from './catalog.mts'
import { currentPlatform, runProbes } from './runner.mts'
import { registerNativeBackends } from './native-backends.mts'
import type { ProbeResult, ProbeStatus } from './types.mts'

// Runnable probe entry point. A missing backend is an explicit release gate:
// CI must never read an unimplemented backend as a pass. Local exploratory
// runs may opt into the unavailable result with PRIME_DESKTOP_ALLOW_UNAVAILABLE_PROBES=1.

function summarize(results: ProbeResult[]): Record<ProbeStatus, number> {
  const counts: Record<ProbeStatus, number> = { pass: 0, fail: 0, unavailable: 0 }
  for (const result of results) counts[result.status]++
  return counts
}

async function main() {
  const platform = currentPlatform() ?? process.platform
  console.log(`sandbox probes — host platform: ${platform}`)
  console.log('-'.repeat(72))

  await registerNativeBackends()
  const results = await runProbes(PROBE_CATALOG)
  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'SKIP'
    console.log(`[${marker}] ${result.id} (expect ${result.expect})${result.detail ? ` — ${result.detail}` : ''}`)
  }

  const counts = summarize(results)
  console.log('-'.repeat(72))
  console.log(`pass=${counts.pass} fail=${counts.fail} unavailable=${counts.unavailable} total=${results.length}`)

  if (counts.fail > 0) process.exitCode = 1
  else if (counts.unavailable > 0 && process.env.PRIME_DESKTOP_ALLOW_UNAVAILABLE_PROBES !== '1') {
    console.error('Sandbox probe coverage is incomplete. Set PRIME_DESKTOP_ALLOW_UNAVAILABLE_PROBES=1 only for an explicitly unsupported local host.')
    process.exitCode = 2
  } else process.exitCode = 0
}

main()

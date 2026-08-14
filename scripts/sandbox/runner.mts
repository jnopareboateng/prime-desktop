import type { ProbeBackend, ProbeCase, ProbeCategory, ProbeResult, ProbeStatus, Platform } from './types.mts'

// Backend hooks that actually touch the OS. Nothing is registered by
// default: job J3 registers real macOS/Linux/Windows adapters here. A
// category with no registered backend runs on no host, so keeping the
// registry empty by default is what makes a missing backend visible
// instead of silently passing.
const backends = new Map<ProbeCategory, ProbeBackend>()

export function registerBackend(category: ProbeCategory, backend: ProbeBackend): void {
  backends.set(category, backend)
}

export function clearBackends(): void {
  backends.clear()
}

export function currentPlatform(): Platform | null {
  const platform = process.platform
  return platform === 'darwin' || platform === 'linux' || platform === 'win32' ? platform : null
}

function appliesToPlatform(probeCase: ProbeCase, platform: Platform | null): boolean {
  if (!probeCase.platforms) return true
  return platform !== null && probeCase.platforms.includes(platform)
}

export async function runProbe(probeCase: ProbeCase): Promise<ProbeResult> {
  const startedAt = Date.now()
  const platform = currentPlatform()

  const unavailable = (detail: string): ProbeResult => ({
    id: probeCase.id,
    category: probeCase.category,
    expect: probeCase.expect,
    status: 'unavailable',
    detail,
    durationMs: Date.now() - startedAt,
  })

  if (!appliesToPlatform(probeCase, platform)) {
    return unavailable(`probe targets ${probeCase.platforms?.join(', ')}, host is ${process.platform}`)
  }

  const backend = backends.get(probeCase.category)
  if (!backend) {
    return unavailable(`no execution backend registered for category "${probeCase.category}"`)
  }

  try {
    const observation = await backend(probeCase)
    const status: ProbeStatus = observation.outcome === probeCase.expect ? 'pass' : 'fail'
    return {
      id: probeCase.id,
      category: probeCase.category,
      expect: probeCase.expect,
      status,
      observedOutcome: observation.outcome,
      detail: observation.detail,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      id: probeCase.id,
      category: probeCase.category,
      expect: probeCase.expect,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    }
  }
}

export async function runProbes(cases: ProbeCase[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = []
  for (const probeCase of cases) {
    results.push(await runProbe(probeCase))
  }
  return results
}

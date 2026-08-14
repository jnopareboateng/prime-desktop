import { readFileSync } from 'fs'
import { release as osRelease } from 'os'
import type { BackendCapability, HostPlatform } from './types'

function readProcVersion(): string {
  try {
    return readFileSync('/proc/version', 'utf8')
  } catch {
    return ''
  }
}

// WSL1 vs WSL2 is distinguished by string-sniffing the kernel release and
// /proc/version, the only signal Node exposes without a native binding.
// ponytail: naive heuristic, ceiling is misclassifying an unusual WSL build;
// upgrade to a real backend probe (J3) if that ever matters in practice.
export function detectHostPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
  release: string = osRelease(),
  procVersion: string = readProcVersion()
): HostPlatform {
  if (nodePlatform === 'darwin') return 'macos'
  if (nodePlatform === 'win32') return 'windows'
  if (nodePlatform === 'linux') {
    const signal = `${release} ${procVersion}`.toLowerCase()
    if (signal.includes('wsl2') || signal.includes('microsoft-standard-wsl2')) return 'wsl2'
    if (signal.includes('microsoft') || signal.includes('wsl')) return 'wsl1'
    return 'linux'
  }
  return 'unknown'
}

export type BackendProbe = (platform: HostPlatform) => BackendCapability

const UNAVAILABLE_REASON = 'no backend probe wired up yet; enforcement is not available on this build'

export function unavailableCapability(platform: HostPlatform, reason: string = UNAVAILABLE_REASON): BackendCapability {
  return { platform, state: 'unavailable', backend: null, reason }
}

// Never claim 'enforced' just because a policy object exists: until a real
// per-OS backend probe (Seatbelt / Bubblewrap+seccomp / Windows) is supplied,
// this resolves to 'unavailable' on every platform.
export function resolveBackendCapability(
  platform: HostPlatform = detectHostPlatform(),
  probe?: BackendProbe
): BackendCapability {
  if (!probe) return unavailableCapability(platform)
  const result = probe(platform)
  if (result.state === 'enforced' && !result.backend) {
    throw new Error('backend probe claimed "enforced" without naming a backend')
  }
  return result
}

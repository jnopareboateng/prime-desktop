export type NetworkMode = 'none' | 'proxy-only' | 'restricted'

// 'enforced' requires a real backend probe naming its backend; a policy object
// existing is never sufficient on its own. See host.ts.
export type EnforcementState = 'enforced' | 'unenforced' | 'unavailable'

export type HostPlatform = 'macos' | 'linux' | 'wsl1' | 'wsl2' | 'windows' | 'unknown'

export interface ExecutionPolicy {
  readonly id: string
  readonly label: string
  readonly readRoots: readonly string[]
  readonly writeRoots: readonly string[]
  readonly deniedPaths: readonly string[]
  readonly protectedMetadataPaths: readonly string[]
  readonly network: NetworkMode
  readonly envAllowlist: readonly string[]
  readonly maxProcesses: number
  readonly allowPty: boolean
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  // epoch ms; null means the grant does not expire on its own
  readonly grantExpiresAt: number | null
}

export interface ExecutionRequest {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly policy: ExecutionPolicy
  readonly pty: boolean
  readonly env: Readonly<Record<string, string>>
}

export interface DenialEvent {
  readonly code: string
  readonly message: string
  readonly retryableInBoundary: boolean
}

export interface ExecutionResult {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly backend: string | null
  readonly enforcement: EnforcementState
  readonly denials: readonly DenialEvent[]
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly diagnostics: Readonly<Record<string, unknown>>
}

export interface BackendCapability {
  readonly platform: HostPlatform
  readonly state: EnforcementState
  readonly backend: string | null
  readonly reason: string
}

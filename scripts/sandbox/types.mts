// Probe metadata and result shapes for the cross-platform sandbox capability
// probes (job J1). Metadata only — no OS execution lives in this file.
// Backend hooks that actually touch the OS are implemented per-platform in
// job J3 and registered with the runner (see runner.mts).

export type ProbeStatus = 'pass' | 'fail' | 'unavailable'

export type ProbeCategory =
  | 'outside-root-read'
  | 'outside-root-write'
  | 'denied-carve-out'
  | 'symlink-escape'
  | 'child-process'
  | 'env-scrub'
  | 'network'
  | 'timeout-output'
  | 'pty'
  | 'daemon-attach'

export type ProbeExpectation = 'allow' | 'deny'

export type Platform = 'darwin' | 'linux' | 'win32'

/**
 * One expected allow/deny capability case. A stable `id` lets CI, audit
 * trails, and cross-platform runs reference the same case over time.
 */
export interface ProbeCase {
  id: string
  category: ProbeCategory
  expect: ProbeExpectation
  description: string
  /** Platforms this case targets. Omit to apply on every platform. */
  platforms?: Platform[]
}

/** What a backend hook actually observed when it ran a probe case. */
export interface ProbeObservation {
  outcome: ProbeExpectation
  detail?: string
}

/**
 * Executes one probe case against the real OS and reports what happened.
 * There is no default implementation — a category with no registered
 * backend is reported `unavailable` by the runner, never coerced into a
 * pass or fail, and never treated as "protected"/"enforced".
 */
export type ProbeBackend = (probeCase: ProbeCase) => Promise<ProbeObservation>

export interface ProbeResult {
  id: string
  category: ProbeCategory
  expect: ProbeExpectation
  status: ProbeStatus
  observedOutcome?: ProbeExpectation
  detail?: string
  durationMs: number
}

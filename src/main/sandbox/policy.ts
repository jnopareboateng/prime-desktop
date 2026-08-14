import { isAbsolute, join, relative, resolve } from 'path'
import type { ExecutionPolicy, ExecutionRequest, NetworkMode } from './types'

const DEFAULT_PROTECTED_METADATA_NAMES = ['.git', '.ssh', '.env', '.aws', '.gnupg']
const NETWORK_MODES: readonly NetworkMode[] = ['none', 'proxy-only', 'restricted']
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const MIN_TIMEOUT_MS = 1_000
const MAX_TIMEOUT_MS = 30 * 60_000
const DEFAULT_TIMEOUT_MS = 2 * 60_000

const MIN_OUTPUT_BYTES = 4_096
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const DEFAULT_OUTPUT_BYTES = 1024 * 1024

const MIN_PROCESSES = 1
const MAX_PROCESSES = 256
const DEFAULT_PROCESSES = 8

export class PolicyValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`invalid policy field "${field}": ${message}`)
    this.name = 'PolicyValidationError'
  }
}

export class RequestValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`invalid execution request field "${field}": ${message}`)
    this.name = 'RequestValidationError'
  }
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PolicyValidationError(field, 'must be an object')
  }
  return value as Record<string, unknown>
}

function normalizeString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PolicyValidationError(field, 'must be a non-empty string')
  }
  return value
}

function normalizeAbsolutePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PolicyValidationError(field, 'must be a non-empty string')
  }
  if (!isAbsolute(value)) {
    throw new PolicyValidationError(field, `must be an absolute path, got "${value}"`)
  }
  return resolve(value)
}

function normalizePathList(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new PolicyValidationError(field, 'must be an array of absolute paths')
  const paths = value.map((v, i) => normalizeAbsolutePath(v, `${field}[${i}]`))
  return Array.from(new Set(paths))
}

function normalizeNetworkMode(value: unknown): NetworkMode {
  if (typeof value !== 'string' || !NETWORK_MODES.includes(value as NetworkMode)) {
    throw new PolicyValidationError('network', `must be one of ${NETWORK_MODES.join(', ')}`)
  }
  return value as NetworkMode
}

function normalizeEnvAllowlist(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new PolicyValidationError('envAllowlist', 'must be an array of environment variable names')
  }
  const names = value.map((v, i) => {
    if (typeof v !== 'string' || !ENV_NAME_PATTERN.test(v)) {
      throw new PolicyValidationError(`envAllowlist[${i}]`, `must match ${ENV_NAME_PATTERN}`)
    }
    return v
  })
  return Array.from(new Set(names))
}

function normalizeBoundedInt(
  value: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new PolicyValidationError(field, 'must be a positive finite number')
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function normalizeBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new PolicyValidationError(field, 'must be a boolean')
  return value
}

function normalizeGrantExpiresAt(value: unknown, now: number): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PolicyValidationError('grantExpiresAt', 'must be a finite epoch-ms number or null')
  }
  if (value <= now) {
    throw new PolicyValidationError('grantExpiresAt', 'must be in the future')
  }
  return value
}

export function normalizeExecutionPolicy(input: unknown, now: number = Date.now()): ExecutionPolicy {
  const obj = asObject(input, 'policy')
  const readRoots = normalizePathList(obj.readRoots, 'readRoots')
  const writeRoots = normalizePathList(obj.writeRoots, 'writeRoots')

  const protectedMetadataPaths =
    obj.protectedMetadataPaths === undefined
      ? [...readRoots, ...writeRoots].flatMap((root) =>
          DEFAULT_PROTECTED_METADATA_NAMES.map((name) => join(root, name))
        )
      : normalizePathList(obj.protectedMetadataPaths, 'protectedMetadataPaths')

  const deniedPaths = Array.from(
    new Set([...normalizePathList(obj.deniedPaths, 'deniedPaths'), ...protectedMetadataPaths])
  )

  return {
    id: normalizeString(obj.id, 'id'),
    label: normalizeString(obj.label, 'label'),
    readRoots,
    writeRoots,
    deniedPaths,
    protectedMetadataPaths,
    network: normalizeNetworkMode(obj.network),
    envAllowlist: normalizeEnvAllowlist(obj.envAllowlist),
    maxProcesses: normalizeBoundedInt(obj.maxProcesses, 'maxProcesses', DEFAULT_PROCESSES, MIN_PROCESSES, MAX_PROCESSES),
    allowPty: normalizeBoolean(obj.allowPty, 'allowPty', false),
    timeoutMs: normalizeBoundedInt(obj.timeoutMs, 'timeoutMs', DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxOutputBytes: normalizeBoundedInt(
      obj.maxOutputBytes,
      'maxOutputBytes',
      DEFAULT_OUTPUT_BYTES,
      MIN_OUTPUT_BYTES,
      MAX_OUTPUT_BYTES
    ),
    grantExpiresAt: normalizeGrantExpiresAt(obj.grantExpiresAt, now)
  }
}

export function isGrantExpired(policy: ExecutionPolicy, now: number = Date.now()): boolean {
  return policy.grantExpiresAt !== null && policy.grantExpiresAt <= now
}

function comparable(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

export function isPathWithinRoot(root: string, target: string): boolean {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  if (comparable(normalizedTarget) === comparable(normalizedRoot)) return true
  const rel = relative(comparable(normalizedRoot), comparable(normalizedTarget))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isPathAllowed(policy: ExecutionPolicy, targetPath: string, mode: 'read' | 'write'): boolean {
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath)) return false
  const target = resolve(targetPath)
  const roots = mode === 'write' ? policy.writeRoots : [...policy.readRoots, ...policy.writeRoots]
  const withinRoot = roots.some((root) => isPathWithinRoot(root, target))
  if (!withinRoot) return false
  return !policy.deniedPaths.some((denied) => isPathWithinRoot(denied, target))
}

// Requests carry argv arrays, never a shell string: there is no
// "escapeShellArg" helper here because spawning must always use shell:false.
// Sanitizing a string that a shell will re-interpret is a false sense of
// safety this module refuses to provide.
export interface ExecutionRequestInput {
  readonly argv: unknown
  readonly cwd: unknown
  readonly policy: ExecutionPolicy
  readonly pty?: unknown
  readonly env?: unknown
}

function normalizeArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RequestValidationError('argv', 'must be a non-empty array of argument strings')
  }
  return value.map((v, i) => {
    if (typeof v !== 'string' || v.length === 0) {
      throw new RequestValidationError(`argv[${i}]`, 'must be a non-empty string')
    }
    return v
  })
}

function normalizeRequestCwd(value: unknown, policy: ExecutionPolicy): string {
  if (typeof value !== 'string' || value.trim().length === 0 || !isAbsolute(value)) {
    throw new RequestValidationError('cwd', 'must be a main-resolved absolute path')
  }
  const cwd = resolve(value)
  if (!isPathAllowed(policy, cwd, 'read')) {
    throw new RequestValidationError('cwd', 'is outside the policy read/write roots or inside a denied path')
  }
  return cwd
}

function normalizeRequestPty(value: unknown, policy: ExecutionPolicy): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new RequestValidationError('pty', 'must be a boolean')
  if (value && !policy.allowPty) {
    throw new RequestValidationError('pty', 'requested but the policy does not allow PTY')
  }
  return value
}

function normalizeRequestEnv(value: unknown, policy: ExecutionPolicy): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestValidationError('env', 'must be an object')
  }
  const obj = value as Record<string, unknown>
  const result: Record<string, string> = {}
  for (const [key, v] of Object.entries(obj)) {
    if (!ENV_NAME_PATTERN.test(key)) {
      throw new RequestValidationError(`env.${key}`, 'is not a valid environment variable name')
    }
    if (!policy.envAllowlist.includes(key)) {
      throw new RequestValidationError(`env.${key}`, 'is not in the policy environment allowlist')
    }
    if (typeof v !== 'string') {
      throw new RequestValidationError(`env.${key}`, 'must be a string value')
    }
    result[key] = v
  }
  return result
}

export function normalizeExecutionRequest(input: ExecutionRequestInput): ExecutionRequest {
  if (isGrantExpired(input.policy)) {
    throw new RequestValidationError('policy', 'grant has expired')
  }
  return {
    argv: normalizeArgv(input.argv),
    cwd: normalizeRequestCwd(input.cwd, input.policy),
    policy: input.policy,
    pty: normalizeRequestPty(input.pty, input.policy),
    env: normalizeRequestEnv(input.env, input.policy)
  }
}

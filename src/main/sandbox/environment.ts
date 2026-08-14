import type { ExecutionPolicy } from './types'

export const SAFE_ENV_NAMES = [
  'HOME', 'USERPROFILE', 'PATH', 'SHELL', 'ComSpec', 'SystemRoot',
  'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
  'PRIME_AGENT_KERNEL_PYTHON'
] as const

export function filterEnvironment(
  allowlist: readonly string[],
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of allowlist) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

export function filterEnvironmentForPolicy(policy: Pick<ExecutionPolicy, 'envAllowlist'>): NodeJS.ProcessEnv {
  return filterEnvironment(policy.envAllowlist)
}

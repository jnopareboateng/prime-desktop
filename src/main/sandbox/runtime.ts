import { createRequire } from 'module'
import { createHash } from 'crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  SandboxManager,
  checkWindowsDependenciesAsync,
  resolveSrtWin
} from '@anthropic-ai/sandbox-runtime'
import { normalizeExecutionPolicy } from './policy'
import { detectHostPlatform, resolveBackendCapability, unavailableCapability } from './host'
import type { BackendCapability, EnforcementState, ExecutionPolicy } from './types'
import type { AccessMode, PermissionRule } from '@shared/types'
import { rulesForProject } from '../permissions'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const SANDBOX_ENV = 'PRIME_DESKTOP_SANDBOX'
const SANDBOX_DOMAINS_ENV = 'PRIME_DESKTOP_SANDBOX_ALLOWED_DOMAINS'
const SANDBOX_SETTINGS_DIR = join(
  process.platform === 'win32'
    ? process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.local', 'share'),
  'PrimeDesktop',
  'sandbox'
)

const SAFE_ENV_NAMES = [
  'HOME',
  'USERPROFILE',
  'PATH',
  'SHELL',
  'ComSpec',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'PRIME_AGENT_KERNEL_PYTHON'
]

let capabilityPromise: Promise<BackendCapability> | null = null

export interface PreparedSandboxLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly policy: ExecutionPolicy | null
  readonly capability: BackendCapability
  readonly cleanup: () => Promise<void>
}

function packageRoot(binary: string): string {
  const resolved = realpathSync(binary)
  const marker = join('dist', 'bundle', 'cli.js')
  if (resolved.endsWith(marker)) return dirname(dirname(dirname(resolved)))
  throw new Error('Sandboxed transport requires the npm installation of prime-agent.')
}

function runtimeCliPath(): string {
  const resolved = require.resolve('@anthropic-ai/sandbox-runtime/dist/cli.js') as string
  // electron-builder stores production dependencies in app.asar. The CLI is
  // executed by a child Node/Electron process, so point it at the unpacked
  // copy rather than relying on the parent process's asar resolver.
  const path = resolved.replace('app.asar', 'app.asar.unpacked')
  if (!existsSync(path)) throw new Error('Anthropic sandbox-runtime CLI is missing from the installation.')
  return path
}

export function runtimeSrtWinPath(): string {
  const cli = runtimeCliPath()
  const packageRoot = dirname(dirname(cli))
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  return join(packageRoot, 'vendor', 'srt-win', architecture, 'srt-win.exe')
}

function nodeForScript(script: string): string {
  if (process.env.PRIME_DESKTOP_NODE_PATH) return process.env.PRIME_DESKTOP_NODE_PATH
  let directory = dirname(script)
  for (let i = 0; i < 6; i++) {
    const candidate = join(directory, process.platform === 'win32' ? 'node.exe' : 'node')
    if (existsSync(candidate)) return candidate
    directory = dirname(directory)
  }
  return process.platform === 'win32' ? 'node.exe' : 'node'
}

function filteredEnv(policy: ExecutionPolicy): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of policy.envAllowlist) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  delete env.ELECTRON_NO_ASAR
  return env
}

function allowedDomains(): string[] {
  return (process.env[SANDBOX_DOMAINS_ENV] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function protectedPaths(cwd: string): string[] {
  const home = homedir()
  return [
    join(cwd, '.git'),
    join(cwd, '.ssh'),
    join(cwd, '.env'),
    join(cwd, '.aws'),
    join(cwd, '.gnupg'),
    join(home, '.ssh'),
    join(home, '.aws'),
    join(home, '.gnupg'),
    join(home, '.config', 'gh', 'hosts.yml')
  ]
}

function isWindowsNamedPipe(path: string): boolean {
  return process.platform === 'win32' && path.startsWith('\\\\.\\pipe\\')
}

function customRulePath(rule: PermissionRule, cwd: string): string {
  const pattern = rule.pattern.trim()
  if (!pattern) throw new Error('Custom permission rules must name a path.')
  if (/[*?\[\]{}]/.test(pattern)) {
    throw new Error(`Custom permission rule "${pattern}" is not a filesystem path and cannot be enforced by the sandbox.`)
  }
  return resolve(isAbsolute(pattern) ? pattern : join(cwd, pattern))
}

async function createDaemonPolicy(binary: string, socketPath: string, cwd: string, accessMode: AccessMode): Promise<ExecutionPolicy> {
  const agentRoot = join(homedir(), '.prime', 'agent')
  const socketRoot = dirname(socketPath)
  const domains = allowedDomains()
  const readRoots = [
    cwd,
    packageRoot(binary),
    agentRoot,
    SANDBOX_SETTINGS_DIR,
    ...(isWindowsNamedPipe(socketPath) ? [] : [socketRoot])
  ]
  const writeRoots = [agentRoot, SANDBOX_SETTINGS_DIR, ...(isWindowsNamedPipe(socketPath) ? [] : [socketRoot])]
  const deniedPaths = protectedPaths(cwd)
  let customRules: PermissionRule[] = []

  if (accessMode === 'approve-me') writeRoots.push(cwd)
  if (accessMode === 'custom') {
    customRules = await rulesForProject(cwd)
    for (const rule of customRules) {
      const path = customRulePath(rule, cwd)
      if (rule.action === 'deny') deniedPaths.push(path)
      else {
        readRoots.push(path)
        writeRoots.push(path)
      }
    }
  }

  const permissionDigest = createHash('sha256')
    .update(JSON.stringify({ accessMode, rules: customRules }))
    .digest('hex')
    .slice(0, 16)

  return normalizeExecutionPolicy({
    id: `prime-agent-daemon-${basename(socketPath)}-${permissionDigest}`,
    label: 'Prime Agent project session',
    readRoots,
    writeRoots,
    deniedPaths,
    protectedMetadataPaths: protectedPaths(cwd),
    network: domains.length > 0 ? 'restricted' : 'none',
    envAllowlist: SAFE_ENV_NAMES,
    maxProcesses: 64,
    allowPty: false,
    timeoutMs: 30 * 60_000,
    maxOutputBytes: 64 * 1024 * 1024,
    grantExpiresAt: null
  })
}

function sandboxConfig(policy: ExecutionPolicy): Record<string, unknown> {
  const domains = allowedDomains()
  return {
    network: {
      allowedDomains: domains,
      deniedDomains: domains.length > 0 ? [] : ['*'],
      strictAllowlist: true,
      allowUnixSockets: [],
      allowLocalBinding: false
    },
    filesystem: {
      denyRead: policy.deniedPaths,
      allowRead: policy.readRoots,
      allowWrite: policy.writeRoots,
      denyWrite: policy.deniedPaths,
      allowGitConfig: false
    },
    allowPty: false,
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false
  }
}

async function dependencyCapability(): Promise<BackendCapability> {
  if (capabilityPromise) return capabilityPromise
  capabilityPromise = resolveDependencyCapability()
  return capabilityPromise
}

async function resolveDependencyCapability(): Promise<BackendCapability> {
  const platform = detectHostPlatform()
  try {
    const check = process.platform === 'win32'
      ? await checkWindowsDependenciesAsync({ srtWin: resolveSrtWin({ path: runtimeSrtWinPath() }) })
      : await SandboxManager.checkDependenciesAsync()
    if (check.errors.length > 0) {
      return {
        platform,
        state: 'unavailable',
        backend: null,
        reason: check.errors.join('; ')
      }
    }
    const probe = await runBehavioralProbe()
    const warning = check.warnings.length > 0 ? `; ${check.warnings.join('; ')}` : ''
    return resolveBackendCapability(platform, () => probe.ok
      ? { platform, state: 'enforced', backend: `sandbox-runtime:${platform}`, reason: probe.reason }
      : unavailableCapability(platform, `${probe.reason}${warning}`))
  } catch (error) {
    return {
      platform,
      state: 'unavailable',
      backend: null,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

async function runBehavioralProbe(): Promise<{ ok: boolean; reason: string }> {
  const root = await mkdtemp(join(tmpdir(), 'prime-desktop-sandbox-probe-'))
  const inside = join(root, 'inside')
  const outside = join(root, 'outside')
  const insideFile = join(inside, 'allowed.txt')
  const outsideFile = join(outside, 'denied.txt')
  const settingsPath = join(root, 'settings.json')
  const policy = normalizeExecutionPolicy({
    id: 'prime-desktop-native-probe',
    label: 'Prime Desktop native sandbox probe',
    readRoots: [inside],
    writeRoots: [inside],
    deniedPaths: [outside],
    protectedMetadataPaths: [],
    network: 'none',
    envAllowlist: ['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec'],
    maxProcesses: 4,
    allowPty: false,
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    grantExpiresAt: null
  })
  const config = sandboxConfig(policy)
  const script = [
    "const fs = require('fs')",
    'const [insideFile, outsideFile] = process.argv.slice(1)',
    'let failed = false',
    "if (fs.readFileSync(insideFile, 'utf8') !== 'allowed') failed = true",
    'try { fs.readFileSync(outsideFile); failed = true } catch {}',
    "try { fs.writeFileSync(insideFile, 'updated'); } catch { failed = true }",
    "try { fs.writeFileSync(outsideFile, 'blocked'); failed = true } catch {}",
    'process.exit(failed ? 1 : 0)'
  ].join(';')
  try {
    await mkdir(inside, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(insideFile, 'allowed')
    await writeFile(outsideFile, 'secret')
    await writeFile(settingsPath, JSON.stringify(config, null, 2), { mode: 0o600 })
    await chmod(settingsPath, 0o600).catch(() => {})
    const node = process.env.PRIME_DESKTOP_NODE_PATH || process.execPath
    const env = { ...filteredEnv(policy), ...(process.execPath.endsWith('electron') ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
    await execFileAsync(node, [runtimeCliPath(), '--settings', settingsPath, node, '-e', script, insideFile, outsideFile], {
      env,
      timeout: 20_000,
      windowsHide: process.platform === 'win32'
    })
    const updated = await readFile(insideFile, 'utf8')
    if (updated !== 'updated') return { ok: false, reason: 'native sandbox probe did not observe the allowed write' }
    return { ok: true, reason: 'native allow/deny filesystem probe passed' }
  } catch (error) {
    return { ok: false, reason: `native allow/deny filesystem probe failed: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
}

function disabledLaunch(accessMode: AccessMode): PreparedSandboxLaunch {
  return {
    command: '',
    args: [],
    env: {},
    policy: null,
    capability: {
      platform: detectHostPlatform(),
      state: 'unenforced',
      backend: null,
      reason: accessMode === 'full'
        ? 'Full access selected; Prime Agent runs with the user account and no child sandbox.'
        : 'Protected execution was not requested.'
    },
    cleanup: async () => {}
  }
}

export async function prepareSandboxedDaemonLaunch(
  binary: string,
  socketPath: string,
  cwd: string,
  accessMode: AccessMode
): Promise<PreparedSandboxLaunch> {
  const forceSandbox = process.env[SANDBOX_ENV] === '1'
  if (accessMode === 'full' && !forceSandbox) return disabledLaunch(accessMode)

  // A developer override still uses the narrow workspace policy. It never
  // widens Full access into a fake protected label.
  const effectiveMode: AccessMode = accessMode === 'full' ? 'approve-me' : accessMode
  const policy = await createDaemonPolicy(binary, socketPath, resolve(cwd), effectiveMode)
  const capability = await dependencyCapability()
  if (capability.state !== 'enforced') {
    throw new Error(`Sandbox requested but unavailable: ${capability.reason}`)
  }

  const settingsPath = join(SANDBOX_SETTINGS_DIR, `${basename(socketPath)}.json`)
  await mkdir(SANDBOX_SETTINGS_DIR, { recursive: true })
  await writeFile(settingsPath, JSON.stringify(sandboxConfig(policy), null, 2), { mode: 0o600 })
  await chmod(settingsPath, 0o600)

  const cleanup = async (): Promise<void> => {
    await rm(settingsPath, { force: true })
  }
  const node = process.env.PRIME_DESKTOP_NODE_PATH || process.execPath
  const target = process.platform === 'win32' && /\.js$/i.test(binary)
    ? [nodeForScript(binary), binary]
    : [binary]
  return {
    command: node,
    args: [runtimeCliPath(), '--settings', settingsPath, ...target, '--mode', 'daemon', '--daemon-socket', socketPath],
    env: filteredEnv(policy),
    policy,
    capability,
    cleanup
  }
}

export async function assertSandboxedDaemonAvailable(
  binary: string,
  cwd: string,
  accessMode: AccessMode
): Promise<void> {
  if (accessMode === 'full' && process.env[SANDBOX_ENV] !== '1') return
  const effectiveMode: AccessMode = accessMode === 'full' ? 'approve-me' : accessMode
  const socketPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\prime-desktop-preflight'
    : join(SANDBOX_SETTINGS_DIR, 'preflight.sock')
  await createDaemonPolicy(binary, socketPath, resolve(cwd), effectiveMode)
  const capability = await dependencyCapability()
  if (capability.state !== 'enforced') {
    throw new Error(`Sandbox requested but unavailable: ${capability.reason}`)
  }
}

export function enforcementLabel(state: EnforcementState): string {
  if (state === 'enforced') return 'sandboxed'
  if (state === 'unavailable') return 'sandbox unavailable'
  return 'unsandboxed'
}

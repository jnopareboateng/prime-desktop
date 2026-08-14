import { spawn } from 'child_process'
import { createRequire } from 'module'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SandboxManager,
  checkWindowsDependenciesAsync
} from '@anthropic-ai/sandbox-runtime'
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'
import { registerBackend } from './runner.mts'
import type { ProbeCase, ProbeCategory, ProbeObservation } from './types.mts'
import { filterEnvironment, SAFE_ENV_NAMES } from '../../src/main/sandbox/environment.ts'

const require = createRequire(import.meta.url)
const requireNodePty = (): { spawn: (file: string, args: string[], options: Record<string, unknown>) => PtyProcess } =>
  require('node-pty') as { spawn: (file: string, args: string[], options: Record<string, unknown>) => PtyProcess }

interface PtyProcess {
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void }
  kill(): void
}

interface Fixture {
  root: string
  workspace: string
  outside: string
  outsideFile: string
  workspaceFile: string
  gitDir: string
  escapeLink: string
}

interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}

const nativeCategories: ProbeCategory[] = [
  'outside-root-read',
  'outside-root-write',
  'denied-carve-out',
  'symlink-escape',
  'child-process',
  'env-scrub',
  'network'
]

function shellQuote(value: string): string {
  if (process.platform === 'win32') return `"${value.replaceAll('"', '\\"') }"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

function commandLine(file: string, args: string[]): string {
  return [file, ...args].map(shellQuote).join(' ')
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'prime-desktop-sandbox-probe-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  const outsideFile = join(outside, 'outside.txt')
  const workspaceFile = join(workspace, 'workspace.txt')
  const gitDir = join(workspace, '.git')
  const escapeLink = join(workspace, 'escape-link')
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  await mkdir(gitDir, { recursive: true })
  await writeFile(outsideFile, 'outside-secret')
  await writeFile(workspaceFile, 'workspace-data')
  await writeFile(join(gitDir, 'config'), 'git-data')
  try {
    await symlink(outside, escapeLink, process.platform === 'win32' ? 'junction' : 'dir')
  } catch {
    // Windows developer mode may be disabled. The probe will report a clear
    // failure rather than silently converting a symlink test into a pass.
  }
  return { root, workspace, outside, outsideFile, workspaceFile, gitDir, escapeLink }
}

function configFor(fixture: Fixture, probe: ProbeCase): SandboxRuntimeConfig {
  const denyRead: string[] = []
  const allowWrite = [fixture.workspace]
  const denyWrite: string[] = []

  if (probe.id.includes('outside-root.read') || probe.id.includes('symlink.read')) denyRead.push(fixture.outside)
  if (probe.id.includes('outside-root.write') || probe.id.includes('symlink.write')) denyWrite.push(fixture.outside, fixture.outsideFile)
  if (probe.category === 'denied-carve-out') {
    denyRead.push(fixture.gitDir, fixture.gitDir + '/config')
    denyWrite.push(fixture.gitDir, fixture.gitDir + '/config')
  }
  if (probe.category === 'child-process' || probe.category === 'pty') {
    denyRead.push(fixture.outside)
    denyWrite.push(fixture.outside, fixture.outsideFile)
  }

  const proxyOnly = probe.id === 'net.proxy-only.direct-egress.denied'
  return {
    network: {
      allowedDomains: proxyOnly ? ['example.com'] : [],
      deniedDomains: proxyOnly ? [] : ['*'],
      strictAllowlist: true
    },
    filesystem: {
      denyRead,
      allowRead: [fixture.workspace],
      allowWrite,
      denyWrite
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false
  } as SandboxRuntimeConfig
}

function scriptFor(probe: ProbeCase, fixture: Fixture): string {
  const fs = JSON.stringify({ outsideFile: fixture.outsideFile, workspaceFile: fixture.workspaceFile, gitConfig: join(fixture.gitDir, 'config'), escapeLink: fixture.escapeLink })
  const success = 'process.exit(0)'
  const fail = 'process.exit(1)'
  if (probe.id === 'fs.outside-root.read.denied' || probe.id === 'fs.workspace.read.allowed') {
    const path = probe.id.includes('outside') ? 'p.outsideFile' : 'p.workspaceFile'
    return `const fs=require('fs');const p=${fs};try{fs.readFileSync(${path});${success}}catch{${fail}}`
  }
  if (probe.id === 'fs.outside-root.write.denied' || probe.id === 'fs.workspace.write.allowed') {
    const path = probe.id.includes('outside') ? 'p.outsideFile' : 'p.workspaceFile'
    return `const fs=require('fs');const p=${fs};try{fs.writeFileSync(${path},'probe');${success}}catch{${fail}}`
  }
  if (probe.category === 'denied-carve-out') {
    const write = probe.id.includes('write')
    return `const fs=require('fs');const p=${fs};try{${write ? "fs.writeFileSync(p.gitConfig,'probe')" : 'fs.readFileSync(p.gitConfig)'};${success}}catch{${fail}}`
  }
  if (probe.category === 'symlink-escape') {
    const write = probe.id.includes('write')
    const operation = write ? "fs.writeFileSync(p.escapeLink+'/escaped.txt','probe')" : "fs.readFileSync(p.escapeLink+'/outside.txt')"
    return `const fs=require('fs');const p=${fs};try{${operation};${success}}catch{${fail}}`
  }
  if (probe.category === 'child-process') {
    const grandchild = probe.id.includes('grandchild')
    const shell = probe.id.includes('shell-metacharacters')
    const child = shell
      ? `require('child_process').spawnSync(process.platform==='win32'?'cmd.exe':'/bin/sh',['-c',${JSON.stringify(`node -e "require('fs').writeFileSync(${fixture.outsideFile},'escape')"`)}],{stdio:'ignore'})`
      : grandchild
        ? `require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(`require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(`require('fs').writeFileSync(${fixture.outsideFile},'escape')`)}],{stdio:'ignore'})`)}],{stdio:'ignore'})`
        : `require('child_process').spawnSync(process.execPath,['-e',${JSON.stringify(`require('fs').writeFileSync(${fixture.outsideFile},'escape')`)}],{stdio:'ignore'})`
    return `${child};const fs=require('fs');setTimeout(()=>{try{fs.accessSync(${JSON.stringify(fixture.outsideFile)});${success}}catch{${fail}}},100)`
  }
  if (probe.category === 'env-scrub') {
    return `process.exit(process.env.PRIME_PROBE_SECRET===undefined ? 1 : 0)`
  }
  if (probe.category === 'network') {
    const network = probe.id.includes('dns')
      ? `require('dns').promises.resolve('example.com')`
      : `new Promise((resolve,reject)=>{const s=require('net').connect(80,'1.1.1.1');s.once('connect',()=>{s.destroy();resolve()});s.once('error',reject);setTimeout(()=>reject(new Error('timeout')),1000)})`
    return `(async()=>{try{await ${network};${success}}catch{${fail}}})()`
  }
  if (probe.category === 'pty') {
    const path = probe.id.includes('outside') ? 'p.outsideFile' : 'p.workspaceFile'
    return `const fs=require('fs');const p=${fs};try{fs.writeFileSync(${path},'probe');${success}}catch{${fail}}`
  }
  if (probe.id === 'limits.timeout.enforced') return `setInterval(()=>{},1000)`
  if (probe.id === 'limits.output-cap.enforced') return `process.stdout.write('x'.repeat(128*1024))`
  return `process.exit(1)`
}

async function runCommand(command: string, args: string[], fixture: Fixture, config: SandboxRuntimeConfig, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  await SandboxManager.reset().catch(() => {})
  await SandboxManager.initialize(config)
  const wrapped = await SandboxManager.wrapWithSandboxArgv(commandLine(command, args), undefined, undefined, undefined, fixture.workspace)
  return new Promise<RunResult>((resolve) => {
    const stdout: string[] = []
    const stderr: string[] = []
    let bytes = 0
    let truncated = false
    let settled = false
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd: fixture.workspace,
      env: { ...wrapped.env, ...env },
      shell: false,
      windowsHide: true
    })
    const collect = (target: string[]) => (chunk: Buffer | string) => {
      const value = String(chunk)
      bytes += Buffer.byteLength(value)
      if (bytes > 64 * 1024) truncated = true
      if (!truncated) target.push(value)
    }
    child.stdout?.on('data', collect(stdout))
    child.stderr?.on('data', collect(stderr))
    const timer = setTimeout(() => {
      child.kill()
      finish({ code: null, signal: 'SIGTERM', stdout: stdout.join(''), stderr: stderr.join(''), timedOut: true, truncated })
    }, 5_000)
    child.once('error', (error) => finish({ code: null, signal: null, stdout: stdout.join(''), stderr: `${stderr.join('')}\n${error.message}`, timedOut: false, truncated }))
    child.once('exit', (code, signal) => finish({ code, signal, stdout: stdout.join(''), stderr: stderr.join(''), timedOut: false, truncated }))
  })
}

async function runPty(command: string, args: string[], fixture: Fixture, config: SandboxRuntimeConfig): Promise<RunResult> {
  await SandboxManager.reset().catch(() => {})
  await SandboxManager.initialize(config)
  const wrapped = await SandboxManager.wrapWithSandboxArgv(commandLine(command, args), undefined, undefined, undefined, fixture.workspace)
  const pty = requireNodePty().spawn(wrapped.argv[0], wrapped.argv.slice(1), { cwd: fixture.workspace, env: wrapped.env, name: 'xterm-color', cols: 80, rows: 24 })
  return new Promise<RunResult>((resolve) => {
    let output = ''
    let settled = false
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      pty.kill()
      resolve(result)
    }
    pty.onData((data) => { output += data })
    pty.onExit(({ exitCode }) => finish({ code: exitCode, signal: null, stdout: output, stderr: '', timedOut: false, truncated: output.length > 64 * 1024 }))
    const timer = setTimeout(() => finish({ code: null, signal: 'SIGTERM', stdout: output, stderr: '', timedOut: true, truncated: false }), 5_000)
  })
}

async function executeProbe(probe: ProbeCase): Promise<ProbeObservation> {
  const fixture = await createFixture()
  try {
    if (probe.category === 'daemon-attach') throw new Error('daemon attach probes use the Electron broker integration suite')
    const config = configFor(fixture, probe)
    const args = ['-e', scriptFor(probe, fixture)]
    const probeEnv = probe.category === 'env-scrub'
      ? filterEnvironment(
        probe.expect === 'allow' ? [...SAFE_ENV_NAMES, 'PRIME_PROBE_SECRET'] : SAFE_ENV_NAMES,
        { ...process.env, PRIME_PROBE_SECRET: 'visible' }
      )
      : {}
    const result = probe.category === 'pty'
      ? await runPty(process.execPath, args, fixture, config)
      : await runCommand(process.execPath, args, fixture, config, probeEnv)
    const denied = result.timedOut || result.truncated || result.code !== 0
    const outcome = denied ? 'deny' : 'allow'
    return {
      outcome,
      detail: `native ${process.platform}; exit=${result.code ?? 'none'}${result.timedOut ? ', timeout' : ''}${result.truncated ? ', output capped' : ''}`
    }
  } finally {
    await SandboxManager.reset().catch(() => {})
    await rm(fixture.root, { recursive: true, force: true })
  }
}

export async function registerNativeBackends(): Promise<boolean> {
  const dependencies = process.platform === 'win32'
    ? await checkWindowsDependenciesAsync()
    : await SandboxManager.checkDependenciesAsync()
  if (dependencies.errors.length > 0) return false
  for (const category of nativeCategories) registerBackend(category, executeProbe)
  return true
}

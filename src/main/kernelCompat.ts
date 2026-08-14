import { copyFile, mkdir } from 'fs/promises'
import { existsSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const KERNEL_IMPORT_CHECK = 'import ipykernel, rlm, dill, requests, httpx, yaml, tomli, toml, dotenv, pandas, numpy, scipy, bs4, lxml, pydantic, tyro'
const KERNEL_PACKAGES = [
  'ipykernel',
  'dill',
  'requests',
  'http',
  'pyyaml',
  'toml',
  'httpx',
  'tomli',
  'python-dotenv',
  'pandas',
  'numpy',
  'scipy',
  'beautifulsoup4',
  'lxml',
  'pydantic',
  'tyro'
]

/**
 * Prime Agent 0.7.x resolves its managed kernel interpreter through
 * `kernel-venv/bin/python`, including on Windows. Python's Windows venv
 * layout is `Scripts/python.exe`; mirror the launcher into the path Prime
 * Agent already uses so first-run bootstrap can complete without user repair.
 */
export async function ensureWindowsKernelVenvCompat(): Promise<void> {
  if (process.platform !== 'win32') return

  const venv = join(homedir(), '.prime', 'agent', 'kernel-venv')
  const scripts = join(venv, 'Scripts')
  const bin = join(venv, 'bin')
  const launchers = ['python.exe', 'pythonw.exe']

  if (!launchers.every((name) => existsSync(join(scripts, name)))) {
    const uv = [
      join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'hermes', 'bin', 'uv.exe'),
      'uv.exe'
    ].find((candidate) => candidate === 'uv.exe' || existsSync(candidate))
    if (!uv) return
    try {
      await execFileAsync(uv, ['venv', '--python', '3.11', '--allow-existing', venv], {
        timeout: 5 * 60_000,
        windowsHide: true
      })
    } catch {
      // Prime Agent will report its own bootstrap diagnostics if Python cannot
      // be provisioned; the desktop must still open normally.
    }
  }

  if (!launchers.every((name) => existsSync(join(scripts, name)))) return

  await mkdir(bin, { recursive: true })
  for (const name of launchers) {
    await copyFile(join(scripts, name), join(bin, name))
    // uv may receive the extensionless path from Prime Agent's portable path
    // resolver. Keep that spelling valid as well.
    await copyFile(join(scripts, name), join(bin, name.replace(/\.exe$/i, '')))
  }
}

/** Prepare the bundled Prime Agent Python bridge before the first agent starts. */
export async function ensureWindowsKernelRuntime(binary: string): Promise<string | null> {
  if (process.platform !== 'win32') return null

  await ensureWindowsKernelVenvCompat()
  const venv = join(homedir(), '.prime', 'agent', 'kernel-venv')
  const python = join(venv, 'Scripts', 'python.exe')
  if (!existsSync(python)) return null

  try {
    await execFileAsync(python, ['-c', KERNEL_IMPORT_CHECK], { timeout: 20_000, windowsHide: true })
    return python
  } catch {
    /* install the first-run runtime below */
  }

  const uv = [
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'hermes', 'bin', 'uv.exe'),
    'uv.exe'
  ].find((candidate) => candidate === 'uv.exe' || existsSync(candidate))
  if (!uv) return null

  let packageRoot = ''
  try {
    const resolved = realpathSync(binary)
    const marker = join('dist', 'bundle', 'cli.js')
    if (resolved.endsWith(marker)) packageRoot = dirname(dirname(dirname(resolved)))
  } catch {
    /* use Prime Agent's own bootstrap if the install path is unavailable */
  }
  const runtime = join(packageRoot, 'dist', 'prime-agent-runtime')
  if (!packageRoot || !existsSync(runtime)) return null

  try {
    await execFileAsync(uv, [
      'pip', 'install', '--python', python,
      ...KERNEL_PACKAGES.slice(0, 1), runtime, ...KERNEL_PACKAGES.slice(1)
    ], {
      timeout: 10 * 60_000,
      windowsHide: true
    })
    await execFileAsync(python, ['-c', KERNEL_IMPORT_CHECK], { timeout: 20_000, windowsHide: true })
    return python
  } catch (error) {
    console.warn('[prime-desktop] Windows Python runtime bootstrap failed:', error instanceof Error ? error.message : String(error))
    return null
  }
}

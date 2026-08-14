import { execFile } from 'child_process'
import { mkdir, writeFile, chmod } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { promisify } from 'util'
import https from 'https'
import { EventEmitter } from 'events'
import { createHash } from 'crypto'

const execFileAsync = promisify(execFile)

const INSTALL_URL = 'https://app.primeintellect.ai/prime-agent/install.sh'
const INSTALL_HOST = 'app.primeintellect.ai'
const BIN_DIR = process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'PrimeDesktop', 'bin')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'PrimeDesktop', 'bin')
    : join(homedir(), '.local', 'share', 'PrimeDesktop', 'bin')

function windowsNodeDirectories(): string[] {
  if (process.platform !== 'win32') return []
  return [
    process.env.NVM_SYMLINK,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : undefined,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : undefined,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : undefined,
    'C:\\nvm4w\\nodejs'
  ].filter(Boolean) as string[]
}

function windowsPrimeAgentCli(wrapper: string): string | null {
  if (process.platform !== 'win32') return null
  if (/\.js$/i.test(wrapper) && existsSync(wrapper)) return wrapper
  if (!/\.(cmd|bat|ps1)$/i.test(wrapper)) return null
  const directories = [
    dirname(wrapper),
    dirname(dirname(wrapper))
  ]
  for (const directory of directories) {
    const cli = join(directory, 'node_modules', 'prime-agent', 'dist', 'bundle', 'cli.js')
    if (existsSync(cli)) return cli
  }
  return null
}

function bundledPrimeAgentCli(): string | null {
  const roots = [
    process.resourcesPath ? join(process.resourcesPath, 'app.asar.unpacked') : undefined,
    process.resourcesPath ? join(process.resourcesPath, 'app.asar') : undefined,
    join(__dirname, '..', '..')
  ].filter(Boolean) as string[]
  for (const root of roots) {
    const cli = join(root, 'node_modules', 'prime-agent', 'dist', 'bundle', 'cli.js')
    if (existsSync(cli)) return cli
  }
  return null
}

function nodeForScript(script: string): { command: string; electron: boolean } {
  if (process.platform !== 'win32') return { command: 'node', electron: false }
  if (process.env.PRIME_DESKTOP_NODE_PATH) return { command: process.env.PRIME_DESKTOP_NODE_PATH, electron: false }
  let directory = dirname(script)
  for (let i = 0; i < 6; i++) {
    const candidate = join(directory, 'node.exe')
    if (existsSync(candidate)) return { command: candidate, electron: false }
    directory = dirname(directory)
  }
  return { command: process.execPath, electron: basename(process.execPath).toLowerCase() !== 'node.exe' }
}

export class BinaryManager extends EventEmitter {
  private state: {
    status: 'checking' | 'found' | 'installing' | 'installed' | 'error'
    path: string | null
    version: string | null
    error: string | null
    progress?: number
  } = { status: 'checking', path: null, version: null, error: null }

  get stateSnapshot() {
    return { ...this.state }
  }

  async check(): Promise<void> {
    this.state.status = 'checking'
    this.emit('change', this.stateSnapshot)
    try {
      const local = await this.findLocalInstall()
      if (local) {
        this.state.path = local.path
        this.state.version = local.version
        this.state.status = 'found'
      } else {
        this.state.status = 'error'
        this.state.error = 'prime-agent not found on PATH and not installed locally.'
      }
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err.message : String(err)
    }
    this.emit('change', this.stateSnapshot)
  }

  private async findLocalInstall(): Promise<{ path: string; version: string | null } | null> {
    const candidates = [
      this.state.path,
      process.env.PRIME_AGENT_PATH,
      bundledPrimeAgentCli(),
      join(BIN_DIR, 'prime-agent'),
      join(homedir(), '.local', 'bin', 'prime-agent'),
      '/opt/homebrew/bin/prime-agent',
      '/usr/local/bin/prime-agent',
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Prime Agent', 'prime-agent.exe'),
      ...windowsNodeDirectories().flatMap((directory) => [
        join(directory, 'prime-agent.cmd'),
        join(directory, 'prime-agent.ps1'),
        join(directory, 'prime-agent.exe')
      ])
    ].filter(Boolean) as string[]

    for (const c of candidates) {
      if (existsSync(c)) {
        const version = await this.getVersion(c)
        if (version) return { path: c, version }
      }
    }

    try {
      const locator = process.platform === 'win32' ? 'where.exe' : 'which'
      const command = process.platform === 'win32' ? 'prime-agent.cmd' : 'prime-agent'
      const { stdout } = await execFileAsync(locator, [command])
      const p = stdout.trim().split(/\r?\n/)[0]
      if (p) {
        const version = await this.getVersion(p)
        return { path: p, version }
      }
    } catch {
      /* not on PATH */
    }
    return null
  }

  private async getVersion(bin: string): Promise<string | null> {
    try {
      const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
      const isWindowsJs = process.platform === 'win32' && /\.js$/i.test(bin)
      const node = isWindowsJs ? nodeForScript(bin) : null
      const command = isWindowsScript ? (process.env.ComSpec ?? 'cmd.exe') : node?.command ?? bin
      const args = isWindowsScript
        ? ['/d', '/s', '/c', `"${bin}" --version`]
        : isWindowsJs ? [bin, '--version'] : ['--version']
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: 10000,
        env: node?.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : undefined
      })
      const text = (stdout + stderr).trim().split('\n')[0]
      return text || null
    } catch {
      return null
    }
  }

  async install(): Promise<void> {
    this.state.status = 'installing'
    this.state.progress = 0
    this.emit('change', this.stateSnapshot)
    try {
      if (process.platform === 'win32') {
        const npm = await this.findWindowsNpm()
        if (!npm) throw new Error('npm was not found. Install Node.js 20+ or set PRIME_AGENT_PATH, then retry.')
        await execFileAsync(npm, ['install', '--global', 'prime-agent'], {
          timeout: 10 * 60_000,
          windowsHide: true,
          shell: true
        })
        this.state.progress = 1
        const local = await this.findLocalInstall()
        if (!local) throw new Error('npm completed, but prime-agent could not be located.')
        this.state.path = local.path
        this.state.version = local.version
        this.state.status = 'installed'
        this.state.error = null
        delete this.state.progress
        this.emit('change', this.stateSnapshot)
        return
      }
      await mkdir(BIN_DIR, { recursive: true })
      const script = await this.download(INSTALL_URL, (pct) => {
        this.state.progress = pct * 0.5
        this.emit('change', this.stateSnapshot)
      })
      const expectedSha256 = process.env.PRIME_AGENT_INSTALL_SHA256?.trim().toLowerCase()
      if (!expectedSha256) {
        throw new Error('Installer integrity is not configured; automatic installation is disabled.')
      }
      const actualSha256 = createHash('sha256').update(script).digest('hex')
      if (actualSha256 !== expectedSha256) {
        throw new Error('Installer checksum did not match the configured value.')
      }
      const scriptPath = join(BIN_DIR, 'install.sh')
      await writeFile(scriptPath, script)
      await chmod(scriptPath, 0o755)
      this.state.progress = 0.6
      this.emit('change', this.stateSnapshot)
      await execFileAsync('sh', [scriptPath], { env: { ...process.env, PATH: `${BIN_DIR}:${process.env.PATH ?? ''}` } })
      this.state.progress = 1
      const local = await this.findLocalInstall()
      if (local) {
        this.state.path = local.path
        this.state.version = local.version
        this.state.status = 'installed'
        this.state.error = null
      } else {
        this.state.status = 'error'
        this.state.error = 'Installer ran but prime-agent could not be located.'
      }
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err.message : String(err)
    }
    this.emit('change', this.stateSnapshot)
  }

  private download(url: string, onProgress: (pct: number) => void, redirects = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      if (redirects > 5) {
        reject(new Error('Installer redirected too many times.'))
        return
      }
      let current: URL
      try {
        current = new URL(url)
      } catch {
        reject(new Error('Installer URL was invalid.'))
        return
      }
      if (current.protocol !== 'https:' || current.hostname !== INSTALL_HOST) {
        reject(new Error(`Installer host must remain ${INSTALL_HOST}.`))
        return
      }
      const req = https.get(url, { headers: { 'User-Agent': 'prime-desktop' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirected: URL
          try {
            redirected = new URL(res.headers.location, url)
          } catch {
            reject(new Error('Installer redirect was invalid.'))
            res.resume()
            return
          }
          if (redirected.protocol !== 'https:' || redirected.hostname !== INSTALL_HOST) {
            reject(new Error(`Installer redirects must remain HTTPS on ${INSTALL_HOST}.`))
            res.resume()
            return
          }
          this.download(redirected.href, onProgress, redirects + 1).then(resolve, reject)
          res.resume()
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`))
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        const total = Number(res.headers['content-length'] ?? 0)
        let received = 0
        res.on('data', (c: Buffer) => {
          chunks.push(c)
          received += c.length
          if (total > 0) onProgress(received / total)
        })
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      })
      req.on('error', reject)
    })
  }

  getBinary(): string {
    if (this.state.path && existsSync(this.state.path)) {
      return windowsPrimeAgentCli(this.state.path) ?? this.state.path
    }
    const p = process.platform === 'win32' ? join(BIN_DIR, 'prime-agent.cmd') : join(BIN_DIR, 'prime-agent')
    if (existsSync(p)) return windowsPrimeAgentCli(p) ?? p
    return 'prime-agent'
  }

  private async findWindowsNpm(): Promise<string | null> {
    const candidates = [
      ...windowsNodeDirectories().map((directory) => join(directory, 'npm.cmd')),
      'npm.cmd'
    ]
    for (const candidate of candidates) {
      if (candidate !== 'npm.cmd' && !existsSync(candidate)) continue
      try {
        await execFileAsync(candidate, ['--version'], { timeout: 10_000, windowsHide: true, shell: true })
        return candidate
      } catch {
        /* try the next Node installation */
      }
    }
    return null
  }
}

export function readAuthFile(): Record<string, string> {
  try {
    const p = join(homedir(), '.prime', 'agent', 'auth.json')
    if (existsSync(p)) {
      return JSON.parse(readFileSyncSafe(p)) as Record<string, string>
    }
  } catch {
    /* ignore */
  }
  return {}
}

function readFileSyncSafe(p: string): string {
  return readFileSync(p, 'utf8')
}

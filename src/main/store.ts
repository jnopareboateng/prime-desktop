import { readFile, writeFile, mkdir, rename, rm, chmod } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { AppSettings, ProjectTab } from '@shared/types'
import { CODEX_DARK_THEME, PRIME_LIGHT_THEME } from '@shared/themes'

export interface StoredState {
  settings: AppSettings
  tabs: ProjectTab[]
  activeTabId: string | null
  model: string | null
}

function stateFile(): string {
  return join(app.getPath('userData'), 'state.json')
}

const LEGACY_WINDOWS_STATE_FILE = join(homedir(), 'Library', 'Application Support', 'PrimeDesktop', 'state.json')

const DEFAULTS: AppSettings = {
  notifications: true,
  checkpoints: true,
  dockBadge: false,
  thinkingLevel: 'medium',
  autoCompaction: true,
  autoRetry: true,
  model: null,
  rlmMaxDepth: 1,
  accessMode: 'full',
  themeMode: 'system',
  codeThemeId: 'codex',
  lightTheme: PRIME_LIGHT_THEME,
  darkTheme: CODEX_DARK_THEME
}

let cache: StoredState | null = null

async function load(): Promise<StoredState> {
  if (cache) return cache
  try {
    const file = existsSync(stateFile())
      ? stateFile()
      : process.platform === 'win32' && existsSync(LEGACY_WINDOWS_STATE_FILE)
        ? LEGACY_WINDOWS_STATE_FILE
        : stateFile()
    if (existsSync(file)) {
      const raw = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredState>
      cache = {
        settings: { ...DEFAULTS, ...(raw.settings ?? {}) },
        tabs: raw.tabs ?? [],
        activeTabId: raw.activeTabId ?? null,
        model: raw.model ?? null
      }
    } else {
      cache = { settings: { ...DEFAULTS }, tabs: [], activeTabId: null, model: null }
    }
  } catch {
    cache = { settings: { ...DEFAULTS }, tabs: [], activeTabId: null, model: null }
  }
  return cache
}

async function save(next: StoredState): Promise<void> {
  const file = stateFile()
  await mkdir(join(file, '..'), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
    await chmod(temporary, 0o600).catch(() => {})
    await rename(temporary, file)
    cache = next
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

export async function getState(): Promise<StoredState> {
  return load()
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const s = await load()
  const next = { ...s, settings: { ...s.settings, ...patch } }
  await save(next)
  return next.settings
}

export async function setTabs(tabs: ProjectTab[], activeTabId: string | null): Promise<void> {
  const s = await load()
  await save({ ...s, tabs, activeTabId })
}

export async function setModel(model: string | null): Promise<void> {
  const s = await load()
  await save({ ...s, model })
}

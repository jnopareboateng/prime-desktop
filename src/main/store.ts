import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
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

async function save(): Promise<void> {
  if (!cache) return
  const file = stateFile()
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, JSON.stringify(cache, null, 2))
}

export async function getState(): Promise<StoredState> {
  return load()
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const s = await load()
  s.settings = { ...s.settings, ...patch }
  await save()
  return s.settings
}

export async function setTabs(tabs: ProjectTab[], activeTabId: string | null): Promise<void> {
  const s = await load()
  s.tabs = tabs
  s.activeTabId = activeTabId
  await save()
}

export async function setModel(model: string | null): Promise<void> {
  const s = await load()
  s.model = model
  await save()
}

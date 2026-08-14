import { readFile, writeFile, mkdir, chmod, rename, rm } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { PermissionRule } from '@shared/types'

const APP_SUPPORT_DIR = process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'PrimeDesktop')
  : process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'PrimeDesktop')
    : join(homedir(), '.local', 'share', 'PrimeDesktop')
const PERM_FILE = join(APP_SUPPORT_DIR, 'permissions.json')

let cache: PermissionRule[] | null = null
let mutationChain: Promise<void> = Promise.resolve()

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(operation)
  mutationChain = next.then(() => undefined, () => undefined)
  return next
}

async function load(): Promise<PermissionRule[]> {
  if (cache) return cache
  if (!existsSync(PERM_FILE)) {
    cache = []
    return cache
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(PERM_FILE, 'utf8'))
  } catch (error) {
    throw new Error(`Permission rules could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) throw new Error('Permission rules file must contain an array.')
  cache = parsed.map((rule, index) => normalizeRule(rule, index))
  return cache
}

function normalizeRule(value: unknown, index: number): PermissionRule {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Permission rule ${index + 1} must be an object.`)
  const rule = value as Record<string, unknown>
  if (typeof rule.pattern !== 'string' || rule.pattern.trim().length === 0) throw new Error(`Permission rule ${index + 1} has no pattern.`)
  if (rule.action !== 'allow' && rule.action !== 'deny') throw new Error(`Permission rule ${index + 1} has an invalid action.`)
  if (rule.scope !== 'global' && rule.scope !== 'project') throw new Error(`Permission rule ${index + 1} has an invalid scope.`)
  if (rule.scope === 'project' && (typeof rule.projectPath !== 'string' || rule.projectPath.trim().length === 0)) {
    throw new Error(`Permission rule ${index + 1} must include a project path.`)
  }
  return {
    pattern: rule.pattern.trim(),
    action: rule.action,
    scope: rule.scope,
    ...(typeof rule.projectPath === 'string' ? { projectPath: rule.projectPath } : {})
  }
}

async function save(rules: PermissionRule[]): Promise<void> {
  await mkdir(APP_SUPPORT_DIR, { recursive: true })
  const temporary = `${PERM_FILE}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, JSON.stringify(rules, null, 2), { mode: 0o600 })
    await chmod(temporary, 0o600).catch(() => {})
    await rename(temporary, PERM_FILE)
    cache = rules
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

export async function listRules(): Promise<PermissionRule[]> {
  return (await load()).slice().reverse()
}

export async function rulesForProject(projectPath: string): Promise<PermissionRule[]> {
  const project = resolve(projectPath)
  return (await load()).filter((rule) =>
    rule.scope === 'global' || (typeof rule.projectPath === 'string' && resolve(rule.projectPath) === project)
  )
}

export async function addRule(rule: PermissionRule): Promise<PermissionRule[]> {
  return enqueueMutation(async () => {
    const current = await load()
    const rules = [...current, normalizeRule(rule, current.length)]
    await save(rules)
    return rules.slice().reverse()
  })
}

export async function removeRule(indexFromEnd: number): Promise<PermissionRule[]> {
  return enqueueMutation(async () => {
    const rules = [...await load()]
    if (!Number.isInteger(indexFromEnd) || indexFromEnd < 0 || indexFromEnd >= rules.length) throw new Error('Unknown permission rule.')
    rules.splice(rules.length - 1 - indexFromEnd, 1)
    await save(rules)
    return rules.slice().reverse()
  })
}

export async function replaceRules(rules: PermissionRule[]): Promise<void> {
  return enqueueMutation(async () => save(rules.map((rule, index) => normalizeRule(rule, index))))
}

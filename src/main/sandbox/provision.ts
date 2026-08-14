import { writeFile } from 'fs/promises'
import { join } from 'path'
import {
  checkWindowsDependenciesAsync,
  installWindowsSandboxAsync,
  resolveSrtWin
} from '@anthropic-ai/sandbox-runtime'
import { app } from 'electron'
import { runtimeSrtWinPath } from './runtime'
import type { AccessMode } from '@shared/types'

export async function provisionWindowsSandbox(accessMode: AccessMode): Promise<{ ready: boolean; attempted: boolean; error?: string }> {
  if (process.platform !== 'win32') return { ready: false, attempted: false }
  if (accessMode === 'full' && process.env.PRIME_DESKTOP_SANDBOX !== '1') {
    return { ready: false, attempted: false }
  }

  const recordPath = join(app.getPath('userData'), 'sandbox-bootstrap.json')

  try {
    const srtWin = resolveSrtWin({ path: runtimeSrtWinPath() })
    const current = await checkWindowsDependenciesAsync({ srtWin })
    if (current.errors.length === 0) {
      await writeFile(recordPath, JSON.stringify({ version: app.getVersion(), attempted: false, ready: true }, null, 2))
      return { ready: true, attempted: false }
    }

    const installed = await installWindowsSandboxAsync({ srtWin })
    if (installed.cancelled) throw new Error('Windows sandbox setup was cancelled.')
    const after = await checkWindowsDependenciesAsync({ srtWin })
    if (after.errors.length > 0) throw new Error(after.errors.join('; '))
    await writeFile(recordPath, JSON.stringify({ version: app.getVersion(), attempted: true, ready: true }, null, 2))
    return { ready: true, attempted: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(recordPath, JSON.stringify({ version: app.getVersion(), attempted: true, ready: false, error: message }, null, 2))
    return { ready: false, attempted: true, error: message }
  }
}

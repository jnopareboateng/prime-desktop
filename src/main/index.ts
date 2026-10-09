import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { BinaryManager } from './binary'
import { AgentManager } from './agentManager'
import { registerIpc } from './ipc'
import { getState } from './store'
import { PRODUCT_NAME } from '../shared/product'
import type { AppSettings } from '@shared/types'
import { resolveThemeMode } from '@shared/themes'
import { provisionWindowsSandbox } from './sandbox/provision'
import { ensureWindowsKernelRuntime } from './kernelCompat'

let mainWindow: BrowserWindow | null = null
let manager: AgentManager | null = null

function createWindow(settings: AppSettings): void {
  const variant = resolveThemeMode(settings.themeMode, nativeTheme.shouldUseDarkColors)
  const windowTheme = variant === 'dark' ? settings.darkTheme : settings.lightTheme
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: PRODUCT_NAME,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 18 }
        }
      : {
          // The renderer owns the Codex-style chrome on Windows/Linux. Keep
          // the native window buttons overlaid without adding a title band.
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: windowTheme.surface,
            symbolColor: windowTheme.ink,
            height: 44
          }
        }),
    backgroundColor: windowTheme.surface,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let allowed = false
    try {
      const target = new URL(url)
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      allowed = devUrl
        ? target.origin === new URL(devUrl).origin
        : target.protocol === 'file:'
    } catch {
      allowed = false
    }
    if (!allowed) event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-folder')
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]
  // The renderer owns the Codex-style chrome on every platform. Keeping an
  // additional native application menu would create a second menu surface on
  // macOS and reintroduce the titlebar/menu duplication this shell avoids.
  void template
  Menu.setApplicationMenu(null)
}

app.whenReady().then(async () => {
  buildMenu()

  const binary = new BinaryManager()
  manager = new AgentManager(binary)
  registerIpc(() => mainWindow, manager, binary)

  const state = await getState()
  await binary.check()
  createWindow(state.settings)

  // Provisioning is gated by the selected access mode. Full access must never
  // trigger UAC or sandbox setup, while protected sessions must not race their
  // first daemon against the runtime installer.
  const kernelReady = ensureWindowsKernelRuntime(binary.getBinary())
    .then((kernelPython) => {
      if (kernelPython) process.env.PRIME_AGENT_KERNEL_PYTHON = kernelPython
    })
    .catch((error) => {
      console.warn('[prime-desktop] Windows kernel runtime setup deferred:', error instanceof Error ? error.message : String(error))
    })
  const sandboxReady = provisionWindowsSandbox(state.settings.accessMode)

  const [_, sandbox] = await Promise.all([kernelReady, sandboxReady])
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (sandbox.attempted) {
    mainWindow.webContents.send('toasts', sandbox.ready
      ? { id: `sandbox-${Date.now()}`, kind: 'info', text: 'Windows sandbox dependencies are ready; enforcement will be verified before protected agent start.' }
      : { id: `sandbox-${Date.now()}`, kind: 'error', text: `Protected sandbox setup needs attention: ${sandbox.error ?? 'unavailable'}` })
  }

  for (const tab of state.tabs) {
    try {
      await manager.openTab(tab, state.settings)
    } catch {
      /* skip broken tabs */
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void getState().then((latest) => createWindow(latest.settings))
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void manager?.shutdownAll().finally(() => app.quit())
})

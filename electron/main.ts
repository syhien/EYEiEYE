import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, screen, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import activeWin from 'active-win'
import { Resvg } from '@resvg/resvg-js'

import { DEFAULT_SETTINGS, type AppStatus, type Settings } from '../src/shared/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null
let paused = false
let timers: NodeJS.Timeout[] = []
let activeRestWindow: { win: BrowserWindow; allowClose: () => void } | null = null
let isQuitting = false

const APP_ID = 'com.eyeieye.app'

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeSettings(input: Partial<Settings> | undefined | null): Settings {
  const base = { ...DEFAULT_SETTINGS, ...(input ?? {}) }
  return {
    smallIntervalMinutes: Math.trunc(clampNumber(base.smallIntervalMinutes, 1, 240, DEFAULT_SETTINGS.smallIntervalMinutes)),
    smallDurationSeconds: Math.trunc(clampNumber(base.smallDurationSeconds, 1, 30, DEFAULT_SETTINGS.smallDurationSeconds)),
    bigIntervalMinutes: Math.trunc(clampNumber(base.bigIntervalMinutes, 5, 480, DEFAULT_SETTINGS.bigIntervalMinutes)),
    bigDurationMinutes: Math.trunc(clampNumber(base.bigDurationMinutes, 1, 30, DEFAULT_SETTINGS.bigDurationMinutes)),
    openAtLogin: Boolean((base as Settings).openAtLogin),
  }
}

function applyAutoStart(openAtLogin: boolean) {
  // Note: On Windows this is most reliable in packaged builds.
  if (process.platform !== 'win32') return
  try {
    app.setLoginItemSettings({
      openAtLogin,
      // Ensure it points to the packaged exe.
      path: process.execPath,
    })
  } catch {
    // Ignore failures; user can still run the app manually.
  }
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8')
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function loadRenderer(target: BrowserWindow, query: Record<string, string>) {
  if (VITE_DEV_SERVER_URL) {
    const url = new URL(VITE_DEV_SERVER_URL)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    target.loadURL(url.toString())
  } else {
    target.loadFile(path.join(RENDERER_DIST, 'index.html'), { query })
  }
}

async function rasterizeSvgToNativeImage(svgPath: string, size: number) {
  try {
    const svg = await fs.readFile(svgPath, 'utf-8')
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
    })
    const png = resvg.render().asPng()
    return nativeImage.createFromBuffer(Buffer.from(png))
  } catch {
    return nativeImage.createEmpty()
  }
}

async function getAppWindowIcon(size = 256) {
  const svgPath = path.join(process.env.VITE_PUBLIC, '眼睛-睁眼.svg')
  const icon = await rasterizeSvgToNativeImage(svgPath, size)
  if (!icon.isEmpty()) return icon

  const fallbackSvg = path.join(process.env.VITE_PUBLIC, 'electron-vite.svg')
  const fallback = await rasterizeSvgToNativeImage(fallbackSvg, size)
  return fallback
}

async function getTrayImage() {
  // On Windows tray icons are most reliable as PNG/ICO (SVG often renders invisible).
  const svgPath = path.join(process.env.VITE_PUBLIC, '眼睛-睁眼.svg')

  const scale = screen.getPrimaryDisplay().scaleFactor
  const size = scale >= 2 ? 32 : 16

  const image = await rasterizeSvgToNativeImage(svgPath, size)
  if (!image.isEmpty()) return image

  // Fallback: try the default svg
  const fallbackSvg = path.join(process.env.VITE_PUBLIC, 'electron-vite.svg')
  const fallback = await rasterizeSvgToNativeImage(fallbackSvg, size)
  if (!fallback.isEmpty()) return fallback

  // Last resort: a visible orange dot.
  const dataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABy0lEQVRYR+2WPUvDUBSGv0m6QYqg1Kk4dHGRIYh0cXJwE3EwDk4O0cFJxE1wEJxE1wEJxE0qC0qD0QqO7Kkqkqv1jJ7x1y4pY2v4r8c8H3iWlWQkJr3kqVQ3gE6GJb6wqQkJjJ0qKXqkK8dEoQpV2k2k1xg3g8q7k8R2dU8Ywq8qk9Dk3r2cU8+O4rjK0a9i1Rk3g6mN2lXo8Hk8w6m0+W8fQwq5mC3HnYb0l7Qm4e8xq8sXgJbQb6VbGZfJtQyqk6x8yZ8y3C0h5bqzZ4uOe8aV0kQ9vYB6rYc5j5G3xQGx0c8g3oGgGm6YQk8b7gQ4b8c9p1Q5wqjV9nGxj5yCz0n8E9sYjK0uQGmQmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0QmG0AAAAAElFTkSuQmCC'
  return nativeImage.createFromDataURL(dataUrl).resize({ width: size, height: size })
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '打开设置',
      click: () => {
        showSettingsWindow()
      },
    },
    {
      label: paused ? '继续提醒' : '暂停提醒',
      click: async () => {
        await setPaused(!paused)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
        // Fallback: if any window handler blocks quit, ensure termination.
        setTimeout(() => {
          try {
            app.exit(0)
          } catch {
            // ignore
          }
        }, 1500)
      },
    },
  ])
}

async function createTray() {
  const image = await getTrayImage()
  tray = new Tray(image)
  tray.setToolTip('EYEiEYE')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => showSettingsWindow())
}

async function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 680,
    height: 720,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'EYEiEYE',
    backgroundColor: '#00000000',
    // Windows 11: enable a softer, less “flat” background.
    // (Ignored on unsupported systems.)
    ...(process.platform === 'win32' ? ({ backgroundMaterial: 'mica' } as unknown as object) : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Keep the native title stable (don't let the page title override it).
  settingsWindow.on('page-title-updated', (e) => e.preventDefault())
  settingsWindow.setTitle('EYEiEYE')

  const icon = await getAppWindowIcon(256)
  if (!icon.isEmpty()) settingsWindow.setIcon(icon)

  settingsWindow.on('close', (e) => {
    if (isQuitting) return
    e.preventDefault()
    settingsWindow?.hide()
  })

  loadRenderer(settingsWindow, { view: 'settings' })
}

function showSettingsWindow() {
  if (!settingsWindow) createSettingsWindow()
  settingsWindow?.show()
  settingsWindow?.focus()
}

async function isExternalFullscreen(): Promise<boolean> {
  try {
    const aw = await activeWin()
    if (!aw || !aw.bounds) return false

    // 排除掉我们自己的窗口，避免干扰判断
    const title = (aw.title || '').toLowerCase()
    const owner = (aw.owner?.name || '').toLowerCase()
    if (title.includes('eyesonyou') || owner.includes('eyesonyou')) {
      return false
    }

    const display = screen.getDisplayMatching(aw.bounds)
    const d = display.bounds
    const b = aw.bounds

    // 判定逻辑：
    // 1. 窗口大小几乎等于显示器大小
    // 2. 或者窗口覆盖了显示器 95% 以上的面积（处理一些边界稍微溢出的全屏游戏）
    const epsilon = 10 
    const isFullscreenSize = 
      Math.abs(b.width - d.width) <= epsilon && 
      Math.abs(b.height - d.height) <= epsilon &&
      Math.abs(b.x - d.x) <= epsilon &&
      Math.abs(b.y - d.y) <= epsilon

    const windowArea = b.width * b.height
    const displayArea = d.width * d.height
    const coversMost = windowArea >= displayArea * 0.95 && 
                      b.x < d.x + d.width && 
                      b.x + b.width > d.x

    return isFullscreenSize || coversMost
  } catch {
    // 如果获取失败（例如权限问题），为了保险起见，不弹窗
    return false
  }
}

async function maybeNotifyBeforeRest() {
  if (paused) return
  if (await isExternalFullscreen()) return

  if (Notification.isSupported()) {
    new Notification({
      title: 'EYEiEYE',
      body: '30 秒后进入休息时间',
      silent: true,
    }).show()
  }
}

function clearAllTimers() {
  for (const t of timers) clearTimeout(t)
  timers = []
}

function getCenteredBounds(width: number, height: number) {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width: dw, height: dh } = display.workArea
  return {
    x: Math.round(x + (dw - width) / 2),
    y: Math.round(y + (dh - height) / 2),
    width,
    height,
  }
}

async function showBlinkWindow(settings: Settings) {
  if (paused) return
  if (await isExternalFullscreen()) return

  const blink = new BrowserWindow({
    ...getCenteredBounds(640, 360),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    hasShadow: false,
    title: 'EYEiEYE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  blink.on('page-title-updated', (e) => e.preventDefault())
  const icon = await getAppWindowIcon(256)
  if (!icon.isEmpty()) blink.setIcon(icon)

  loadRenderer(blink, { view: 'blink', duration: String(settings.smallDurationSeconds) })

  blink.once('ready-to-show', () => {
    blink.showInactive()
  })

  setTimeout(() => {
    if (!blink.isDestroyed()) blink.close()
  }, settings.smallDurationSeconds * 1000)
}

async function showRestWindow(settings: Settings) {
  if (paused) return
  if (await isExternalFullscreen()) return

  const durationSeconds = settings.bigDurationMinutes * 60
  const rest = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: 'EYEiEYE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  rest.on('page-title-updated', (e) => e.preventDefault())
  const icon = await getAppWindowIcon(256)
  if (!icon.isEmpty()) rest.setIcon(icon)

  let allowClose = false
  activeRestWindow = {
    win: rest,
    allowClose: () => {
      allowClose = true
    },
  }

  rest.on('closed', () => {
    if (activeRestWindow?.win === rest) activeRestWindow = null
  })

  rest.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault()
    }
  })

  loadRenderer(rest, { view: 'rest', duration: String(durationSeconds) })

  rest.once('ready-to-show', () => {
    rest.show()
    rest.focus()
  })

  setTimeout(() => {
    allowClose = true
    if (!rest.isDestroyed()) rest.close()
  }, durationSeconds * 1000)
}

async function scheduleLoops() {
  clearAllTimers()
  if (paused) return

  const scheduleSmallNext = async () => {
    const latest = await readSettings()
    const waitMs = latest.smallIntervalMinutes * 60_000
    timers.push(
      setTimeout(async () => {
        const current = await readSettings()
        await showBlinkWindow(current)
        await scheduleSmallNext()
      }, waitMs)
    )
  }

  const scheduleBigNext = async () => {
    const latest = await readSettings()
    const bigMs = latest.bigIntervalMinutes * 60_000
    const notifyMs = bigMs - 30_000

    if (notifyMs > 0) timers.push(setTimeout(maybeNotifyBeforeRest, notifyMs))

    timers.push(
      setTimeout(async () => {
        const current = await readSettings()
        await showRestWindow(current)
        await scheduleBigNext()
      }, bigMs)
    )
  }

  await Promise.all([scheduleSmallNext(), scheduleBigNext()])
}

async function setPaused(next: boolean): Promise<AppStatus> {
  paused = next
  tray?.setContextMenu(buildTrayMenu())
  await scheduleLoops()
  return { paused }
}

function registerIpc() {
  ipcMain.handle('settings:get', async () => readSettings())
  ipcMain.handle('settings:set', async (_e, settings: Settings) => {
    const normalized = normalizeSettings(settings)
    await writeSettings(normalized)
    applyAutoStart(normalized.openAtLogin)
    await scheduleLoops()
    return normalized
  })

  ipcMain.handle('status:get', async () => ({ paused }))
  ipcMain.handle('status:setPaused', async (_e, next: boolean) => setPaused(Boolean(next)))

  ipcMain.handle('rest:exit', async () => {
    const current = activeRestWindow
    if (!current) return { ok: false }
    if (current.win.isDestroyed()) return { ok: false }
    current.allowClose()
    current.win.close()
    return { ok: true }
  })
}

function createWindow() {
  // No visible main window on startup; app lives in the tray.
  // (Intentionally empty.)
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Tray-based app: do not quit when windows close.
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('activate', () => {
  showSettingsWindow()
})

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_ID)
  createWindow()
  registerIpc()
  await createSettingsWindow()
  await createTray()
  applyAutoStart((await readSettings()).openAtLogin)
  await scheduleLoops()
})

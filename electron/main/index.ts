import { existsSync, mkdirSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import { CHANNELS } from '@shared/channels'
import { buildHandlers } from '@core/handlers'
import type { Host } from '@core/host'
import { invokeHandler } from '@core/invoke'
import { openDatabase, type AppContext } from '@core/db/database'
import { autoBackup } from '@core/services/backup'
import { ensureMonthEnd } from '@core/services/monthEnd'
import { getSettings } from '@core/services/settings'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let ctx: AppContext | null = null

if (process.env.CYLINDERFLOW_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu')
}

app.setName('CylinderFlow')
app.setAppUserModelId('com.cylinderflow.desktop')
if (process.env.CYLINDERFLOW_USER_DATA) app.setPath('userData', process.env.CYLINDERFLOW_USER_DATA)

function createHost(): Host {
  const parent = () => mainWindow ?? undefined
  return {
    async pickDirectory(title) {
      const result = await dialog.showOpenDialog(parent()!, { title, properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    async pickOpenFile(title, extensions) {
      const result = await dialog.showOpenDialog(parent()!, {
        title,
        properties: ['openFile'],
        filters: [{ name: 'SQLite database', extensions }],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    async saveBytes(request) {
      const result = await dialog.showSaveDialog(parent()!, {
        title: request.title,
        defaultPath: request.defaultName,
        filters: [{ name: request.extension.toUpperCase(), extensions: [request.extension] }],
      })
      if (result.canceled || !result.filePath) return null
      const { writeFileSync } = await import('node:fs')
      writeFileSync(result.filePath, request.bytes)
      await shell.openPath(result.filePath)
      return result.filePath
    },
    async chooseLogo() {
      const result = await dialog.showOpenDialog(parent()!, {
        title: 'Choose company logo',
        properties: ['openFile'],
        filters: [{ name: 'PNG or JPG', extensions: ['png', 'jpg', 'jpeg'] }],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    notify(title, body) {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
  }
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About CylinderFlow',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'CylinderFlow',
              message: 'CylinderFlow',
              detail: 'Offline cylinder inventory, dispatch, returns, and customer balances.\nVersion 1.0.0',
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function attachSecurity(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
  })
  if (app.isPackaged) {
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'",
          ],
        },
      })
    })
  }
}

function windowIcon() {
  const candidates = [path.join(process.cwd(), 'build/icon.png'), path.join(app.getAppPath(), 'build/icon.png')]
  return candidates.find((item) => existsSync(item))
}

function createWindow() {
  const icon = windowIcon()
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#F8FAFC',
    title: 'CylinderFlow',
    ...(icon ? { icon } : {}),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win
  attachSecurity(win)
  win.once('ready-to-show', () => win.show())
  if (isDev && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

function startDevBridge(handlers: ReturnType<typeof buildHandlers>) {
  if (app.isPackaged) return
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/rpc') {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    let payload: { channel?: string; payload?: unknown } = {}
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    } catch {
      res.writeHead(400)
      res.end(JSON.stringify({ ok: false, error: 'Invalid request.' }))
      return
    }
    const result = await invokeHandler(handlers, payload.channel ?? '', payload.payload)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  })
  server.listen(43921, '127.0.0.1')
}

function publishMonthEnd() {
  if (!ctx || !mainWindow) return
  const created = ensureMonthEnd(ctx)
  const settings = getSettings(ctx)
  if (settings.notifyNative) {
    for (const note of created.notifications) {
      if (Notification.isSupported()) new Notification({ title: note.title, body: note.body }).show()
    }
  }
  if (created.periods.length) mainWindow.webContents.send('app-event', { type: 'month-end', periods: created.periods })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    const userData = app.getPath('userData')
    if (!existsSync(userData)) mkdirSync(userData, { recursive: true })
    ctx = openDatabase(path.join(userData, 'cylinderflow.db'))
    const handlers = buildHandlers(ctx, createHost())
    for (const channel of CHANNELS) {
      ipcMain.handle(channel, (_event, payload) => invokeHandler(handlers, channel, payload))
    }
    startDevBridge(handlers)
    buildMenu()
    createWindow()
    publishMonthEnd()
    void autoBackup(ctx).catch((error) => console.error('Automatic backup failed', error))
    setInterval(publishMonthEnd, 60_000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

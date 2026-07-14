import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { disposeDatabase } from './database/sqlite'
import { disposeProviderAdapters } from './providers/providerService'
import { registerProviderIpc } from './providers/registerProviderIpc'
import { registerAppIpc } from './registerAppIpc'

const getWindowBackgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? '#141516' : '#f5f5f3'

const updateWindowBackgroundColors = (): void => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.setBackgroundColor(getWindowBackgroundColor())
  })
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: getWindowBackgroundColor(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'
  nativeTheme.on('updated', updateWindowBackgroundColors)
  electronApp.setAppUserModelId('com.sele')
  registerAppIpc()
  registerProviderIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  disposeProviderAdapters()
  void disposeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

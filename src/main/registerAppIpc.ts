import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { appIpcChannels } from '../shared/app'

const getDefaultPath = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid folder path')
  return value
}

export const registerAppIpc = (): void => {
  ipcMain.handle(appIpcChannels.getDefaultCwd, () => process.cwd())

  ipcMain.handle(appIpcChannels.selectFolder, async (event, options: unknown) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const folderOptions =
      options && typeof options === 'object' && !Array.isArray(options)
        ? (options as { defaultPath?: unknown })
        : {}

    const dialogOptions = {
      defaultPath: getDefaultPath(folderOptions.defaultPath),
      properties: ['openDirectory']
    } satisfies Electron.OpenDialogOptions

    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })
}

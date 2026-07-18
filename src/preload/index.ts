import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppApi, AppColorScheme, AppWindowState } from '../shared/app'
import { appIpcChannels } from '../shared/app'
import type { ProviderApi, ProviderChatUpdatedEvent } from '../shared/provider'
import { providerIpcChannels } from '../shared/provider'

const appApi: AppApi = {
  getColorScheme: () => ipcRenderer.invoke(appIpcChannels.getColorScheme),
  getWindowState: () => ipcRenderer.invoke(appIpcChannels.getWindowState),
  minimizeWindow: () => ipcRenderer.invoke(appIpcChannels.minimizeWindow),
  toggleWindowMaximized: () => ipcRenderer.invoke(appIpcChannels.toggleWindowMaximized),
  closeWindow: () => ipcRenderer.invoke(appIpcChannels.closeWindow),
  getDefaultCwd: () => ipcRenderer.invoke(appIpcChannels.getDefaultCwd),
  getGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.getGitChanges, options),
  commitGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.commitGitChanges, options),
  pullGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.pullGitChanges, options),
  pushGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.pushGitChanges, options),
  selectFolder: (options) => ipcRenderer.invoke(appIpcChannels.selectFolder, options),
  onColorSchemeUpdated: (listener): (() => void) => {
    const handleColorSchemeUpdated = (_: IpcRendererEvent, scheme: AppColorScheme): void => {
      listener(scheme)
    }

    ipcRenderer.on(appIpcChannels.colorSchemeUpdated, handleColorSchemeUpdated)
    return () =>
      ipcRenderer.removeListener(appIpcChannels.colorSchemeUpdated, handleColorSchemeUpdated)
  },
  onWindowStateUpdated: (listener): (() => void) => {
    const handleWindowStateUpdated = (_: IpcRendererEvent, state: AppWindowState): void => {
      listener(state)
    }

    ipcRenderer.on(appIpcChannels.windowStateUpdated, handleWindowStateUpdated)
    return () =>
      ipcRenderer.removeListener(appIpcChannels.windowStateUpdated, handleWindowStateUpdated)
  }
}

const providerApi: ProviderApi = {
  login: (providerId) => ipcRenderer.invoke(providerIpcChannels.login, providerId),
  getUpdateAvailability: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getUpdateAvailability, providerId),
  updateProvider: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.updateProvider, providerId),
  getApprovalModes: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getApprovalModes, providerId),
  getSandboxModes: (providerId) =>
    ipcRenderer.invoke(providerIpcChannels.getSandboxModes, providerId),
  getModels: (providerId) => ipcRenderer.invoke(providerIpcChannels.getModels, providerId),
  getChats: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getChats, providerId, options),
  getChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.getChat, providerId, chatId),
  startChat: (providerId, message, options) =>
    ipcRenderer.invoke(providerIpcChannels.startChat, providerId, message, options),
  continueChat: (providerId, chatId, message, options) =>
    ipcRenderer.invoke(providerIpcChannels.continueChat, providerId, chatId, message, options),
  sendActiveChatMessage: (providerId, chatId, message, mode, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.sendActiveChatMessage,
      providerId,
      chatId,
      message,
      mode,
      options
    ),
  deletePendingMessage: (providerId, chatId, messageId) =>
    ipcRenderer.invoke(providerIpcChannels.deletePendingMessage, providerId, chatId, messageId),
  interruptPendingMessage: (providerId, chatId, messageId) =>
    ipcRenderer.invoke(providerIpcChannels.interruptPendingMessage, providerId, chatId, messageId),
  editMessage: (providerId, chatId, messageId, message, options) =>
    ipcRenderer.invoke(
      providerIpcChannels.editMessage,
      providerId,
      chatId,
      messageId,
      message,
      options
    ),
  resolveApproval: (providerId, chatId, decision) =>
    ipcRenderer.invoke(providerIpcChannels.resolveApproval, providerId, chatId, decision),
  stopChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.stopChat, providerId, chatId),
  markChatDone: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.markChatDone, providerId, chatId),
  markCwdChatsDone: (providerId, cwd) =>
    ipcRenderer.invoke(providerIpcChannels.markCwdChatsDone, providerId, cwd),
  setChatPinned: (providerId, chatId, pinned) =>
    ipcRenderer.invoke(providerIpcChannels.setChatPinned, providerId, chatId, pinned),
  onChatUpdated: (listener): (() => void) => {
    const handleChatUpdated = (_: IpcRendererEvent, event: ProviderChatUpdatedEvent): void => {
      listener(event)
    }

    ipcRenderer.on(providerIpcChannels.chatUpdated, handleChatUpdated)
    return () => ipcRenderer.removeListener(providerIpcChannels.chatUpdated, handleChatUpdated)
  }
}

contextBridge.exposeInMainWorld('appApi', appApi)
contextBridge.exposeInMainWorld('providerApi', providerApi)

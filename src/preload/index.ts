import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppApi } from '../shared/app'
import { appIpcChannels } from '../shared/app'
import type { ProviderApi, ProviderChatUpdatedEvent } from '../shared/provider'
import { providerIpcChannels } from '../shared/provider'

const appApi: AppApi = {
  getDefaultCwd: () => ipcRenderer.invoke(appIpcChannels.getDefaultCwd),
  getGitChanges: (options) => ipcRenderer.invoke(appIpcChannels.getGitChanges, options),
  selectFolder: (options) => ipcRenderer.invoke(appIpcChannels.selectFolder, options)
}

const providerApi: ProviderApi = {
  login: (providerId) => ipcRenderer.invoke(providerIpcChannels.login, providerId),
  getChats: (providerId, options) =>
    ipcRenderer.invoke(providerIpcChannels.getChats, providerId, options),
  getChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.getChat, providerId, chatId),
  startChat: (providerId, message, options) =>
    ipcRenderer.invoke(providerIpcChannels.startChat, providerId, message, options),
  continueChat: (providerId, chatId, message, options) =>
    ipcRenderer.invoke(providerIpcChannels.continueChat, providerId, chatId, message, options),
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

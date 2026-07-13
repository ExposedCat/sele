import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { ProviderApi, ProviderChatUpdatedEvent } from '../shared/provider'
import { providerIpcChannels } from '../shared/provider'

const providerApi: ProviderApi = {
  login: (providerId) => ipcRenderer.invoke(providerIpcChannels.login, providerId),
  getChats: (providerId) => ipcRenderer.invoke(providerIpcChannels.getChats, providerId),
  getChat: (providerId, chatId) =>
    ipcRenderer.invoke(providerIpcChannels.getChat, providerId, chatId),
  startChat: (providerId, message) =>
    ipcRenderer.invoke(providerIpcChannels.startChat, providerId, message),
  continueChat: (providerId, chatId, message) =>
    ipcRenderer.invoke(providerIpcChannels.continueChat, providerId, chatId, message),
  onChatUpdated: (listener): (() => void) => {
    const handleChatUpdated = (_: IpcRendererEvent, event: ProviderChatUpdatedEvent): void => {
      listener(event)
    }

    ipcRenderer.on(providerIpcChannels.chatUpdated, handleChatUpdated)
    return () => ipcRenderer.removeListener(providerIpcChannels.chatUpdated, handleChatUpdated)
  }
}

contextBridge.exposeInMainWorld('providerApi', providerApi)

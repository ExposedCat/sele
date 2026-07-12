import { contextBridge, ipcRenderer } from 'electron'
import type { ProviderApi } from '../shared/provider'
import { providerIpcChannels } from '../shared/provider'

const providerApi: ProviderApi = {
  login: (providerId) => ipcRenderer.invoke(providerIpcChannels.login, providerId),
  getChats: (providerId) => ipcRenderer.invoke(providerIpcChannels.getChats, providerId)
}

contextBridge.exposeInMainWorld('providerApi', providerApi)

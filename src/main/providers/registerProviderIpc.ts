import { ipcMain } from 'electron'
import type { ProviderId } from '../../shared/provider'
import { isProviderId, providerIpcChannels } from '../../shared/provider'
import { providerApi } from './providerService'

const requireProviderId = (value: unknown): ProviderId => {
  if (!isProviderId(value)) throw new Error(`Unknown provider: ${String(value)}`)
  return value
}

const requireChatId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid chat ID')
  return value
}

export const registerProviderIpc = (): void => {
  ipcMain.handle(providerIpcChannels.login, (_, providerId: unknown) =>
    providerApi.login(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getChats, (_, providerId: unknown) =>
    providerApi.getChats(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getChat, (_, providerId: unknown, chatId: unknown) =>
    providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
  )
}

import type { ProviderApi, ProviderId } from '../../shared/provider'
import { CodexProviderAdapter } from './codex/CodexProviderAdapter'
import type { ProviderAdapter } from './ProviderAdapter'

const adapters: Record<ProviderId, ProviderAdapter> = {
  codex: new CodexProviderAdapter()
}

export const providerApi: ProviderApi = {
  login: (providerId) => adapters[providerId].login(),
  getChats: (providerId) => adapters[providerId].getChats(),
  getChat: (providerId, chatId) => adapters[providerId].getChat(chatId)
}

export const disposeProviderAdapters = (): void => {
  Object.values(adapters).forEach((adapter) => adapter.dispose())
}

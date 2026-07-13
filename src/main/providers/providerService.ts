import type { ProviderApi, ProviderChatUpdatedEvent, ProviderId } from '../../shared/provider'
import { CodexProviderAdapter } from './codex/CodexProviderAdapter'
import type { ProviderAdapter } from './ProviderAdapter'

const adapters: Record<ProviderId, ProviderAdapter> = {
  codex: new CodexProviderAdapter()
}

const chatUpdatedListeners = new Set<(event: ProviderChatUpdatedEvent) => void>()

for (const adapter of Object.values(adapters)) {
  adapter.onChatUpdated((detail) => {
    const event = {
      providerId: adapter.id,
      chatId: detail.id,
      detail
    } satisfies ProviderChatUpdatedEvent

    chatUpdatedListeners.forEach((listener) => listener(event))
  })
}

export const providerApi: ProviderApi = {
  login: (providerId) => adapters[providerId].login(),
  getChats: (providerId, options) => adapters[providerId].getChats(options),
  getChat: (providerId, chatId) => adapters[providerId].getChat(chatId),
  startChat: (providerId, message, options) => adapters[providerId].startChat(message, options),
  continueChat: (providerId, chatId, message, options) =>
    adapters[providerId].continueChat(chatId, message, options),
  stopChat: (providerId, chatId) => adapters[providerId].stopChat(chatId),
  onChatUpdated: (listener) => {
    chatUpdatedListeners.add(listener)
    return () => chatUpdatedListeners.delete(listener)
  }
}

export const disposeProviderAdapters = (): void => {
  Object.values(adapters).forEach((adapter) => adapter.dispose())
}

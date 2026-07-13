import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderId,
  ProviderLoginResult
} from '../../shared/provider'

export type ProviderAdapter = {
  id: ProviderId
  login: () => Promise<ProviderLoginResult>
  getChats: () => Promise<ProviderChat[]>
  getChat: (chatId: string) => Promise<ProviderChatDetail>
  dispose: () => void
}

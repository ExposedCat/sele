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
  startChat: (message: string) => Promise<ProviderChatDetail>
  continueChat: (chatId: string, message: string) => Promise<ProviderChatDetail>
  onChatUpdated: (listener: (detail: ProviderChatDetail) => void) => () => void
  dispose: () => void
}

import type {
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderId,
  ProviderLoginResult,
  ProviderTurnOptions
} from '../../shared/provider'

export type ProviderAdapter = {
  id: ProviderId
  login: () => Promise<ProviderLoginResult>
  getChats: (options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (chatId: string) => Promise<ProviderChatDetail>
  startChat: (message: string, options?: ProviderTurnOptions) => Promise<ProviderChatDetail>
  continueChat: (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  stopChat: (chatId: string) => Promise<ProviderChatDetail>
  onChatUpdated: (listener: (detail: ProviderChatDetail) => void) => () => void
  dispose: () => void
}

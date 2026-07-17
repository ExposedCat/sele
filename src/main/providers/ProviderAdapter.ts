import type {
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderId,
  ProviderLoginResult,
  ProviderApprovalDecision,
  ProviderUpdateAvailability,
  ProviderAccessModeOption,
  ProviderModel,
  ProviderTurnOptions
} from '../../shared/provider'

export type ProviderAdapter = {
  id: ProviderId
  login: () => Promise<ProviderLoginResult>
  getUpdateAvailability: () => Promise<ProviderUpdateAvailability | null>
  updateProvider: () => Promise<ProviderUpdateAvailability | null>
  getAccessModes: () => Promise<ProviderAccessModeOption[]>
  getModels: () => Promise<ProviderModel[]>
  getChats: (options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (chatId: string) => Promise<ProviderChatDetail>
  startChat: (message: string, options?: ProviderTurnOptions) => Promise<ProviderChatDetail>
  continueChat: (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  editMessage: (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  resolveApproval: (
    chatId: string,
    decision: ProviderApprovalDecision
  ) => Promise<ProviderChatDetail>
  stopChat: (chatId: string) => Promise<ProviderChatDetail>
  onChatUpdated: (listener: (detail: ProviderChatDetail) => void) => () => void
  dispose: () => void
}

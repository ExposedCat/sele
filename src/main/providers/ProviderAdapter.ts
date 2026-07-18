import type {
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderId,
  ProviderLoginResult,
  ProviderApprovalDecision,
  ProviderUpdateAvailability,
  ProviderApprovalModeOption,
  ProviderSandboxModeOption,
  ProviderModel,
  ProviderActiveSendMode,
  ProviderTurnOptions
} from '../../shared/provider'

export type ProviderAdapter = {
  id: ProviderId
  login: () => Promise<ProviderLoginResult>
  getUpdateAvailability: () => Promise<ProviderUpdateAvailability | null>
  updateProvider: () => Promise<ProviderUpdateAvailability | null>
  getApprovalModes: () => Promise<ProviderApprovalModeOption[]>
  getSandboxModes: () => Promise<ProviderSandboxModeOption[]>
  getModels: () => Promise<ProviderModel[]>
  getChats: (options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (chatId: string) => Promise<ProviderChatDetail>
  startChat: (message: string, options?: ProviderTurnOptions) => Promise<ProviderChatDetail>
  continueChat: (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  sendActiveChatMessage: (
    chatId: string,
    message: string,
    mode: ProviderActiveSendMode,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  deletePendingMessage: (chatId: string, messageId: string) => Promise<ProviderChatDetail>
  editPendingMessage: (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  interruptPendingMessage: (chatId: string, messageId: string) => Promise<ProviderChatDetail>
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

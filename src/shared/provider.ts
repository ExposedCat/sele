export const providerIds = ['codex'] as const
export const providerModelIds = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex-spark'
] as const
export const providerReasoningEfforts = ['low', 'medium', 'high', 'xhigh'] as const

export type ProviderId = (typeof providerIds)[number]
export type ProviderModelId = (typeof providerModelIds)[number]
export type ProviderReasoningEffort = (typeof providerReasoningEfforts)[number]

export type ProviderAccount = {
  label: string
}

export type ProviderLoginResult =
  | { status: 'authenticated'; account: ProviderAccount }
  | { status: 'pending'; loginId: string; authUrl: string }
  | { status: 'notRequired' }

export type ProviderChatStatus = 'active' | 'error' | 'waitingOnApproval' | 'waitingOnUserInput'

export type ProviderApprovalDecision = 'allow' | 'deny'

export type ProviderPendingApproval = {
  id: string
  type: 'command' | 'fileChange'
  command: string | null
  cwd: string | null
  reason: string | null
  startedAt: number
}

export type ProviderChatMetadata = {
  id: string
  pinned: boolean
  done: boolean
}

export type ProviderChat = {
  id: string
  providerId: ProviderId
  title: string
  preview: string
  cwd: string | null
  createdAt: number
  updatedAt: number
  status: ProviderChatStatus | null
  pinned: boolean
  done: boolean
}

export type ProviderChatListOptions = {
  cursor?: string | null
  limit?: number | null
}

export type ProviderChatPage = {
  chats: ProviderChat[]
  nextCursor: string | null
}

export type ProviderCapabilities = {
  editMessages: boolean
}

export type ProviderMessage = {
  type: 'message'
  id: string
  role: 'user' | 'assistant'
  content: string
}

export type ProviderWorkingMessage = {
  type: 'message'
  id: string
  content: string
}

export type ProviderFileDiff = {
  path: string
  kind: 'edit' | 'create' | 'delete'
  diff: string
}

export type ProviderToolActivity =
  | 'read'
  | 'search'
  | 'git'
  | 'edit'
  | 'create'
  | 'delete'
  | 'npm'
  | 'npx'
  | 'script'
  | 'command'
  | 'other'

export type ProviderWorkingTool = {
  type: 'tool'
  id: string
  toolId: string
  activity: ProviderToolActivity
  label: string
  command: string | null
  stdout: string | null
  diffs: ProviderFileDiff[]
  rawOutput: unknown
  raw: unknown[]
}

export type ProviderWorkingToolGroup = {
  type: 'toolGroup'
  id: string
  label: string
  tools: ProviderWorkingTool[]
}

export type ProviderWorkingItem =
  ProviderWorkingMessage | ProviderWorkingTool | ProviderWorkingToolGroup

export type ProviderWorkingStep = {
  type: 'working'
  id: string
  status: 'working' | 'worked' | 'stopped'
  items: ProviderWorkingItem[]
}

export type ProviderChatItem = ProviderMessage | ProviderWorkingStep

export type ProviderChatDetail = {
  id: string
  title: string
  cwd: string | null
  status: ProviderChatStatus | null
  pinned: boolean
  done: boolean
  capabilities: ProviderCapabilities
  pendingApproval: ProviderPendingApproval | null
  items: ProviderChatItem[]
}

export type ProviderChatUpdatedEvent = {
  providerId: ProviderId
  chatId: string
  detail: ProviderChatDetail
}

export type ProviderAccessMode = 'sandbox' | 'auto' | 'full'

export type ProviderTurnOptions = {
  accessMode: ProviderAccessMode
  cwd?: string
  model: ProviderModelId
  reasoningEffort: ProviderReasoningEffort
}

export type ProviderApi = {
  login: (providerId: ProviderId) => Promise<ProviderLoginResult>
  getChats: (providerId: ProviderId, options?: ProviderChatListOptions) => Promise<ProviderChatPage>
  getChat: (providerId: ProviderId, chatId: string) => Promise<ProviderChatDetail>
  startChat: (
    providerId: ProviderId,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  continueChat: (
    providerId: ProviderId,
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  editMessage: (
    providerId: ProviderId,
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ) => Promise<ProviderChatDetail>
  resolveApproval: (
    providerId: ProviderId,
    chatId: string,
    decision: ProviderApprovalDecision
  ) => Promise<ProviderChatDetail>
  stopChat: (providerId: ProviderId, chatId: string) => Promise<ProviderChatDetail>
  markChatDone: (providerId: ProviderId, chatId: string) => Promise<ProviderChatMetadata>
  markCwdChatsDone: (providerId: ProviderId, cwd: string | null) => Promise<ProviderChatMetadata[]>
  setChatPinned: (
    providerId: ProviderId,
    chatId: string,
    pinned: boolean
  ) => Promise<ProviderChatMetadata>
  onChatUpdated: (listener: (event: ProviderChatUpdatedEvent) => void) => () => void
}

export const providerIpcChannels = {
  login: 'provider:login',
  getChats: 'provider:get-chats',
  getChat: 'provider:get-chat',
  startChat: 'provider:start-chat',
  continueChat: 'provider:continue-chat',
  editMessage: 'provider:edit-message',
  resolveApproval: 'provider:resolve-approval',
  stopChat: 'provider:stop-chat',
  markChatDone: 'provider:mark-chat-done',
  markCwdChatsDone: 'provider:mark-cwd-chats-done',
  setChatPinned: 'provider:set-chat-pinned',
  chatUpdated: 'provider:chat-updated'
} as const

export const isProviderId = (value: unknown): value is ProviderId =>
  providerIds.includes(value as ProviderId)

export const isProviderModelId = (value: unknown): value is ProviderModelId =>
  providerModelIds.includes(value as ProviderModelId)

export const isProviderReasoningEffort = (value: unknown): value is ProviderReasoningEffort =>
  providerReasoningEfforts.includes(value as ProviderReasoningEffort)

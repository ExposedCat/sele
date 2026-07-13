export const providerIds = ['codex'] as const

export type ProviderId = (typeof providerIds)[number]

export type ProviderAccount = {
  label: string
}

export type ProviderLoginResult =
  | { status: 'authenticated'; account: ProviderAccount }
  | { status: 'pending'; loginId: string; authUrl: string }
  | { status: 'notRequired' }

export type ProviderChatStatus = 'active' | 'error' | 'waitingOnApproval' | 'waitingOnUserInput'

export type ProviderChat = {
  id: string
  providerId: ProviderId
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  status: ProviderChatStatus | null
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
  status: ProviderChatStatus | null
  items: ProviderChatItem[]
}

export type ProviderChatUpdatedEvent = {
  providerId: ProviderId
  chatId: string
  detail: ProviderChatDetail
}

export type ProviderApi = {
  login: (providerId: ProviderId) => Promise<ProviderLoginResult>
  getChats: (providerId: ProviderId) => Promise<ProviderChat[]>
  getChat: (providerId: ProviderId, chatId: string) => Promise<ProviderChatDetail>
  startChat: (providerId: ProviderId, message: string) => Promise<ProviderChatDetail>
  continueChat: (
    providerId: ProviderId,
    chatId: string,
    message: string
  ) => Promise<ProviderChatDetail>
  onChatUpdated: (listener: (event: ProviderChatUpdatedEvent) => void) => () => void
}

export const providerIpcChannels = {
  login: 'provider:login',
  getChats: 'provider:get-chats',
  getChat: 'provider:get-chat',
  startChat: 'provider:start-chat',
  continueChat: 'provider:continue-chat',
  chatUpdated: 'provider:chat-updated'
} as const

export const isProviderId = (value: unknown): value is ProviderId =>
  providerIds.includes(value as ProviderId)

export const providerIds = ['codex'] as const

export type ProviderId = (typeof providerIds)[number]

export type ProviderAccount = {
  label: string
}

export type ProviderLoginResult =
  | { status: 'authenticated'; account: ProviderAccount }
  | { status: 'pending'; loginId: string; authUrl: string }
  | { status: 'notRequired' }

export type ProviderChatStatus = 'error' | 'waitingOnApproval' | 'waitingOnUserInput'

export type ProviderChat = {
  id: string
  providerId: ProviderId
  title: string
  preview: string
  createdAt: number
  updatedAt: number
  status: ProviderChatStatus | null
}

export type ProviderApi = {
  login: (providerId: ProviderId) => Promise<ProviderLoginResult>
  getChats: (providerId: ProviderId) => Promise<ProviderChat[]>
}

export const providerIpcChannels = {
  login: 'provider:login',
  getChats: 'provider:get-chats'
} as const

export const isProviderId = (value: unknown): value is ProviderId =>
  providerIds.includes(value as ProviderId)

import type { ProviderChat, ProviderId, ProviderLoginResult } from '../../shared/provider'

export type ProviderAdapter = {
  id: ProviderId
  login: () => Promise<ProviderLoginResult>
  getChats: () => Promise<ProviderChat[]>
  dispose: () => void
}

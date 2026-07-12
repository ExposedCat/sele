import type { ProviderApi } from '../../shared/provider'

type ProviderWindow = Window & {
  providerApi: ProviderApi
}

export const providerApi = (window as unknown as ProviderWindow).providerApi

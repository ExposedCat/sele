import type { AppApi } from '../../shared/app'

type AppWindow = Window & {
  appApi: AppApi
}

export const appApi = (window as unknown as AppWindow).appApi

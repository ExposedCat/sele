import type { AppColorScheme } from '../../shared/app'
import { appApi } from './appApi'

const colorSchemeQuery = '(prefers-color-scheme: dark)'
const logPrefix = '[color-scheme:renderer]'

const getSystemColorScheme = (query: MediaQueryList): AppColorScheme =>
  query.matches ? 'dark' : 'light'

const applySystemColorScheme = (scheme: AppColorScheme): void => {
  const root = document.documentElement

  root.dataset.colorScheme = scheme
  root.style.colorScheme = scheme
}

export const watchSystemColorScheme = (): void => {
  const query = window.matchMedia(colorSchemeQuery)
  const updateColorScheme = (): void => {
    applySystemColorScheme(getSystemColorScheme(query))
  }

  updateColorScheme()
  query.addEventListener('change', updateColorScheme)

  void appApi
    .getColorScheme()
    .then(applySystemColorScheme)
    .catch((error: unknown) => {
      console.error(logPrefix, 'failed to read main process color scheme', error)
    })

  appApi.onColorSchemeUpdated(applySystemColorScheme)
}

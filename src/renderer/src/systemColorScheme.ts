import type { AppColorScheme } from '../../shared/app'
import { appApi } from './appApi'

const colorSchemeQuery = '(prefers-color-scheme: dark)'
const logPrefix = '[color-scheme:renderer]'

const getSystemColorScheme = (query: MediaQueryList): AppColorScheme =>
  query.matches ? 'dark' : 'light'

const applySystemColorScheme = (scheme: AppColorScheme, source: string): void => {
  const root = document.documentElement
  const previousScheme = root.dataset.colorScheme

  root.dataset.colorScheme = scheme
  root.style.colorScheme = scheme

  console.info(logPrefix, previousScheme === scheme ? 'checked' : 'applied', {
    source,
    scheme,
    previousScheme
  })
}

export const watchSystemColorScheme = (): void => {
  const query = window.matchMedia(colorSchemeQuery)
  const updateColorScheme = (source: string): void => {
    const scheme = getSystemColorScheme(query)

    console.info(logPrefix, 'media query', {
      source,
      media: query.media,
      matches: query.matches,
      scheme
    })

    applySystemColorScheme(scheme, source)
  }

  updateColorScheme('media-query:startup')
  query.addEventListener('change', () => updateColorScheme('media-query:change'))

  void appApi
    .getColorScheme()
    .then((scheme) => applySystemColorScheme(scheme, 'main-process:startup'))
    .catch((error: unknown) => {
      console.error(logPrefix, 'failed to read main process color scheme', error)
    })

  appApi.onColorSchemeUpdated((scheme) => {
    applySystemColorScheme(scheme, 'main-process:update')
  })
}

type SystemColorScheme = 'dark' | 'light'

const colorSchemeQuery = '(prefers-color-scheme: dark)'

const getSystemColorScheme = (query: MediaQueryList): SystemColorScheme =>
  query.matches ? 'dark' : 'light'

const applySystemColorScheme = (scheme: SystemColorScheme): void => {
  const root = document.documentElement

  root.dataset.colorScheme = scheme
  root.style.colorScheme = scheme
}

export const watchSystemColorScheme = (): void => {
  const query = window.matchMedia(colorSchemeQuery)
  const updateColorScheme = (): void => applySystemColorScheme(getSystemColorScheme(query))

  updateColorScheme()
  query.addEventListener('change', updateColorScheme)
}

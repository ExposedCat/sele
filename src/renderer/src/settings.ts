import type { ProviderModelId } from '../../shared/provider'

export type AppThemePreference = 'system' | 'light' | 'dark'

export type AppSettings = {
  appearance: {
    theme: AppThemePreference
  }
  chat: {
    updateExistingChats: boolean
    updateNewChats: boolean
  }
  git: {
    commitModel: ProviderModelId | null
  }
}

export const appSettingsStorageKey = 'sele:app-settings:v1'

export const defaultAppSettings: AppSettings = {
  appearance: {
    theme: 'system'
  },
  chat: {
    updateExistingChats: true,
    updateNewChats: true
  },
  git: {
    commitModel: null
  }
}

export const isAppThemePreference = (value: unknown): value is AppThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

const isStoredModel = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

export const readStoredAppSettings = (): AppSettings => {
  try {
    const storedValue = window.localStorage.getItem(appSettingsStorageKey)
    if (!storedValue) return defaultAppSettings

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown> | null
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return defaultAppSettings
    }

    const appearance =
      parsedValue.appearance &&
      typeof parsedValue.appearance === 'object' &&
      !Array.isArray(parsedValue.appearance)
        ? (parsedValue.appearance as Record<string, unknown>)
        : {}
    const chat =
      parsedValue.chat && typeof parsedValue.chat === 'object' && !Array.isArray(parsedValue.chat)
        ? (parsedValue.chat as Record<string, unknown>)
        : {}
    const git =
      parsedValue.git && typeof parsedValue.git === 'object' && !Array.isArray(parsedValue.git)
        ? (parsedValue.git as Record<string, unknown>)
        : {}

    return {
      appearance: {
        theme: isAppThemePreference(appearance.theme)
          ? appearance.theme
          : defaultAppSettings.appearance.theme
      },
      chat: {
        updateExistingChats:
          typeof chat.updateExistingChats === 'boolean'
            ? chat.updateExistingChats
            : defaultAppSettings.chat.updateExistingChats,
        updateNewChats:
          typeof chat.updateNewChats === 'boolean'
            ? chat.updateNewChats
            : defaultAppSettings.chat.updateNewChats
      },
      git: {
        commitModel:
          git.commitModel == null
            ? defaultAppSettings.git.commitModel
            : isStoredModel(git.commitModel)
              ? git.commitModel
              : defaultAppSettings.git.commitModel
      }
    }
  } catch {
    return defaultAppSettings
  }
}

export const writeStoredAppSettings = (settings: AppSettings): void => {
  try {
    window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(settings))
  } catch {
    // App settings are non-critical; ignore unavailable storage.
  }
}

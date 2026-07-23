import type { ProviderModelId } from '../../shared/provider'

export type AppThemePreference = 'system' | 'light' | 'dark'

export type AppGitCommitPromptSettings = {
  instructions: string
  workflow: string
  commitStep: string
  amendStep: string
  extraInstructionsPrefix: string
}

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
    commitPrompt: AppGitCommitPromptSettings
  }
}

export const appSettingsStorageKey = 'sele:app-settings:v1'

export const defaultAppGitCommitPromptSettings: AppGitCommitPromptSettings = {
  instructions:
    'You need to create a scoped Git commit for all work done in this chat before this commit request. There are highly likely some changes of parallel work in same files which were touched in this session, so you need to check actual diffs and create a scoped hunk patch to commit instead of committing entire file, to ensure that only work done in this chat gets committed. Do not include any unrelated changes and include all changes from this session. Do not ask for review or confirmation. If you cannot scope the changes, do not commit and explain why.',
  workflow: [
    'Workflow:',
    '1. `git status --short`',
    '2. `git diff --name-only`',
    '3.1. For files changes in which are to be fully committed, add them with `git add`',
    '3.2.1. For only partial candidate files: `git diff -U0 -- file`',
    '3.2.2. Write a small patch containing only the wanted hunks.',
    '3.2.3. `git apply --cached --unidiff-zero < patch`',
    '6. `git diff --cached --name-status`',
    '7. `git diff --cached | rg ...` only for known unrelated markers if files are mixed',
    '8. `git diff --cached --check`'
  ].join('\n'),
  commitStep: '9. `git commit -m "..."`',
  amendStep: '9. `git commit --amend` (amend last commit instead of creating a new one)',
  extraInstructionsPrefix: 'Extra user instructions:'
}

const legacyDefaultGitCommitWorkflowSettings = new Set([
  [
    'Workflow:',
    '1. `git status --short`',
    '2. `git diff --name-only`',
    '3. For only candidate files: `git diff -U0 -- file`',
    '4. Write a small patch containing only the wanted hunks.',
    '5. `git apply --cached --unidiff-zero < patch`',
    '6. `git diff --cached --name-status`',
    '7. `git diff --cached | rg ...` only for known unrelated markers if files are mixed',
    '8. `git diff --cached --check`'
  ].join('\n')
])

export const defaultAppSettings: AppSettings = {
  appearance: {
    theme: 'system'
  },
  chat: {
    updateExistingChats: true,
    updateNewChats: true
  },
  git: {
    commitModel: null,
    commitPrompt: defaultAppGitCommitPromptSettings
  }
}

export const isAppThemePreference = (value: unknown): value is AppThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

const isStoredModel = (value: unknown): value is ProviderModelId =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128

const readPromptField = (
  storedPrompt: Record<string, unknown>,
  key: keyof AppGitCommitPromptSettings
): string => {
  const storedValue = storedPrompt[key]
  if (typeof storedValue !== 'string') return defaultAppGitCommitPromptSettings[key]

  if (key === 'workflow' && legacyDefaultGitCommitWorkflowSettings.has(storedValue)) {
    return defaultAppGitCommitPromptSettings.workflow
  }

  return storedValue
}

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
    const commitPrompt =
      git.commitPrompt && typeof git.commitPrompt === 'object' && !Array.isArray(git.commitPrompt)
        ? (git.commitPrompt as Record<string, unknown>)
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
              : defaultAppSettings.git.commitModel,
        commitPrompt: {
          instructions: readPromptField(commitPrompt, 'instructions'),
          workflow: readPromptField(commitPrompt, 'workflow'),
          commitStep: readPromptField(commitPrompt, 'commitStep'),
          amendStep: readPromptField(commitPrompt, 'amendStep'),
          extraInstructionsPrefix: readPromptField(commitPrompt, 'extraInstructionsPrefix')
        }
      }
    }
  } catch {
    return defaultAppSettings
  }
}

export const writeStoredAppSettings = (settings: AppSettings): void => {
  try {
    const storedSettings: {
      appearance?: Partial<AppSettings['appearance']>
      chat?: Partial<AppSettings['chat']>
      git?: {
        commitModel?: ProviderModelId | null
        commitPrompt?: Partial<AppGitCommitPromptSettings>
      }
    } = {}

    if (settings.appearance.theme !== defaultAppSettings.appearance.theme) {
      storedSettings.appearance = {
        theme: settings.appearance.theme
      }
    }

    const storedChat: Partial<AppSettings['chat']> = {}
    if (settings.chat.updateExistingChats !== defaultAppSettings.chat.updateExistingChats) {
      storedChat.updateExistingChats = settings.chat.updateExistingChats
    }
    if (settings.chat.updateNewChats !== defaultAppSettings.chat.updateNewChats) {
      storedChat.updateNewChats = settings.chat.updateNewChats
    }
    if (Object.keys(storedChat).length > 0) storedSettings.chat = storedChat

    const storedGit: {
      commitModel?: ProviderModelId | null
      commitPrompt?: Partial<AppGitCommitPromptSettings>
    } = {}
    if (settings.git.commitModel !== defaultAppSettings.git.commitModel) {
      storedGit.commitModel = settings.git.commitModel
    }

    const storedCommitPrompt: Partial<AppGitCommitPromptSettings> = {}
    for (const key of Object.keys(
      defaultAppGitCommitPromptSettings
    ) as (keyof AppGitCommitPromptSettings)[]) {
      if (settings.git.commitPrompt[key] !== defaultAppGitCommitPromptSettings[key]) {
        storedCommitPrompt[key] = settings.git.commitPrompt[key]
      }
    }
    if (Object.keys(storedCommitPrompt).length > 0) {
      storedGit.commitPrompt = storedCommitPrompt
    }
    if (Object.keys(storedGit).length > 0) storedSettings.git = storedGit

    if (Object.keys(storedSettings).length === 0) {
      window.localStorage.removeItem(appSettingsStorageKey)
      return
    }

    window.localStorage.setItem(appSettingsStorageKey, JSON.stringify(storedSettings))
  } catch {
    // App settings are non-critical; ignore unavailable storage.
  }
}

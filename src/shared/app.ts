export type FolderSelectionOptions = {
  defaultPath?: string | null
}

export type AppColorScheme = 'dark' | 'light'

export type AppWindowState = {
  isMaximized: boolean
}

export type AppGitChangeSource = 'branch' | 'uncommitted'

export type AppGitChangeKind = 'edit' | 'create' | 'delete' | 'rename' | 'untracked'

export type AppGitCommitAction = 'commit' | 'amend'

export type AppGitFileChange = {
  path: string
  previousPath?: string | null
  kind: AppGitChangeKind
  status: string
}

export type AppGitChangesOptions = {
  cwd?: string | null
  source: AppGitChangeSource
}

export type AppGitChangesResult = {
  repositoryRoot: string
  branchName: string | null
  baseRef: string | null
  unpushedCount: number
  files: AppGitFileChange[]
}

export type AppGitCommitOptions = {
  cwd?: string | null
  action?: AppGitCommitAction
  files: string[]
  message?: string | null
}

export type AppGitCommitResult = {
  commitHash: string
  pushed: boolean
}

export type AppGitPushOptions = {
  cwd?: string | null
}

export type AppGitPushResult = {
  pushed: boolean
}

export type AppApi = {
  getColorScheme: () => Promise<AppColorScheme>
  getWindowState: () => Promise<AppWindowState>
  minimizeWindow: () => Promise<void>
  toggleWindowMaximized: () => Promise<AppWindowState>
  closeWindow: () => Promise<void>
  getDefaultCwd: () => Promise<string>
  getGitChanges: (options: AppGitChangesOptions) => Promise<AppGitChangesResult>
  commitGitChanges: (options: AppGitCommitOptions) => Promise<AppGitCommitResult>
  pushGitChanges: (options?: AppGitPushOptions) => Promise<AppGitPushResult>
  selectFolder: (options?: FolderSelectionOptions) => Promise<string | null>
  onColorSchemeUpdated: (listener: (scheme: AppColorScheme) => void) => () => void
  onWindowStateUpdated: (listener: (state: AppWindowState) => void) => () => void
}

export const appIpcChannels = {
  getColorScheme: 'app:get-color-scheme',
  colorSchemeUpdated: 'app:color-scheme-updated',
  getWindowState: 'app:get-window-state',
  windowStateUpdated: 'app:window-state-updated',
  minimizeWindow: 'app:minimize-window',
  toggleWindowMaximized: 'app:toggle-window-maximized',
  closeWindow: 'app:close-window',
  getDefaultCwd: 'app:get-default-cwd',
  getGitChanges: 'app:get-git-changes',
  commitGitChanges: 'app:commit-git-changes',
  pushGitChanges: 'app:push-git-changes',
  selectFolder: 'app:select-folder'
} as const

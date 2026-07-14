export type FolderSelectionOptions = {
  defaultPath?: string | null
}

export type AppGitChangeSource = 'branch' | 'uncommitted'

export type AppGitChangeKind = 'edit' | 'create' | 'delete' | 'rename'

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
  files: AppGitFileChange[]
}

export type AppApi = {
  getDefaultCwd: () => Promise<string>
  getGitChanges: (options: AppGitChangesOptions) => Promise<AppGitChangesResult>
  selectFolder: (options?: FolderSelectionOptions) => Promise<string | null>
}

export const appIpcChannels = {
  getDefaultCwd: 'app:get-default-cwd',
  getGitChanges: 'app:get-git-changes',
  selectFolder: 'app:select-folder'
} as const

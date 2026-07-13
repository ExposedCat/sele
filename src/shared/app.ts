export type FolderSelectionOptions = {
  defaultPath?: string | null
}

export type AppApi = {
  getDefaultCwd: () => Promise<string>
  selectFolder: (options?: FolderSelectionOptions) => Promise<string | null>
}

export const appIpcChannels = {
  getDefaultCwd: 'app:get-default-cwd',
  selectFolder: 'app:select-folder'
} as const

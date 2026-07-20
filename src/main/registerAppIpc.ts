import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron'
import type {
  AppColorScheme,
  AppGitCommitAction,
  AppGitCommitOptions,
  AppGitChangeKind,
  AppGitChangesOptions,
  AppGitFileChange,
  AppGitChangeSource,
  AppGitPullStrategy,
  AppGitRecoverableFailure,
  AppWindowState
} from '../shared/app'
import { appIpcChannels } from '../shared/app'

export const getAppWindowState = (window: BrowserWindow): AppWindowState => ({
  isMaximized: window.isMaximized()
})

export const sendAppWindowState = (window: BrowserWindow): void => {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(appIpcChannels.windowStateUpdated, getAppWindowState(window))
}

const getBrowserWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) throw new Error('Window not found')
  return window
}

const getDefaultPath = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid folder path')
  return value
}

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

type BranchBase = {
  ref: string
  commit: string
}

const runGit = (cwd: string, args: string[], required = false): Promise<string | null> =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no' },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10_000
      },
      (error, stdout, stderr) => {
        if (error) {
          if (required) {
            const message = stderr.trim() || error.message
            reject(new Error(message))
          } else resolve(null)
          return
        }

        resolve(stdout.trimEnd())
      }
    )
  })

const getGitErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isGitPullStrategy = (value: unknown): value is AppGitPullStrategy =>
  value === 'ff-only' || value === 'rebase' || value === 'merge'

const isDivergedPullFailure = (message: string): boolean => {
  const normalizedMessage = message.toLocaleLowerCase()
  return (
    normalizedMessage.includes('not possible to fast-forward') ||
    normalizedMessage.includes("diverging branches can't be fast-forwarded") ||
    normalizedMessage.includes('need to specify how to reconcile divergent branches')
  )
}

const isPushRejectedFailure = (message: string): boolean => {
  const normalizedMessage = message.toLocaleLowerCase()
  return (
    normalizedMessage.includes('non-fast-forward') ||
    normalizedMessage.includes('fetch first') ||
    normalizedMessage.includes('updates were rejected') ||
    normalizedMessage.includes('failed to push some refs')
  )
}

const getDivergedPullFailure = (command: string): AppGitRecoverableFailure => ({
  kind: 'pull-diverged',
  title: 'Pull needs a strategy',
  message:
    'Local and remote commits have diverged. Choose whether to rebase your commits or create a merge commit.',
  command,
  actions: [
    {
      id: 'pull-rebase',
      label: 'Rebase',
      description: 'Replay local commits on top of the remote branch.'
    },
    {
      id: 'pull-merge',
      label: 'Merge',
      description: 'Create a merge commit that combines local and remote commits.'
    }
  ]
})

const getPushRejectedFailure = (command: string): AppGitRecoverableFailure => ({
  kind: 'push-rejected',
  title: 'Remote changed before push',
  message: 'The remote branch has commits that are not local yet. Pull them before pushing.',
  command,
  actions: [
    {
      id: 'pull-and-push',
      label: 'Pull & Push',
      description: 'Pull remote changes with fast-forward-only, then push local commits.'
    }
  ]
})

const getGitChangesOptions = (value: unknown): AppGitChangesOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git changes options')
  }

  const options = value as { cwd?: unknown; source?: unknown }
  const source = options.source

  if (source !== 'branch' && source !== 'uncommitted') {
    throw new Error('Invalid Git changes source')
  }

  return {
    cwd: getDefaultPath(options.cwd),
    source
  }
}

const getGitCommitOptions = (value: unknown): AppGitCommitOptions => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Git commit options')
  }

  const options = value as { action?: unknown; cwd?: unknown; files?: unknown; message?: unknown }
  const action = options.action === 'amend' ? options.action : 'commit'
  const message = typeof options.message === 'string' ? options.message.trim() : ''

  if (action !== 'amend' && !message) throw new Error('Commit message is required')
  if (!Array.isArray(options.files)) throw new Error('Commit files are required')

  const files = [
    ...new Set(
      options.files.filter((file): file is string => typeof file === 'string').map((file) => file)
    )
  ]

  return {
    action,
    cwd: getDefaultPath(options.cwd),
    files,
    message
  }
}

const getGitSyncOptions = (
  value: unknown
): { cwd?: string | null; rememberStrategy: boolean; strategy?: AppGitPullStrategy } => {
  if (value == null) return { rememberStrategy: false }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Git sync options')

  const options = value as { cwd?: unknown; rememberStrategy?: unknown; strategy?: unknown }
  const rememberStrategy = options.rememberStrategy
  const strategy = options.strategy

  if (rememberStrategy != null && typeof rememberStrategy !== 'boolean') {
    throw new Error('Invalid Git remember strategy option')
  }

  if (strategy != null && !isGitPullStrategy(strategy)) {
    throw new Error('Invalid Git pull strategy')
  }

  return {
    cwd: getDefaultPath(options.cwd),
    rememberStrategy: Boolean(rememberStrategy),
    strategy: isGitPullStrategy(strategy) ? strategy : undefined
  }
}

const getCurrentBranchName = async (cwd: string): Promise<string | null> => {
  const branchName = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return branchName && branchName !== 'HEAD' ? branchName : null
}

const getOriginHeadBranch = async (cwd: string): Promise<string | null> => {
  const originHead = await runGit(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  const prefix = 'refs/remotes/'

  return originHead?.startsWith(prefix) ? originHead.slice(prefix.length) : null
}

const getVerifiedBranchBase = async (
  cwd: string,
  candidateRef: string
): Promise<BranchBase | null> => {
  const verifiedRef = await runGit(cwd, ['rev-parse', '--verify', '--quiet', candidateRef])
  if (!verifiedRef) return null

  const commit = await runGit(cwd, ['merge-base', 'HEAD', candidateRef])
  return commit ? { ref: candidateRef, commit } : null
}

const getBranchBase = async (
  cwd: string,
  branchName: string | null
): Promise<BranchBase | null> => {
  const originHeadBranch = await getOriginHeadBranch(cwd)
  const candidateRefs = [
    originHeadBranch,
    'origin/main',
    'origin/master',
    'upstream/main',
    'upstream/master',
    'main',
    'master'
  ]
  const uniqueRefs = [...new Set(candidateRefs.filter((ref): ref is string => Boolean(ref)))]

  for (const candidateRef of uniqueRefs) {
    if (candidateRef === branchName) continue

    const branchBase = await getVerifiedBranchBase(cwd, candidateRef)
    if (branchBase) return branchBase
  }

  const upstreamRef = await runGit(cwd, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}'
  ])

  if (upstreamRef && upstreamRef !== branchName) {
    const upstreamBase = await getVerifiedBranchBase(cwd, upstreamRef)
    if (upstreamBase) return upstreamBase
  }

  return null
}

const getUpstreamCommitCounts = async (
  cwd: string
): Promise<{ unpulledCount: number; unpushedCount: number }> => {
  const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  const [unpushedRaw, unpulledRaw] = counts?.trim().split(/\s+/, 2) ?? []
  const unpulledCount = Number(unpulledRaw)
  const unpushedCount = Number(unpushedRaw)

  return {
    unpulledCount: Number.isFinite(unpulledCount) ? unpulledCount : 0,
    unpushedCount: Number.isFinite(unpushedCount) ? unpushedCount : 0
  }
}

const getChangeKind = (status: string): AppGitChangeKind => {
  const code = status[0]
  if (code === '?') return 'untracked'
  if (code === 'A' || code === 'C' || code === '?') return 'create'
  if (code === 'D') return 'delete'
  if (code === 'R') return 'rename'
  return 'edit'
}

const getPorcelainChangeKind = (status: string): AppGitChangeKind => {
  if (status.includes('?')) return 'untracked'
  if (status.includes('R')) return 'rename'
  if (status.includes('A') || status.includes('C') || status.includes('?')) return 'create'
  if (status.includes('D')) return 'delete'
  return 'edit'
}

const parseNameStatusChanges = (output: string): AppGitFileChange[] => {
  if (!output) return []

  const fields = output.split('\0')
  const changes: AppGitFileChange[] = []
  let index = 0

  while (index < fields.length && fields[index]) {
    const status = fields[index]
    index += 1

    if (status[0] === 'R' || status[0] === 'C') {
      const previousPath = fields[index]
      const path = fields[index + 1]
      index += 2

      if (path) {
        changes.push({
          path,
          previousPath: previousPath || null,
          kind: getChangeKind(status),
          status
        })
      }

      continue
    }

    const path = fields[index]
    index += 1

    if (path) {
      changes.push({
        path,
        kind: getChangeKind(status),
        status
      })
    }
  }

  return changes
}

const parsePorcelainChanges = (output: string): AppGitFileChange[] => {
  if (!output) return []

  const fields = output.split('\0')
  const changes: AppGitFileChange[] = []
  let index = 0

  while (index < fields.length && fields[index]) {
    const entry = fields[index]
    index += 1

    if (entry.length < 4) continue

    const status = entry.slice(0, 2)
    const path = entry.slice(3)

    if (status.includes('R') || status.includes('C')) {
      const previousPath = fields[index]
      index += 1

      changes.push({
        path,
        previousPath: previousPath || null,
        kind: getPorcelainChangeKind(status),
        status
      })

      continue
    }

    changes.push({
      path,
      kind: getPorcelainChangeKind(status),
      status
    })
  }

  return changes
}

const getGitChanges = async (
  cwd: string,
  source: AppGitChangeSource
): Promise<{
  repositoryRoot: string
  branchName: string | null
  baseRef: string | null
  unpulledCount: number
  unpushedCount: number
  files: AppGitFileChange[]
}> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const branchName = await getCurrentBranchName(repositoryRoot)
  const { unpulledCount, unpushedCount } = await getUpstreamCommitCounts(repositoryRoot)

  if (source === 'uncommitted') {
    const status = await runGit(repositoryRoot, ['status', '--porcelain=v1', '-z'], true)

    return {
      repositoryRoot,
      branchName,
      baseRef: null,
      unpulledCount,
      unpushedCount,
      files: parsePorcelainChanges(status ?? '')
    }
  }

  const branchBase = await getBranchBase(repositoryRoot, branchName)
  if (!branchBase) {
    return {
      repositoryRoot,
      branchName,
      baseRef: null,
      unpulledCount,
      unpushedCount,
      files: []
    }
  }

  const diff = await runGit(
    repositoryRoot,
    ['diff', '--name-status', '-z', '--find-renames', `${branchBase.commit}...HEAD`, '--'],
    true
  )

  return {
    repositoryRoot,
    branchName,
    baseRef: branchBase.ref,
    unpulledCount,
    unpushedCount,
    files: parseNameStatusChanges(diff ?? '')
  }
}

const commitGitChanges = async (
  cwd: string,
  files: string[],
  message: string | null | undefined,
  action: AppGitCommitAction
): Promise<{ commitHash: string; pushed: boolean }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  await runGit(repositoryRoot, ['add', '-A', '--', ...files], true)

  if (action === 'amend') {
    await runGit(repositoryRoot, ['commit', '--amend', '--no-edit', '--only', '--', ...files], true)
  } else {
    const commitMessage = message?.trim()
    if (!commitMessage) throw new Error('Commit message is required')

    await runGit(repositoryRoot, ['commit', '--only', '-m', commitMessage, '--', ...files], true)
  }

  const commitHash = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)
  if (!commitHash) throw new Error('Unable to read commit hash')

  return { commitHash, pushed: false }
}

const pushGitChanges = async (
  cwd: string
): Promise<{ pushed: boolean; failure?: AppGitRecoverableFailure | null }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  try {
    await runGit(repositoryRoot, ['push'], true)
  } catch (error) {
    const message = getGitErrorMessage(error)
    if (isPushRejectedFailure(message)) {
      return { pushed: false, failure: getPushRejectedFailure('git push') }
    }

    throw new Error(message)
  }

  return { pushed: true, failure: null }
}

const hasLocalGitPullConfig = async (repositoryRoot: string): Promise<boolean> => {
  const pullRebase = await runGit(repositoryRoot, ['config', '--local', '--get', 'pull.rebase'])
  const pullFf = await runGit(repositoryRoot, ['config', '--local', '--get', 'pull.ff'])

  return Boolean(pullRebase || pullFf)
}

const rememberGitPullStrategy = async (
  repositoryRoot: string,
  strategy: AppGitPullStrategy
): Promise<void> => {
  if (strategy === 'rebase') {
    await runGit(repositoryRoot, ['config', 'pull.rebase', 'true'], true)
    await runGit(repositoryRoot, ['config', '--unset-all', 'pull.ff'])
  }

  if (strategy === 'merge') {
    await runGit(repositoryRoot, ['config', 'pull.rebase', 'false'], true)
    await runGit(repositoryRoot, ['config', '--unset-all', 'pull.ff'])
  }
}

const getGitPullArgs = async (
  repositoryRoot: string,
  strategy?: AppGitPullStrategy
): Promise<string[]> => {
  if (strategy === 'rebase') return ['pull', '--rebase']
  if (strategy === 'merge') return ['pull', '--no-rebase', '--no-ff', '--no-edit']
  if (!strategy && (await hasLocalGitPullConfig(repositoryRoot))) return ['pull']

  return ['pull', '--ff-only']
}

const pullGitChanges = async (
  cwd: string,
  strategy?: AppGitPullStrategy,
  rememberStrategy = false
): Promise<{ pulled: boolean; failure?: AppGitRecoverableFailure | null }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  if (rememberStrategy && strategy) {
    await rememberGitPullStrategy(repositoryRoot, strategy)
  }

  const args = await getGitPullArgs(repositoryRoot, strategy)

  try {
    await runGit(repositoryRoot, args, true)
  } catch (error) {
    const message = getGitErrorMessage(error)
    if ((strategy == null || strategy === 'ff-only') && isDivergedPullFailure(message)) {
      return {
        pulled: false,
        failure: getDivergedPullFailure(`git ${args.join(' ')}`)
      }
    }

    throw new Error(message)
  }

  return { pulled: true, failure: null }
}

export const registerAppIpc = (): void => {
  ipcMain.handle(appIpcChannels.getColorScheme, getColorScheme)

  ipcMain.handle(appIpcChannels.getDefaultCwd, () => process.cwd())

  ipcMain.handle(appIpcChannels.getWindowState, (event) =>
    getAppWindowState(getBrowserWindow(event))
  )

  ipcMain.handle(appIpcChannels.minimizeWindow, (event) => {
    getBrowserWindow(event).minimize()
  })

  ipcMain.handle(appIpcChannels.toggleWindowMaximized, (event) => {
    const window = getBrowserWindow(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()

    const state = getAppWindowState(window)
    sendAppWindowState(window)
    return state
  })

  ipcMain.handle(appIpcChannels.closeWindow, (event) => {
    getBrowserWindow(event).close()
  })

  ipcMain.handle(appIpcChannels.getGitChanges, async (_event, value: unknown) => {
    const options = getGitChangesOptions(value)
    return getGitChanges(options.cwd ?? process.cwd(), options.source)
  })

  ipcMain.handle(appIpcChannels.commitGitChanges, async (_event, value: unknown) => {
    const options = getGitCommitOptions(value)
    return commitGitChanges(
      options.cwd ?? process.cwd(),
      options.files,
      options.message,
      options.action ?? 'commit'
    )
  })

  ipcMain.handle(appIpcChannels.pullGitChanges, async (_event, value: unknown) => {
    const options = getGitSyncOptions(value)
    return pullGitChanges(options.cwd ?? process.cwd(), options.strategy, options.rememberStrategy)
  })

  ipcMain.handle(appIpcChannels.pushGitChanges, async (_event, value: unknown) => {
    const options = getGitSyncOptions(value)
    return pushGitChanges(options.cwd ?? process.cwd())
  })

  ipcMain.handle(appIpcChannels.selectFolder, async (event, options: unknown) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const folderOptions =
      options && typeof options === 'object' && !Array.isArray(options)
        ? (options as { defaultPath?: unknown })
        : {}

    const dialogOptions = {
      defaultPath: getDefaultPath(folderOptions.defaultPath),
      properties: ['openDirectory']
    } satisfies Electron.OpenDialogOptions

    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled) return null
    return result.filePaths[0] ?? null
  })
}

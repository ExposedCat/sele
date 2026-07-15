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
  AppGitChangeSource
} from '../shared/app'
import { appIpcChannels } from '../shared/app'

const getDefaultPath = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Invalid folder path')
  return value
}

const getColorScheme = (): AppColorScheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

const logColorSchemeIpcRead = (scheme: AppColorScheme): void => {
  console.info('[color-scheme]', 'nativeTheme ipc read', {
    scheme,
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource
  })
}

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
  const action =
    options.action === 'amend' || options.action === 'commitAndPush' ? options.action : 'commit'
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

const getGitPushOptions = (value: unknown): { cwd?: string | null } => {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Git push options')

  const options = value as { cwd?: unknown }
  return {
    cwd: getDefaultPath(options.cwd)
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

const getUnpushedCount = async (cwd: string): Promise<number> => {
  const count = await runGit(cwd, ['rev-list', '--count', '@{upstream}..HEAD'])
  const parsedCount = Number(count)

  return Number.isFinite(parsedCount) ? parsedCount : 0
}

const getChangeKind = (status: string): AppGitChangeKind => {
  const code = status[0]
  if (code === 'A' || code === 'C' || code === '?') return 'create'
  if (code === 'D') return 'delete'
  if (code === 'R') return 'rename'
  return 'edit'
}

const getPorcelainChangeKind = (status: string): AppGitChangeKind => {
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
  unpushedCount: number
  files: AppGitFileChange[]
}> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  const branchName = await getCurrentBranchName(repositoryRoot)
  const unpushedCount = await getUnpushedCount(repositoryRoot)

  if (source === 'uncommitted') {
    const status = await runGit(repositoryRoot, ['status', '--porcelain=v1', '-z'], true)

    return {
      repositoryRoot,
      branchName,
      baseRef: null,
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

  if (action === 'commitAndPush') {
    await runGit(repositoryRoot, ['push'], true)
  }

  const commitHash = await runGit(repositoryRoot, ['rev-parse', 'HEAD'], true)
  if (!commitHash) throw new Error('Unable to read commit hash')

  return { commitHash, pushed: action === 'commitAndPush' }
}

const pushGitChanges = async (cwd: string): Promise<{ pushed: boolean }> => {
  const repositoryRoot = await runGit(cwd, ['rev-parse', '--show-toplevel'], true)
  if (!repositoryRoot) throw new Error('Folder is not inside a Git repository')

  await runGit(repositoryRoot, ['push'], true)

  return { pushed: true }
}

export const registerAppIpc = (): void => {
  ipcMain.handle(appIpcChannels.getColorScheme, () => {
    const scheme = getColorScheme()
    logColorSchemeIpcRead(scheme)
    return scheme
  })

  ipcMain.handle(appIpcChannels.getDefaultCwd, () => process.cwd())

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

  ipcMain.handle(appIpcChannels.pushGitChanges, async (_event, value: unknown) => {
    const options = getGitPushOptions(value)
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

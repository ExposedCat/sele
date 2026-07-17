import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  FilePlus2,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  History,
  Pencil,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { RefreshCwIcon as AnimatedRefreshCwIcon, type RefreshCwIconHandle } from 'lucide-animated'
import type { AppGitChangeKind, AppGitChangesResult, AppGitCommitAction } from '../../shared/app'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderFileDiff,
  ProviderWorkingItem,
  ProviderChatItem,
  ProviderChatMetadata,
  ProviderMessage,
  ProviderAccessMode,
  ProviderAccessModeOption,
  ProviderApprovalDecision,
  ProviderId,
  ProviderModel,
  ProviderModelId,
  ProviderReasoningEffort
} from '../../shared/provider'
import { fallbackProviderAccessModes, fallbackProviderModels } from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { ChatListGroup, type ChatListGroupData } from './components/ChatListGroup'
import { Button } from './components/Button'
import { Dropdown, type DropdownOption } from './components/Dropdown'
import { MessageBox } from './components/MessageBox'
import { appApi } from './appApi'
import { providerApi } from './providerApi'
import './App.css'

type LoadState = 'loading' | 'ready' | 'error'
type IncrementalLoadState = 'ready' | 'loading' | 'error'
type SendState = 'idle' | 'sending' | 'error'
type ApplyChatDetailOptions = {
  select?: boolean
}
type EditingMessage = Pick<ProviderMessage, 'id' | 'content'>
type ApprovalResolutionState = {
  approvalId: string | null
  decision: ProviderApprovalDecision | null
  error: string | null
}
type ChangeSource = 'branch' | 'lastTurn' | 'uncommitted'
type GitChangeSource = Exclude<ChangeSource, 'lastTurn'>
type CommitMode = 'agent' | 'manual'
type ChangedFile = {
  path: string
  previousPath?: string | null
  kind: AppGitChangeKind
  status?: string
  diff?: string
}
type ChatPaneWidths = {
  sidebar: number
  changes: number
}
type ChatPanePercents = {
  sidebar: number
  changes: number
}
type ChatResizeEdge = 'left' | 'right'
type GitChangesScope = {
  cwd: string
  source: GitChangeSource
}
type ProjectOptionData = {
  cwd: string
  updatedAt: number
}

const chatPageSize = 20
const chatSidebarDefaultWidth = 280
const changesSidebarDefaultWidth = 240
const chatSidebarMinWidth = 220
const changesSidebarMinWidth = 220
const chatBlockMinWidth = 320
const chatResizeHandleWidth = 9
const chatResizeHandleCount = 2
const chatPaneDefaultReferenceWidth = 1200
const chatPanePreferenceStorageKey = 'sele:chat-pane-preference:v1'
const pinnedGroupKey = 'pinned'
const unknownCwdGroupKey = 'cwd:unknown'
const doneGroupKey = 'done'
const newSessionProjectPlaceholderValue = '__sele_new_session_project_placeholder__'
const fallbackDefaultModel = fallbackProviderModels.find((model) => model.isDefault)
const fallbackInitialModel = fallbackDefaultModel ?? fallbackProviderModels[0]!
const fallbackInitialReasoningEffort = fallbackInitialModel?.defaultReasoningEffort ?? 'medium'
const fallbackDefaultAccessMode =
  fallbackProviderAccessModes.find((mode) => mode.isDefault)?.id ??
  fallbackProviderAccessModes[0]?.id ??
  'sandbox'
const refreshIconReplayMs = 1_050

const providerLabels = {
  codex: 'Codex'
} satisfies Record<ProviderId, string>

const changeSourceLabels = {
  branch: 'Branch',
  lastTurn: 'Last turn',
  uncommitted: 'Uncommitted'
} satisfies Record<ChangeSource, string>

const changeKindLabels = {
  edit: 'Modified',
  create: 'Added',
  delete: 'Deleted',
  rename: 'Renamed'
} satisfies Record<AppGitChangeKind, string>

const commitActionLabels = {
  commit: 'Commit',
  amend: 'Amend',
  commitAndPush: 'Commit & push'
} satisfies Record<AppGitCommitAction, string>

const GitRefreshIcon: React.FC<{ active: boolean }> = ({ active }) => {
  const iconRef = useRef<RefreshCwIconHandle | null>(null)

  useEffect(() => {
    const icon = iconRef.current

    if (!active) {
      icon?.stopAnimation()
      return undefined
    }

    icon?.startAnimation()
    const interval = window.setInterval(() => icon?.startAnimation(), refreshIconReplayMs)

    return () => {
      window.clearInterval(interval)
      icon?.stopAnimation()
    }
  }, [active])

  return (
    <AnimatedRefreshCwIcon
      ref={iconRef}
      className="changes-sidebar__refresh-icon"
      size={20}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

const getDropdownOptions = <TValue extends string>(
  labels: Record<TValue, string>
): DropdownOption<TValue>[] =>
  Object.entries(labels).map(([value, label]) => ({
    value: value as TValue,
    label: label as string
  }))

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

const roundPanePercent = (value: number): number => Math.round(value * 1000) / 1000

const getChatPanePercentsFromWidths = (
  widths: ChatPaneWidths,
  totalWidth: number
): ChatPanePercents => {
  const referenceWidth = totalWidth > 0 ? totalWidth : chatPaneDefaultReferenceWidth

  return {
    sidebar: roundPanePercent((widths.sidebar / referenceWidth) * 100),
    changes: roundPanePercent((widths.changes / referenceWidth) * 100)
  }
}

const getDefaultChatPanePercents = (totalWidth: number): ChatPanePercents =>
  getChatPanePercentsFromWidths(
    {
      sidebar: chatSidebarDefaultWidth,
      changes: changesSidebarDefaultWidth
    },
    totalWidth
  )

const getChatPaneWidthsFromPercents = (
  percents: ChatPanePercents,
  totalWidth: number
): ChatPaneWidths => {
  const referenceWidth = totalWidth > 0 ? totalWidth : chatPaneDefaultReferenceWidth

  return {
    sidebar: (percents.sidebar / 100) * referenceWidth,
    changes: (percents.changes / 100) * referenceWidth
  }
}

const clampChatPaneWidthsToAvailable = (
  widths: ChatPaneWidths,
  totalWidth: number
): ChatPaneWidths => {
  if (!totalWidth) return widths

  const handleWidth = chatResizeHandleWidth * chatResizeHandleCount
  const availableForSidebars = Math.max(0, totalWidth - handleWidth - chatBlockMinWidth)
  const minimumSidebarTotal = chatSidebarMinWidth + changesSidebarMinWidth

  if (availableForSidebars <= minimumSidebarTotal) {
    return {
      sidebar: chatSidebarMinWidth,
      changes: changesSidebarMinWidth
    }
  }

  let sidebar = Math.max(widths.sidebar, chatSidebarMinWidth)
  let changes = Math.max(widths.changes, changesSidebarMinWidth)
  const overflow = sidebar + changes - availableForSidebars

  if (overflow > 0) {
    const sidebarShrinkCapacity = sidebar - chatSidebarMinWidth
    const changesShrinkCapacity = changes - changesSidebarMinWidth
    const shrinkCapacity = sidebarShrinkCapacity + changesShrinkCapacity

    if (shrinkCapacity > 0) {
      sidebar -= overflow * (sidebarShrinkCapacity / shrinkCapacity)
      changes -= overflow * (changesShrinkCapacity / shrinkCapacity)
    }
  }

  return {
    sidebar: Math.round(sidebar),
    changes: Math.round(changes)
  }
}

const clampChatPanePercentsToAvailable = (
  percents: ChatPanePercents,
  totalWidth: number
): ChatPanePercents => {
  if (!totalWidth) return percents

  return getChatPanePercentsFromWidths(
    clampChatPaneWidthsToAvailable(getChatPaneWidthsFromPercents(percents, totalWidth), totalWidth),
    totalWidth
  )
}

const formatChatPanePercent = (percent: number): string => `${roundPanePercent(percent)}%`

const isChatPanePercentValue = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100

const readStoredChatPanePercents = (): ChatPanePercents | null => {
  try {
    const storedValue = window.localStorage.getItem(chatPanePreferenceStorageKey)
    if (!storedValue) return null

    const parsedValue = JSON.parse(storedValue) as Partial<ChatPanePercents> | null
    if (!parsedValue || typeof parsedValue !== 'object') return null
    if (!isChatPanePercentValue(parsedValue.sidebar)) return null
    if (!isChatPanePercentValue(parsedValue.changes)) return null

    return {
      sidebar: roundPanePercent(parsedValue.sidebar),
      changes: roundPanePercent(parsedValue.changes)
    }
  } catch {
    return null
  }
}

const writeStoredChatPanePercents = (percents: ChatPanePercents): void => {
  try {
    window.localStorage.setItem(chatPanePreferenceStorageKey, JSON.stringify(percents))
  } catch {
    // Layout preferences are non-critical; ignore unavailable storage.
  }
}

const providerOptions = getDropdownOptions(providerLabels)
const changeSourceOptions = getDropdownOptions(changeSourceLabels)

const approvalTypeLabels = {
  command: 'Command approval',
  fileChange: 'File change approval'
} as const

const getDefaultModel = (models: ProviderModel[]): ProviderModel =>
  models.find((nextModel) => nextModel.isDefault) ?? models[0] ?? fallbackInitialModel

const getDefaultReasoningEffort = (model: ProviderModel | undefined): ProviderReasoningEffort =>
  model?.defaultReasoningEffort ||
  model?.supportedReasoningEfforts.find((option) => option.isDefault)?.id ||
  model?.supportedReasoningEfforts[0]?.id ||
  fallbackInitialReasoningEffort

const getDefaultAccessMode = (accessModes: ProviderAccessModeOption[]): ProviderAccessMode =>
  accessModes.find((mode) => mode.isDefault)?.id ?? accessModes[0]?.id ?? fallbackDefaultAccessMode

const modelSupportsReasoningEffort = (
  model: ProviderModel | undefined,
  reasoningEffort: ProviderReasoningEffort
): boolean =>
  !model ||
  model.supportedReasoningEfforts.length === 0 ||
  model.supportedReasoningEfforts.some((option) => option.id === reasoningEffort)

const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

const compareChatsByCreatedAtDesc = (firstChat: ProviderChat, secondChat: ProviderChat): number => {
  if (secondChat.createdAt !== firstChat.createdAt) {
    return secondChat.createdAt - firstChat.createdAt
  }

  return secondChat.updatedAt - firstChat.updatedAt
}

const mergeChats = (...chatGroups: ProviderChat[][]): ProviderChat[] => {
  const chatsById = new Map<string, ProviderChat>()

  for (const chatGroup of chatGroups) {
    for (const chat of chatGroup) {
      const chatKey = getChatKey(chat)
      const existingChat = chatsById.get(chatKey)

      if (!existingChat || chat.updatedAt >= existingChat.updatedAt) {
        chatsById.set(chatKey, chat)
      }
    }
  }

  return Array.from(chatsById.values()).sort(compareChatsByCreatedAtDesc)
}

const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const getParentPath = (path: string): string => {
  const normalizedPath = path.replace(/\\/g, '/')
  const pathSeparatorIndex = normalizedPath.lastIndexOf('/')

  return pathSeparatorIndex < 0 ? '.' : normalizedPath.slice(0, pathSeparatorIndex)
}

const getFolderName = (path: string | null): string =>
  path ? getLastPathPart(path) : 'Choose folder'

const getFolderDescription = (path: string): string => {
  const parentPath = getParentPath(path)

  return parentPath && parentPath !== '.' ? parentPath : path
}

const getChatCwdLabel = (cwd: string | null): string =>
  cwd?.trim() ? getLastPathPart(cwd.trim()) : 'Unknown cwd'

const getChatCwdGroupKey = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? `cwd:${normalizedCwd}` : unknownCwdGroupKey
}

const getChatProjectCwd = (chat: Pick<ProviderChat, 'cwd' | 'projectCwd'>): string | null =>
  chat.projectCwd?.trim() || chat.cwd?.trim() || null

const getDefaultCollapsedGroupState = (groupKey: string): boolean => groupKey === doneGroupKey

const getCollapsedGroupState = (
  groupKey: string,
  collapsedGroups: Record<string, boolean>
): boolean => collapsedGroups[groupKey] ?? getDefaultCollapsedGroupState(groupKey)

const sortChatsForGroup = (chats: ProviderChat[]): ProviderChat[] =>
  [...chats].sort(compareChatsByCreatedAtDesc)

const groupChatsForSidebar = (chats: ProviderChat[]): ChatListGroupData[] => {
  const groupsByCwd = new Map<string, ChatListGroupData>()
  const pinnedChats: ProviderChat[] = []
  const doneChats: ProviderChat[] = []

  for (const chat of chats) {
    if (chat.pinned) {
      pinnedChats.push(chat)
      continue
    }

    if (chat.done) {
      doneChats.push(chat)
      continue
    }

    const projectCwd = getChatProjectCwd(chat)
    const key = getChatCwdGroupKey(projectCwd)
    const existingGroup = groupsByCwd.get(key)

    if (existingGroup) {
      existingGroup.chats.push(chat)
      continue
    }

    groupsByCwd.set(key, {
      key,
      cwd: projectCwd,
      label: getChatCwdLabel(projectCwd),
      chats: [chat],
      kind: 'cwd'
    })
  }

  const cwdGroups = Array.from(groupsByCwd.values()).map((group) => ({
    ...group,
    chats: sortChatsForGroup(group.chats)
  }))
  const pinnedGroups =
    pinnedChats.length === 0
      ? []
      : [
          {
            key: pinnedGroupKey,
            cwd: null,
            label: 'Pinned',
            chats: sortChatsForGroup(pinnedChats),
            kind: 'pinned' as const
          }
        ]

  return [
    ...pinnedGroups,
    ...cwdGroups,
    ...(doneChats.length === 0
      ? []
      : [
          {
            key: doneGroupKey,
            cwd: null,
            label: 'Done',
            chats: sortChatsForGroup(doneChats),
            kind: 'done' as const
          }
        ])
  ]
}

const getChatPreview = (detail: ProviderChatDetail): string | null => {
  const message = detail.items.findLast((item) => item.type === 'message')
  return message?.content.trim() || null
}

const getChatFromDetail = (
  providerId: ProviderId,
  detail: ProviderChatDetail,
  existingChat: ProviderChat | null,
  updatedAt: number
): ProviderChat => ({
  id: detail.id,
  providerId,
  title: detail.title,
  preview: getChatPreview(detail) ?? existingChat?.preview ?? '',
  cwd: detail.cwd ?? existingChat?.cwd ?? null,
  cwdKind: detail.cwdKind ?? existingChat?.cwdKind ?? 'directory',
  projectCwd: detail.projectCwd ?? existingChat?.projectCwd ?? detail.cwd ?? null,
  branchName: detail.branchName ?? existingChat?.branchName ?? null,
  createdAt: existingChat?.createdAt ?? updatedAt,
  updatedAt,
  status: detail.status,
  pinned: detail.pinned ?? existingChat?.pinned ?? false,
  done: detail.done ?? existingChat?.done ?? false
})

const getOptimisticItems = (items: ProviderChatItem[], message: string): ProviderChatItem[] => {
  const createdAt = Date.now()
  const id = `optimistic:${createdAt}`

  return [
    ...items,
    {
      type: 'message',
      id: `${id}:user`,
      role: 'user',
      content: message,
      createdAt
    },
    {
      type: 'working',
      id: `${id}:working`,
      status: 'working',
      items: []
    }
  ]
}

const hasActiveWorkingStep = (detail: ProviderChatDetail | null): boolean =>
  detail?.items.some((item) => item.type === 'working' && item.status === 'working') ?? false

const getVisibleChatItems = (
  items: ProviderChatItem[],
  editingMessage: EditingMessage | null
): ProviderChatItem[] => {
  if (!editingMessage) return items

  const editingMessageIndex = items.findIndex(
    (item) => item.type === 'message' && item.id === editingMessage.id
  )

  return editingMessageIndex < 0 ? items : items.slice(0, editingMessageIndex)
}

const sortChangedFiles = (files: ChangedFile[]): ChangedFile[] =>
  [...files].sort((firstFile, secondFile) => firstFile.path.localeCompare(secondFile.path))

const getWorkingItemDiffs = (item: ProviderWorkingItem): ProviderFileDiff[] => {
  if (item.type === 'tool') return item.diffs
  if (item.type === 'toolGroup') return item.tools.flatMap((tool) => tool.diffs)

  return []
}

const getLastTurnChangedFiles = (detail: ProviderChatDetail | null): ChangedFile[] => {
  const lastWorkingStep = detail?.items.findLast((item) => item.type === 'working')
  if (!lastWorkingStep) return []

  const filesByPath = new Map<string, ChangedFile>()

  for (const workingItem of lastWorkingStep.items) {
    for (const diff of getWorkingItemDiffs(workingItem)) {
      filesByPath.set(diff.path, {
        path: diff.path,
        kind: diff.kind,
        diff: diff.diff
      })
    }
  }

  return sortChangedFiles(Array.from(filesByPath.values()))
}

const getGitChangedFiles = (result: AppGitChangesResult | null): ChangedFile[] =>
  sortChangedFiles(
    result?.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      kind: file.kind,
      status: file.status
    })) ?? []
  )

const formatCommitFile = (file: ChangedFile): string =>
  file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path

const getCommitFiles = (files: ChangedFile[]): string[] =>
  Array.from(
    new Set(
      files.flatMap((file) =>
        [file.previousPath, file.path].filter((path): path is string => Boolean(path))
      )
    )
  )

const getCommitMessage = (files: ChangedFile[], action: AppGitCommitAction): string => {
  const fileList = files.map(formatCommitFile).join(', ')

  if (action === 'amend') return `Amend last commit with these files: ${fileList}`
  if (action === 'commitAndPush') {
    return `Following repo commit preferences and naming, commit and push: ${fileList}`
  }

  return `Following repo commit preferences and naming, commit: ${fileList}`
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback

  const message = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()

  return message || fallback
}

const isGitChangesScope = (
  scope: GitChangesScope | null,
  cwd: string | null,
  source: GitChangeSource | null
): boolean => Boolean(scope && cwd && source && scope.cwd === cwd && scope.source === source)

const getChangesEmptyMessage = (
  source: ChangeSource,
  cwd: string | null,
  result: AppGitChangesResult | null
): string => {
  if (source === 'lastTurn') return 'No files changed in the last turn.'
  if (!cwd) return 'Choose a folder to see changes.'
  if (source === 'branch' && result && !result.baseRef) return 'No branch base found.'

  return `No ${changeSourceLabels[source].toLocaleLowerCase()} changes.`
}

const getApprovalSummary = (
  approval: NonNullable<ProviderChatDetail['pendingApproval']>
): string => {
  if (approval.command) return approval.command
  if (approval.reason) return approval.reason
  if (approval.cwd) return approval.cwd

  return approval.type === 'fileChange'
    ? 'File changes require approval'
    : 'Command requires approval'
}

const ChangeKindIcon: React.FC<{ kind: AppGitChangeKind }> = ({ kind }) => {
  if (kind === 'create') return <FilePlus2 aria-hidden="true" />
  if (kind === 'delete') return <Trash2 aria-hidden="true" />
  if (kind === 'rename') return <History aria-hidden="true" />

  return <Pencil aria-hidden="true" />
}

export const App: React.FC = () => {
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('ready')
  const [chatLoadRequest, setChatLoadRequest] = useState(0)
  const [sendState, setSendState] = useState<SendState>('idle')
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null)
  const [accessModes, setAccessModes] = useState<ProviderAccessModeOption[]>(
    fallbackProviderAccessModes
  )
  const [accessMode, setAccessMode] = useState<ProviderAccessMode>(fallbackDefaultAccessMode)
  const [models, setModels] = useState<ProviderModel[]>(fallbackProviderModels)
  const [model, setModel] = useState<ProviderModelId>(fallbackInitialModel.id)
  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>(
    fallbackInitialReasoningEffort
  )
  const [approvalResolution, setApprovalResolution] = useState<ApprovalResolutionState>({
    approvalId: null,
    decision: null,
    error: null
  })
  const [newChatOpen, setNewChatOpen] = useState(true)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')
  const [projectHistory, setProjectHistory] = useState<ProjectOptionData[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedCwdGroups, setCollapsedCwdGroups] = useState<Record<string, boolean>>({})
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [chatPageLoadState, setChatPageLoadState] = useState<IncrementalLoadState>('ready')
  const [changeSource, setChangeSource] = useState<ChangeSource>('branch')
  const [gitChanges, setGitChanges] = useState<AppGitChangesResult | null>(null)
  const [gitChangesScope, setGitChangesScope] = useState<GitChangesScope | null>(null)
  const [gitChangeLoadState, setGitChangeLoadState] = useState<LoadState>('ready')
  const [gitChangeLoadScope, setGitChangeLoadScope] = useState<GitChangesScope | null>(null)
  const [gitChangeLoadRequest, setGitChangeLoadRequest] = useState(0)
  const [commitMode, setCommitMode] = useState<CommitMode>('agent')
  const [manualCommitMessage, setManualCommitMessage] = useState('')
  const [commitState, setCommitState] = useState<SendState>('idle')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [pushState, setPushState] = useState<SendState>('idle')
  const [pushError, setPushError] = useState<string | null>(null)
  const [panePercents, setPanePercents] = useState<ChatPanePercents | null>(
    readStoredChatPanePercents
  )
  const [panelsWidth, setPanelsWidth] = useState(0)
  const panelsRef = useRef<HTMLDivElement>(null)
  const sidebarBodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const chatLoadTriggerRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const changesResizeHandleRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sendInFlightRef = useRef(false)
  const modelManuallySelectedRef = useRef(false)
  const reasoningManuallySelectedRef = useRef(false)
  const accessModeManuallySelectedRef = useRef(false)

  const defaultPanePercents = useMemo(() => getDefaultChatPanePercents(panelsWidth), [panelsWidth])
  const preferredPanePercents = panePercents ?? defaultPanePercents
  const displayedPanePercents = useMemo(
    () => clampChatPanePercentsToAvailable(preferredPanePercents, panelsWidth),
    [panelsWidth, preferredPanePercents]
  )

  useEffect(() => {
    if (!panePercents) return

    writeStoredChatPanePercents(panePercents)
  }, [panePercents])

  useEffect(() => {
    const panels = panelsRef.current
    if (!panels) return

    const updatePanelsWidth = (width: number): void => {
      const roundedWidth = Math.round(width)
      setPanelsWidth((currentWidth) =>
        currentWidth === roundedWidth ? currentWidth : roundedWidth
      )
    }

    updatePanelsWidth(panels.getBoundingClientRect().width)

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updatePanelsWidth(entry.contentRect.width)
    })
    observer.observe(panels)

    return () => observer.disconnect()
  }, [])

  const handleStartChatResize = useCallback(
    (edge: ChatResizeEdge, event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return

      const panels = panelsRef.current
      if (!panels) return

      event.preventDefault()
      event.currentTarget.blur()

      const startX = event.clientX
      const totalWidth = panels.getBoundingClientRect().width
      if (!totalWidth) return

      const startWidths = getChatPaneWidthsFromPercents(displayedPanePercents, totalWidth)
      const handleWidth = chatResizeHandleWidth * chatResizeHandleCount
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const deltaX = moveEvent.clientX - startX

        setPanePercents(() => {
          if (edge === 'left') {
            const maxSidebarWidth =
              totalWidth - startWidths.changes - handleWidth - chatBlockMinWidth

            const nextWidths = {
              sidebar: Math.round(
                clamp(startWidths.sidebar + deltaX, chatSidebarMinWidth, maxSidebarWidth)
              ),
              changes: startWidths.changes
            }

            return getChatPanePercentsFromWidths(nextWidths, totalWidth)
          }

          const maxChangesWidth = totalWidth - startWidths.sidebar - handleWidth - chatBlockMinWidth

          const nextWidths = {
            sidebar: startWidths.sidebar,
            changes: Math.round(
              clamp(startWidths.changes - deltaX, changesSidebarMinWidth, maxChangesWidth)
            )
          }

          return getChatPanePercentsFromWidths(nextWidths, totalWidth)
        })
      }

      const handlePointerUp = (): void => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [displayedPanePercents]
  )

  useEffect(() => {
    let active = true

    const loadInitialChats = async (): Promise<void> => {
      try {
        const page = await providerApi.getChats('codex', {
          cursor: null,
          limit: chatPageSize
        })

        if (!active) return

        setChats((currentChats) => mergeChats(currentChats, page.chats))
        setNextCursor(page.nextCursor)
        setLoadState('ready')
      } catch {
        if (active) setLoadState('error')
      }
    }

    void loadInitialChats()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadProjectHistory = async (): Promise<void> => {
      const projectsByCwd = new Map<string, ProjectOptionData>()
      let cursor: string | null = null

      try {
        do {
          const page = await providerApi.getChats('codex', {
            cursor,
            limit: 100
          })

          if (!active) return

          page.chats.forEach((chat) => {
            const cwd = getChatProjectCwd(chat)
            if (!cwd) return

            const existingProject = projectsByCwd.get(cwd)
            if (!existingProject || chat.updatedAt > existingProject.updatedAt) {
              projectsByCwd.set(cwd, { cwd, updatedAt: chat.updatedAt })
            }
          })

          cursor = page.nextCursor
        } while (cursor)

        if (active) setProjectHistory(Array.from(projectsByCwd.values()))
      } catch {
        // The visible chat list still provides project options if this background load fails.
      }
    }

    void loadProjectHistory()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    providerApi
      .getAccessModes('codex')
      .then((nextAccessModes) => {
        if (!active || nextAccessModes.length === 0) return

        setAccessModes(nextAccessModes)
      })
      .catch(() => {
        if (active) setAccessModes(fallbackProviderAccessModes)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (accessModes.length === 0) return

    const defaultAccessMode = getDefaultAccessMode(accessModes)

    setAccessMode((currentAccessMode) => {
      const currentAccessModeExists = accessModes.some((mode) => mode.id === currentAccessMode)

      if (!currentAccessModeExists) return defaultAccessMode
      if (
        !accessModeManuallySelectedRef.current &&
        currentAccessMode === fallbackDefaultAccessMode
      ) {
        return defaultAccessMode
      }

      return currentAccessMode
    })
  }, [accessModes])

  useEffect(() => {
    let active = true

    providerApi
      .getModels('codex')
      .then((nextModels) => {
        if (!active || nextModels.length === 0) return

        setModels(nextModels)
      })
      .catch(() => {
        if (active) setModels(fallbackProviderModels)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (models.length === 0) return

    const defaultModel = getDefaultModel(models)

    setModel((currentModel) => {
      const currentModelExists = models.some((nextModel) => nextModel.id === currentModel)

      if (!currentModelExists) return defaultModel.id
      if (!modelManuallySelectedRef.current && currentModel === fallbackInitialModel.id) {
        return defaultModel.id
      }

      return currentModel
    })
  }, [models])

  useEffect(() => {
    const selectedModel = models.find((nextModel) => nextModel.id === model)
    if (!selectedModel) return

    setReasoningEffort((currentReasoningEffort) => {
      if (!reasoningManuallySelectedRef.current) return getDefaultReasoningEffort(selectedModel)
      if (modelSupportsReasoningEffort(selectedModel, currentReasoningEffort)) {
        return currentReasoningEffort
      }

      return getDefaultReasoningEffort(selectedModel)
    })
  }, [model, models])

  const applyChatDetail = useCallback(
    (
      providerId: ProviderId,
      detail: ProviderChatDetail,
      options: ApplyChatDetailOptions = {}
    ): void => {
      const updatedAt = Date.now()

      if (options.select) {
        setChatDetail(detail)
        setChatLoadState('ready')
        setSelectedChat(getChatFromDetail(providerId, detail, null, updatedAt))
        setNewChatOpen(false)
      } else {
        setChatDetail((currentDetail) => (currentDetail?.id === detail.id ? detail : currentDetail))
        setSelectedChat((currentChat) =>
          currentChat?.providerId === providerId && currentChat.id === detail.id
            ? getChatFromDetail(providerId, detail, currentChat, updatedAt)
            : currentChat
        )
      }

      setChats((currentChats) => {
        const existingChat =
          currentChats.find((chat) => chat.providerId === providerId && chat.id === detail.id) ??
          null
        const nextChat = getChatFromDetail(providerId, detail, existingChat, updatedAt)

        return mergeChats(currentChats, [nextChat])
      })
    },
    []
  )

  const showNewChatView = useCallback((): void => {
    setSelectedChat(null)
    setChatDetail(null)
    setChatLoadState('ready')
    setSendState('idle')
    setEditingMessage(null)
    setSearchOpen(false)
    setSearchQuery('')
    setNewChatOpen(true)
  }, [])

  const applyChatMetadata = useCallback((metadataList: ProviderChatMetadata[]): void => {
    const metadataById = new Map(metadataList.map((metadata) => [metadata.id, metadata]))

    setChats((currentChats) =>
      currentChats.map((chat) => {
        const metadata = metadataById.get(chat.id)
        return metadata ? { ...chat, pinned: metadata.pinned, done: metadata.done } : chat
      })
    )
    setSelectedChat((currentChat) => {
      if (!currentChat) return currentChat

      const metadata = metadataById.get(currentChat.id)
      return metadata
        ? { ...currentChat, pinned: metadata.pinned, done: metadata.done }
        : currentChat
    })
    setChatDetail((currentDetail) => {
      if (!currentDetail) return currentDetail

      const metadata = metadataById.get(currentDetail.id)
      return metadata
        ? { ...currentDetail, pinned: metadata.pinned, done: metadata.done }
        : currentDetail
    })
  }, [])

  useEffect(
    () =>
      providerApi.onChatUpdated((event) => {
        applyChatDetail(event.providerId, event.detail)
      }),
    [applyChatDetail]
  )

  const selectedProviderId = selectedChat?.providerId
  const selectedChatId = selectedChat?.id
  const changesCwd = selectedChat ? (chatDetail?.cwd ?? selectedChat.cwd) : newSessionCwd
  const pendingApproval = chatDetail?.pendingApproval ?? null
  const currentApprovalResolution =
    approvalResolution.approvalId === pendingApproval?.id ? approvalResolution : null
  const approvalDecisionInFlight = currentApprovalResolution?.decision ?? null
  const approvalError = currentApprovalResolution?.error ?? null

  useEffect(() => {
    if (!selectedProviderId || !selectedChatId) return
    if (chatDetail?.id === selectedChatId) return

    let active = true

    providerApi
      .getChat(selectedProviderId, selectedChatId)
      .then((detail) => {
        if (!active) return
        setChatDetail(detail)
        setChatLoadState('ready')
      })
      .catch(() => {
        if (active) setChatLoadState('error')
      })

    return () => {
      active = false
    }
  }, [chatDetail?.id, chatLoadRequest, selectedProviderId, selectedChatId])

  useEffect(() => {
    const resizeHandles = [resizeHandleRef.current, changesResizeHandleRef.current].filter(
      (resizeHandle): resizeHandle is HTMLDivElement => Boolean(resizeHandle)
    )
    if (resizeHandles.length === 0) return

    const removeTabStop = (resizeHandle: HTMLDivElement): void => {
      resizeHandle.removeAttribute('tabindex')
      if (document.activeElement === resizeHandle) resizeHandle.blur()
    }

    resizeHandles.forEach(removeTabStop)

    const observers = resizeHandles.map((resizeHandle) => {
      const observer = new MutationObserver(() => removeTabStop(resizeHandle))
      observer.observe(resizeHandle, {
        attributeFilter: ['tabindex'],
        attributes: true
      })

      return observer
    })

    return () => {
      observers.forEach((observer) => observer.disconnect())
    }
  }, [])

  useEffect(() => {
    if (!chatDetail) return

    contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight })
  }, [chatDetail])

  useEffect(() => {
    if (selectedChat) return

    contentRef.current?.scrollTo({ top: 0 })
  }, [selectedChat])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    let active = true

    appApi
      .getDefaultCwd()
      .then((cwd) => {
        if (active) setNewSessionCwd(cwd)
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!changesCwd) return

    let active = true
    const gitChangeSource: GitChangeSource =
      changeSource === 'lastTurn' ? 'uncommitted' : changeSource
    const gitChangeScope: GitChangesScope = {
      cwd: changesCwd,
      source: gitChangeSource
    }

    if (changeSource !== 'lastTurn') {
      queueMicrotask(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        setGitChangeLoadState('loading')
      })
    }

    appApi
      .getGitChanges({
        cwd: changesCwd,
        source: gitChangeSource
      })
      .then((result) => {
        if (!active) return
        setGitChanges(result)
        setGitChangesScope(gitChangeScope)
        setGitChangeLoadScope(gitChangeScope)
        if (changeSource !== 'lastTurn') setGitChangeLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setGitChangeLoadScope(gitChangeScope)
        if (changeSource !== 'lastTurn') setGitChangeLoadState('error')
      })

    return () => {
      active = false
    }
  }, [changeSource, changesCwd, gitChangeLoadRequest])

  const searchTerms = searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const filteredChats =
    searchTerms.length === 0
      ? chats
      : chats.filter((chat) => {
          const title = chat.title.toLocaleLowerCase()
          const cwd = chat.cwd?.toLocaleLowerCase() ?? ''
          const cwdLabel = getChatCwdLabel(chat.cwd).toLocaleLowerCase()
          return searchTerms.every(
            (term) => title.includes(term) || cwd.includes(term) || cwdLabel.includes(term)
          )
        })
  const chatGroups = groupChatsForSidebar(filteredChats)
  const pinnedChatGroup = chatGroups.find((group) => group.kind === 'pinned') ?? null
  const activeChatGroups = chatGroups.filter((group) => group.kind === 'cwd')
  const doneChatGroup = chatGroups.find((group) => group.kind === 'done') ?? null
  const hasMoreChats = Boolean(nextCursor)
  const projectOptions = useMemo<DropdownOption<string>[]>(() => {
    const projectsByCwd = new Map<string, { cwd: string; updatedAt: number }>()

    const addProject = (cwd: string | null, updatedAt: number): void => {
      const normalizedCwd = cwd?.trim()
      if (!normalizedCwd) return

      const existingProject = projectsByCwd.get(normalizedCwd)
      if (!existingProject || updatedAt > existingProject.updatedAt) {
        projectsByCwd.set(normalizedCwd, { cwd: normalizedCwd, updatedAt })
      }
    }

    projectHistory.forEach((project) => addProject(project.cwd, project.updatedAt))
    chats.forEach((chat) => addProject(getChatProjectCwd(chat), chat.updatedAt))
    addProject(newSessionCwd, Number.MAX_SAFE_INTEGER)

    const options = Array.from(projectsByCwd.values())
      .sort((firstProject, secondProject) => {
        if (secondProject.updatedAt !== firstProject.updatedAt) {
          return secondProject.updatedAt - firstProject.updatedAt
        }

        return getFolderName(firstProject.cwd).localeCompare(getFolderName(secondProject.cwd))
      })
      .map((project) => ({
        value: project.cwd,
        label: getFolderName(project.cwd),
        menuLabel: getFolderName(project.cwd),
        description: getFolderDescription(project.cwd)
      }))

    if (!newSessionCwd) {
      return [
        {
          value: newSessionProjectPlaceholderValue,
          label: 'Choose folder',
          disabled: true
        },
        ...options
      ]
    }

    return options
  }, [chats, newSessionCwd, projectHistory])
  const newSessionProjectValue = newSessionCwd ?? newSessionProjectPlaceholderValue

  const loadMoreChats = useCallback(async (): Promise<void> => {
    if (chatPageLoadState === 'loading' || !nextCursor) return

    setChatPageLoadState('loading')

    try {
      const page = await providerApi.getChats('codex', {
        cursor: nextCursor,
        limit: chatPageSize
      })

      setChats((currentChats) => mergeChats(currentChats, page.chats))
      setNextCursor(page.nextCursor)
      setChatPageLoadState('ready')
    } catch {
      setChatPageLoadState('error')
    }
  }, [chatPageLoadState, nextCursor])

  useEffect(() => {
    if (!hasMoreChats || chatPageLoadState !== 'ready') return

    const root = sidebarBodyRef.current
    const trigger = chatLoadTriggerRef.current
    if (!root || !trigger) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadMoreChats()
      },
      {
        root,
        rootMargin: '96px 0px',
        threshold: 0.1
      }
    )

    observer.observe(trigger)
    return () => observer.disconnect()
  }, [chatPageLoadState, hasMoreChats, loadMoreChats])

  const handleToggleCwdGroup = (groupKey: string): void => {
    setCollapsedCwdGroups((currentGroups) => ({
      ...currentGroups,
      [groupKey]: !getCollapsedGroupState(groupKey, currentGroups)
    }))
  }

  const handleSelectChat = (chat: ProviderChat): void => {
    const selectingCurrentChat =
      selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id

    setSendState('idle')
    setEditingMessage(null)
    setNewChatOpen(false)
    setSearchOpen(false)
    setSearchQuery('')

    if (selectingCurrentChat && chatLoadState === 'ready' && chatDetail?.id === chat.id) return

    setChatDetail(null)
    setChatLoadState('loading')
    setSelectedChat(chat)

    if (selectingCurrentChat) {
      setChatLoadRequest((currentRequest) => currentRequest + 1)
    }
  }

  const handleBack = (): void => {
    setSelectedChat(null)
    setChatDetail(null)
    setNewChatOpen(false)
    setSendState('idle')
    setEditingMessage(null)
  }

  const handleNewChat = (): void => {
    showNewChatView()
  }

  const handleCloseSearch = (): void => {
    setSearchOpen(false)
    setSearchQuery('')
  }

  const handleSelectNewSessionFolder = async (): Promise<void> => {
    try {
      const folder = await appApi.selectFolder({ defaultPath: newSessionCwd })
      if (folder) setNewSessionCwd(folder)
    } catch {
      // Keep the current folder if the native dialog cannot be opened.
    }
  }

  const handleModelChange = (nextModelId: ProviderModelId): void => {
    modelManuallySelectedRef.current = true
    setModel(nextModelId)

    const nextModel = models.find((candidateModel) => candidateModel.id === nextModelId)
    if (!nextModel) return

    setReasoningEffort((currentReasoningEffort) => {
      if (
        reasoningManuallySelectedRef.current &&
        modelSupportsReasoningEffort(nextModel, currentReasoningEffort)
      ) {
        return currentReasoningEffort
      }

      return getDefaultReasoningEffort(nextModel)
    })
  }

  const handleReasoningEffortChange = (nextReasoningEffort: ProviderReasoningEffort): void => {
    reasoningManuallySelectedRef.current = true
    setReasoningEffort(nextReasoningEffort)
  }

  const handleAccessModeChange = (nextAccessMode: ProviderAccessMode): void => {
    accessModeManuallySelectedRef.current = true
    setAccessMode(nextAccessMode)
  }

  const handleMarkChatDone = async (chat: ProviderChat): Promise<void> => {
    try {
      const metadata = await providerApi.markChatDone(chat.providerId, chat.id)
      applyChatMetadata([metadata])

      if (selectedChat?.providerId === chat.providerId && selectedChat.id === chat.id) {
        showNewChatView()
      }
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }

  const handleToggleChatPinned = async (chat: ProviderChat): Promise<void> => {
    try {
      const metadata = await providerApi.setChatPinned(chat.providerId, chat.id, !chat.pinned)
      applyChatMetadata([metadata])
    } catch {
      // Leave the chat as-is if local metadata cannot be updated.
    }
  }

  const handleUnpinPinnedChats = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'pinned') return

    try {
      const metadataList = await Promise.all(
        group.chats.map((chat) => providerApi.setChatPinned(chat.providerId, chat.id, false))
      )
      applyChatMetadata(metadataList)
    } catch {
      // Leave the group as-is if local metadata cannot be updated.
    }
  }

  const handleMarkCwdChatsDone = async (group: ChatListGroupData): Promise<void> => {
    if (group.kind !== 'cwd') return

    try {
      const providerIds = Array.from(new Set(group.chats.map((chat) => chat.providerId)))
      const groupCwds = Array.from(new Set(group.chats.map((chat) => chat.cwd ?? null)))
      const metadataGroups = await Promise.all(
        providerIds.flatMap((providerId) =>
          groupCwds.map((cwd) => providerApi.markCwdChatsDone(providerId, cwd))
        )
      )
      applyChatMetadata(metadataGroups.flat())

      if (
        selectedChat &&
        !selectedChat.done &&
        getChatCwdGroupKey(getChatProjectCwd(selectedChat)) === getChatCwdGroupKey(group.cwd)
      ) {
        showNewChatView()
      }
    } catch {
      // Leave the group as-is if local metadata cannot be updated.
    }
  }

  const handleEditMessage = (message: ProviderMessage): void => {
    if (
      message.role !== 'user' ||
      !chatDetail?.capabilities.editMessages ||
      chatIsBusy ||
      sendInFlightRef.current
    ) {
      return
    }

    setSendState('idle')
    setEditingMessage({
      id: message.id,
      content: message.content
    })
  }

  const handleCancelEditMessage = (): void => {
    setSendState('idle')
    setEditingMessage(null)
  }

  const handleSendMessage = async (message: string): Promise<void> => {
    if (sendInFlightRef.current) return
    sendInFlightRef.current = true
    const turnOptions = { accessMode, model, reasoningEffort }

    if (editingMessage) {
      if (!selectedChat) {
        sendInFlightRef.current = false
        return
      }

      setSendState('sending')

      try {
        const detail = await providerApi.editMessage(
          selectedChat.providerId,
          selectedChat.id,
          editingMessage.id,
          message,
          turnOptions
        )
        applyChatDetail(selectedChat.providerId, detail)
        setEditingMessage(null)
        setSendState('idle')
      } catch (error) {
        setSendState('error')
        throw error
      } finally {
        sendInFlightRef.current = false
      }

      return
    }

    if (!selectedChat) {
      setSendState('sending')

      try {
        const detail = await providerApi.startChat(newSessionProvider, message, {
          ...turnOptions,
          cwd: newSessionCwd ?? undefined
        })
        applyChatDetail(newSessionProvider, detail, { select: true })
        setSendState('idle')
      } catch {
        setSendState('error')
      } finally {
        sendInFlightRef.current = false
      }

      return
    }

    const providerId = selectedChat.providerId
    const chatId = selectedChat.id
    setSendState('sending')

    if (chatDetail?.id === chatId) {
      applyChatDetail(providerId, {
        ...chatDetail,
        status: 'active',
        items: getOptimisticItems(chatDetail.items, message)
      })
    }

    try {
      const detail = await providerApi.continueChat(providerId, chatId, message, turnOptions)
      applyChatDetail(providerId, detail)
      setSendState('idle')
    } catch {
      void providerApi
        .getChat(providerId, chatId)
        .then((detail) => applyChatDetail(providerId, detail))
        .catch(() => {})
      setSendState('error')
    } finally {
      sendInFlightRef.current = false
    }
  }

  const handleResolveApproval = async (decision: ProviderApprovalDecision): Promise<void> => {
    if (!selectedChat || !pendingApproval || approvalDecisionInFlight) return

    const approvalId = pendingApproval.id
    setApprovalResolution({ approvalId, decision, error: null })

    try {
      const detail = await providerApi.resolveApproval(
        selectedChat.providerId,
        selectedChat.id,
        decision
      )
      applyChatDetail(selectedChat.providerId, detail)
    } catch {
      setApprovalResolution({
        approvalId,
        decision: null,
        error: 'Unable to resolve approval.'
      })
    } finally {
      setApprovalResolution((currentResolution) =>
        currentResolution.approvalId === approvalId
          ? { ...currentResolution, decision: null }
          : currentResolution
      )
    }
  }

  const handleStopChat = async (): Promise<void> => {
    if (!selectedChat || sendInFlightRef.current) return
    sendInFlightRef.current = true
    setSendState('sending')

    try {
      const detail = await providerApi.stopChat(selectedChat.providerId, selectedChat.id)
      applyChatDetail(selectedChat.providerId, detail)
      setSendState('idle')
    } catch {
      setSendState('error')
    } finally {
      sendInFlightRef.current = false
    }
  }

  const renderChatGroup = (group: ChatListGroupData, contentId: string): React.ReactElement => {
    const groupOpen =
      searchTerms.length > 0 || !getCollapsedGroupState(group.key, collapsedCwdGroups)

    return (
      <ChatListGroup
        contentId={contentId}
        group={group}
        key={group.key}
        open={groupOpen}
        selectedChatKey={selectedChat ? getChatKey(selectedChat) : null}
        onMarkChatDone={handleMarkChatDone}
        onMarkCwdChatsDone={(nextGroup) => void handleMarkCwdChatsDone(nextGroup)}
        onSelectChat={handleSelectChat}
        onToggle={handleToggleCwdGroup}
        onToggleChatPinned={handleToggleChatPinned}
        onUnpinPinnedChats={(nextGroup) => void handleUnpinPinnedChats(nextGroup)}
      />
    )
  }

  const chatIsWaiting =
    chatDetail?.status === 'waitingOnApproval' || chatDetail?.status === 'waitingOnUserInput'
  const chatHasActiveTurn = chatDetail?.status === 'active' || chatIsWaiting
  const chatIsBusy =
    chatHasActiveTurn || (sendState === 'sending' && hasActiveWorkingStep(chatDetail))
  const messageBoxDisabled = selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false
  const canEditOwnMessages = Boolean(
    selectedChat &&
    chatDetail?.capabilities.editMessages &&
    chatLoadState === 'ready' &&
    !chatIsBusy &&
    sendState !== 'sending' &&
    !editingMessage
  )
  const visibleChatItems = chatDetail ? getVisibleChatItems(chatDetail.items, editingMessage) : []
  const chatPanelOpen = Boolean(selectedChat) || newChatOpen
  const lastTurnChangedFiles = useMemo(() => getLastTurnChangedFiles(chatDetail), [chatDetail])
  const currentGitChangeSource: GitChangeSource | null =
    changeSource === 'lastTurn' ? null : changeSource
  const gitChangesMatchCurrentSource = isGitChangesScope(
    gitChangesScope,
    changesCwd,
    currentGitChangeSource
  )
  const displayedGitChanges = gitChangesMatchCurrentSource ? gitChanges : null
  const gitChangedFiles = useMemo(
    () => (changesCwd ? getGitChangedFiles(displayedGitChanges) : []),
    [changesCwd, displayedGitChanges]
  )
  const changedFiles = changeSource === 'lastTurn' ? lastTurnChangedFiles : gitChangedFiles
  const gitChangeLoadMatchesCurrentSource = isGitChangesScope(
    gitChangeLoadScope,
    changesCwd,
    currentGitChangeSource
  )
  const changesLoadState =
    changeSource === 'lastTurn' || !changesCwd
      ? 'ready'
      : gitChangeLoadMatchesCurrentSource
        ? gitChangeLoadState
        : 'loading'
  const visibleChangesLoadState =
    changesLoadState === 'loading' && displayedGitChanges ? 'ready' : changesLoadState
  const unpushedCount =
    changesCwd && gitChangesScope?.cwd === changesCwd ? (gitChanges?.unpushedCount ?? 0) : 0
  const hasUnpushedChanges = unpushedCount > 0
  const canCommitChangeSource = changeSource !== 'branch'
  const commitUnavailableTitle = canCommitChangeSource
    ? undefined
    : 'Switch to Uncommitted or Last turn to commit files.'
  const manualCommitMessageValue = manualCommitMessage.trim()
  const commitFiles = useMemo(() => getCommitFiles(changedFiles), [changedFiles])
  const commitBaseDisabled =
    !canCommitChangeSource ||
    changedFiles.length === 0 ||
    commitFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    commitState === 'sending' ||
    pushState === 'sending'
  const getCommitActionDisabled = (action: AppGitCommitAction): boolean =>
    commitBaseDisabled ||
    (commitMode === 'manual'
      ? !changesCwd || (action !== 'amend' && !manualCommitMessageValue)
      : sendState === 'sending' ||
        Boolean(editingMessage) ||
        (selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false))
  const commitDisabled = getCommitActionDisabled('commit')
  const pushDisabled = !changesCwd || pushState === 'sending' || commitState === 'sending'
  const changesEmptyMessage = getChangesEmptyMessage(changeSource, changesCwd, displayedGitChanges)
  const changesContextLabel =
    changeSource === 'branch' && displayedGitChanges?.branchName
      ? displayedGitChanges.baseRef
        ? `${displayedGitChanges.branchName} from ${displayedGitChanges.baseRef}`
        : displayedGitChanges.branchName
      : changesCwd
        ? getFolderName(changesCwd)
        : 'No folder'
  const usePercentagePaneTracks = Boolean(panePercents) || panelsWidth > 0
  const panelsStyle = {
    '--chat-sidebar-width': usePercentagePaneTracks
      ? formatChatPanePercent(displayedPanePercents.sidebar)
      : `${chatSidebarDefaultWidth}px`,
    '--chat-changes-width': usePercentagePaneTracks
      ? formatChatPanePercent(displayedPanePercents.changes)
      : `${changesSidebarDefaultWidth}px`
  } as CSSProperties

  const renderChangedFile = (file: ChangedFile): React.ReactElement => (
    <li className={`changes-sidebar__file changes-sidebar__file--${file.kind}`} key={file.path}>
      <span
        className="changes-sidebar__file-icon"
        role="img"
        aria-label={changeKindLabels[file.kind]}
        title={changeKindLabels[file.kind]}
      >
        <ChangeKindIcon kind={file.kind} />
      </span>
      <span className="changes-sidebar__file-main">
        <span className="changes-sidebar__file-name" title={file.path}>
          {getLastPathPart(file.path)}
        </span>
        <span className="changes-sidebar__file-path" title={file.path}>
          {getParentPath(file.path)}
        </span>
        {file.previousPath && (
          <span className="changes-sidebar__file-path" title={file.previousPath}>
            from {file.previousPath}
          </span>
        )}
      </span>
    </li>
  )

  const handleCommitModeToggle = (): void => {
    setCommitState('idle')
    setCommitError(null)
    setCommitMode((currentMode) => (currentMode === 'manual' ? 'agent' : 'manual'))
  }

  const handleCommitChangedFiles = async (action: AppGitCommitAction = 'commit'): Promise<void> => {
    if (getCommitActionDisabled(action)) return

    if (commitMode === 'manual') {
      if (!changesCwd) return

      setCommitState('sending')
      setCommitError(null)

      try {
        await appApi.commitGitChanges({
          cwd: changesCwd,
          action,
          files: commitFiles,
          message: action === 'amend' ? null : manualCommitMessageValue
        })
        setManualCommitMessage('')
        setCommitState('idle')
        setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
      } catch (error) {
        setCommitState('error')
        setCommitError(getErrorMessage(error, 'Unable to commit these files.'))
      }

      return
    }

    await handleSendMessage(getCommitMessage(changedFiles, action))
  }

  const handlePushChanges = async (): Promise<void> => {
    if (pushDisabled || !changesCwd) return

    setPushState('sending')
    setPushError(null)

    try {
      await appApi.pushGitChanges({ cwd: changesCwd })
      setPushState('idle')
      setGitChangeLoadRequest((currentRequest) => currentRequest + 1)
    } catch (error) {
      setPushState('error')
      setPushError(getErrorMessage(error, 'Unable to push changes.'))
    }
  }

  return (
    <main className={`chat${chatPanelOpen ? ' chat--has-selection' : ' chat--no-selection'}`}>
      <div className="chat__panels" ref={panelsRef} style={panelsStyle}>
        <div className="chat__sidebar-panel" data-panel="true" id="sidebar">
          <aside className="chat-sidebar" aria-label="Recent conversations">
            <header
              className={`chat-home__header${searchOpen ? ' chat-home__header--searching' : ''}`}
            >
              {searchOpen ? (
                <>
                  <label className="sr-only" htmlFor="chat-search">
                    Search conversations
                  </label>
                  <div className="chat-home__search-field">
                    <input
                      ref={searchInputRef}
                      id="chat-search"
                      type="search"
                      value={searchQuery}
                      placeholder="Search conversations"
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') handleCloseSearch()
                      }}
                    />
                  </div>
                  <Button
                    theme="secondary"
                    aria-label="Close search"
                    aria-controls="chat-search"
                    title="Close search"
                    callback={handleCloseSearch}
                    icon={<X aria-hidden="true" />}
                  />
                </>
              ) : (
                <div className="chat-home__actions">
                  <Button
                    theme="secondary"
                    aria-label="New chat"
                    title="New chat"
                    callback={handleNewChat}
                    icon={<SquarePen aria-hidden="true" />}
                  />
                  <Button
                    theme="secondary"
                    aria-label="Search conversations"
                    aria-expanded={false}
                    title="Search conversations"
                    callback={() => setSearchOpen(true)}
                    icon={<Search aria-hidden="true" />}
                  />
                </div>
              )}
            </header>
            <div className="chat-sidebar__body" ref={sidebarBodyRef}>
              {loadState === 'loading' && <p className="chat__status">Loading chats…</p>}
              {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
              {loadState === 'ready' && chats.length === 0 && (
                <p className="chat__status">No chats found.</p>
              )}
              {loadState === 'ready' && chats.length > 0 && filteredChats.length === 0 && (
                <p className="chat__status">No matching chats.</p>
              )}
              {filteredChats.length > 0 && (
                <div className="chat-list-stack">
                  {pinnedChatGroup && renderChatGroup(pinnedChatGroup, 'pinned-chats-list')}
                  {activeChatGroups.map((group, groupIndex) =>
                    renderChatGroup(group, `cwd-chats-list-${groupIndex}`)
                  )}
                  {hasMoreChats && chatPageLoadState !== 'error' && (
                    <div className="chat-list-section__sentinel" ref={chatLoadTriggerRef}>
                      <span className="sr-only">Load more chats</span>
                    </div>
                  )}
                  {chatPageLoadState === 'error' && (
                    <Button
                      theme="secondary"
                      fill
                      callback={() => void loadMoreChats()}
                      label="Retry loading chats"
                    />
                  )}
                  {doneChatGroup && renderChatGroup(doneChatGroup, 'cwd-chats-list-done')}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div
          className="chat__resize-handle"
          ref={resizeHandleRef}
          id="chat-sidebar-resize"
          role="separator"
          aria-label="Resize chat from left"
          aria-orientation="vertical"
          onFocus={(event) => event.currentTarget.blur()}
          onPointerDown={(event) => handleStartChatResize('left', event)}
          onPointerUp={(event) => event.currentTarget.blur()}
        />

        <div className="chat__detail-panel" data-panel="true" id="detail">
          <section
            className={`chat-panel${selectedChat ? ' chat-panel--selected' : ' chat-panel--empty'}${newChatOpen ? ' chat-panel--new' : ''}`}
            aria-label={selectedChat?.title ?? 'No chat selected'}
          >
            {selectedChat && (
              <>
                <header className="chat-detail__header">
                  <div className="chat-detail__header-inner">
                    <span className="chat-detail__back-slot">
                      <Button
                        theme="transparent"
                        aria-label="Back"
                        title="Back"
                        callback={handleBack}
                        icon={<ArrowLeft aria-hidden="true" />}
                      />
                    </span>
                    <h1>{selectedChat.title}</h1>
                  </div>
                </header>
                <div className="chat-detail__messages" ref={contentRef}>
                  <div className="chat-detail__messages-inner">
                    {chatLoadState === 'loading' && (
                      <p className="chat__status">Loading messages…</p>
                    )}
                    {chatLoadState === 'error' && (
                      <p className="chat__status">Unable to load messages.</p>
                    )}
                    {!editingMessage &&
                      chatLoadState === 'ready' &&
                      visibleChatItems.length === 0 && (
                        <p className="chat__status">No messages found.</p>
                      )}
                    {visibleChatItems.map((item) => (
                      <ChatDetailItem
                        canEditOwnMessages={canEditOwnMessages}
                        item={item}
                        key={item.id}
                        onEditMessage={handleEditMessage}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
            {!selectedChat && newChatOpen && (
              <header className="chat-detail__header chat-detail__new-header">
                <div className="chat-detail__header-inner">
                  <span className="chat-detail__back-slot">
                    <Button
                      theme="transparent"
                      aria-label="Back"
                      title="Back"
                      callback={handleBack}
                      icon={<ArrowLeft aria-hidden="true" />}
                    />
                  </span>
                  <h1>New chat</h1>
                </div>
              </header>
            )}
            <div className="chat-panel__composer">
              <div className="chat-panel__composer-inner">
                {!selectedChat && newChatOpen && (
                  <div className="chat-panel__new-session">
                    <span>New session in</span>
                    <Dropdown
                      aria-label="Project"
                      appearance="inline"
                      title={newSessionCwd ?? 'Choose folder'}
                      disabled={sendState === 'sending'}
                      menuActions={[
                        {
                          id: 'add-project',
                          label: 'Add project..',
                          title: 'Add project..',
                          icon: <FolderPlus aria-hidden="true" />,
                          callback: () => void handleSelectNewSessionFolder()
                        }
                      ]}
                      options={projectOptions}
                      placement="top"
                      size="small"
                      value={newSessionProjectValue}
                      onChange={(cwd) => setNewSessionCwd(cwd)}
                    />
                    <span>with</span>
                    <Dropdown
                      aria-label="Provider"
                      appearance="inline"
                      disabled={sendState === 'sending'}
                      options={providerOptions}
                      placement="top"
                      size="small"
                      value={newSessionProvider}
                      onChange={setNewSessionProvider}
                    />
                  </div>
                )}
                {selectedChat && pendingApproval && (
                  <section className="chat-approval" aria-label="Approval request">
                    <div className="chat-approval__main">
                      <span className="chat-approval__label">
                        {approvalTypeLabels[pendingApproval.type]}
                      </span>
                      <span
                        className="chat-approval__summary"
                        title={getApprovalSummary(pendingApproval)}
                      >
                        {getApprovalSummary(pendingApproval)}
                      </span>
                      {pendingApproval.cwd && pendingApproval.command && (
                        <span className="chat-approval__cwd" title={pendingApproval.cwd}>
                          {pendingApproval.cwd}
                        </span>
                      )}
                      {approvalError && (
                        <span className="chat-approval__error" role="status">
                          {approvalError}
                        </span>
                      )}
                    </div>
                    <div className="chat-approval__actions">
                      <Button
                        disabled={Boolean(approvalDecisionInFlight)}
                        callback={() => void handleResolveApproval('deny')}
                        icon={<X aria-hidden="true" />}
                        label={<span>Deny</span>}
                        theme="secondary"
                      />
                      <Button
                        disabled={Boolean(approvalDecisionInFlight)}
                        callback={() => void handleResolveApproval('allow')}
                        icon={<Check aria-hidden="true" />}
                        label={<span>Allow</span>}
                        theme="primary"
                      />
                    </div>
                  </section>
                )}
                <MessageBox
                  active={editingMessage ? false : chatHasActiveTurn}
                  accessMode={accessMode}
                  accessModes={accessModes}
                  autoFocus={!selectedChat && newChatOpen}
                  disabled={messageBoxDisabled}
                  editSession={editingMessage}
                  error={sendState === 'error' ? 'Unable to complete request.' : null}
                  model={model}
                  models={models}
                  pending={sendState === 'sending'}
                  reasoningEffort={reasoningEffort}
                  onAccessModeChange={handleAccessModeChange}
                  onCancelEdit={handleCancelEditMessage}
                  onModelChange={handleModelChange}
                  onReasoningEffortChange={handleReasoningEffortChange}
                  onStop={handleStopChat}
                  onSend={handleSendMessage}
                />
              </div>
            </div>
          </section>
        </div>

        <div
          className="chat__resize-handle chat__resize-handle--changes"
          ref={changesResizeHandleRef}
          id="chat-changes-resize"
          role="separator"
          aria-label="Resize chat from right"
          aria-orientation="vertical"
          onFocus={(event) => event.currentTarget.blur()}
          onPointerDown={(event) => handleStartChatResize('right', event)}
          onPointerUp={(event) => event.currentTarget.blur()}
        />

        <div className="chat__changes-panel" data-panel="true" id="changes">
          <aside className="changes-sidebar" aria-label="Changed files">
            <header className="changes-sidebar__header">
              <div className="changes-sidebar__title-row">
                <GitBranch aria-hidden="true" />
                <h2>Changes</h2>
              </div>
              <label className="sr-only" htmlFor="changes-source">
                Change source
              </label>
              <Dropdown
                id="changes-source"
                fill
                options={changeSourceOptions}
                size="large"
                value={changeSource}
                onChange={setChangeSource}
              />
              <div className="changes-sidebar__meta" title={changesContextLabel}>
                <span>{changesContextLabel}</span>
                {changeSource !== 'lastTurn' && (
                  <Button
                    theme="transparent"
                    size="small"
                    aria-label="Refresh changes"
                    title="Refresh changes"
                    disabled={!changesCwd || changesLoadState === 'loading'}
                    callback={() => setGitChangeLoadRequest((currentRequest) => currentRequest + 1)}
                    icon={<GitRefreshIcon active={changesLoadState === 'loading'} />}
                  />
                )}
              </div>
            </header>
            <div className="changes-sidebar__body">
              {visibleChangesLoadState === 'loading' && (
                <p className="changes-sidebar__status">Loading changes...</p>
              )}
              {visibleChangesLoadState === 'error' && (
                <p className="changes-sidebar__status">Unable to load changes.</p>
              )}
              {visibleChangesLoadState === 'ready' && changedFiles.length === 0 && (
                <p className="changes-sidebar__status">{changesEmptyMessage}</p>
              )}
              {visibleChangesLoadState === 'ready' && changedFiles.length > 0 && (
                <ul className="changes-sidebar__files">
                  {changedFiles.map((file) => renderChangedFile(file))}
                </ul>
              )}
            </div>
            <footer className="changes-sidebar__footer">
              {commitMode === 'manual' && (
                <label className="changes-sidebar__commit-message">
                  <span className="sr-only">Commit message</span>
                  <input
                    type="text"
                    value={manualCommitMessage}
                    placeholder="Commit message"
                    disabled={!canCommitChangeSource}
                    title={commitUnavailableTitle}
                    onChange={(event) => {
                      setCommitState('idle')
                      setCommitError(null)
                      setManualCommitMessage(event.target.value)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !commitDisabled) {
                        void handleCommitChangedFiles()
                      }
                    }}
                  />
                </label>
              )}
              <div className="changes-sidebar__commit-row">
                <Button
                  disabled={commitDisabled}
                  title={commitUnavailableTitle}
                  callback={() => void handleCommitChangedFiles('commit')}
                  dropdownActions={[
                    {
                      id: 'amend',
                      label: commitActionLabels.amend,
                      disabled: getCommitActionDisabled('amend'),
                      title: commitUnavailableTitle,
                      callback: () => void handleCommitChangedFiles('amend')
                    },
                    {
                      id: 'commitAndPush',
                      label: commitActionLabels.commitAndPush,
                      disabled: getCommitActionDisabled('commitAndPush'),
                      title: commitUnavailableTitle,
                      callback: () => void handleCommitChangedFiles('commitAndPush')
                    }
                  ]}
                  dropdownLabel="Commit actions"
                  dropdownMenuAlign="end"
                  dropdownPlacement="top"
                  icon={<GitCommitHorizontal aria-hidden="true" />}
                  label={<span>{commitActionLabels.commit}</span>}
                  theme="primary"
                  fill
                />
                <Button
                  aria-label={
                    commitMode === 'manual' ? 'Use AI commit flow' : 'Write commit message'
                  }
                  title={
                    commitUnavailableTitle ??
                    (commitMode === 'manual' ? 'Use AI commit flow' : 'Write commit message')
                  }
                  disabled={!canCommitChangeSource}
                  callback={handleCommitModeToggle}
                  icon={
                    commitMode === 'manual' ? (
                      <Sparkles aria-hidden="true" />
                    ) : (
                      <Pencil aria-hidden="true" />
                    )
                  }
                  theme="secondary"
                />
              </div>
              {hasUnpushedChanges && (
                <Button
                  title={`${unpushedCount} unpushed commit${unpushedCount === 1 ? '' : 's'}`}
                  disabled={pushDisabled}
                  callback={() => void handlePushChanges()}
                  icon={<Upload aria-hidden="true" />}
                  label={<span>{pushState === 'sending' ? 'Pushing' : 'Push'}</span>}
                  theme="secondary"
                  fill
                />
              )}
              {commitState === 'error' && (
                <p className="changes-sidebar__commit-error" role="status">
                  {commitError ?? 'Unable to commit these files.'}
                </p>
              )}
              {pushState === 'error' && (
                <p className="changes-sidebar__commit-error" role="status">
                  {pushError ?? 'Unable to push changes.'}
                </p>
              )}
            </footer>
          </aside>
        </div>
      </div>
    </main>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  FilePlus2,
  GitBranch,
  GitCommitHorizontal,
  History,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
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
  ProviderApprovalDecision,
  ProviderId,
  ProviderModelId,
  ProviderReasoningEffort
} from '../../shared/provider'
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
type CommitMode = 'agent' | 'manual'
type ChangedFile = {
  path: string
  previousPath?: string | null
  kind: AppGitChangeKind
  status?: string
  diff?: string
}

const chatPageSize = 20
const pinnedGroupKey = 'pinned'
const unknownCwdGroupKey = 'cwd:unknown'
const doneGroupKey = 'done'

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

const getDropdownOptions = <TValue extends string>(
  labels: Record<TValue, string>
): DropdownOption<TValue>[] =>
  Object.entries(labels).map(([value, label]) => ({
    value: value as TValue,
    label: label as string
  }))

const providerOptions = getDropdownOptions(providerLabels)
const changeSourceOptions = getDropdownOptions(changeSourceLabels)
const commitActionOptions = getDropdownOptions(commitActionLabels)

const approvalTypeLabels = {
  command: 'Command approval',
  fileChange: 'File change approval'
} as const

const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

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

  return Array.from(chatsById.values()).sort((firstChat, secondChat) => {
    if (secondChat.updatedAt !== firstChat.updatedAt) {
      return secondChat.updatedAt - firstChat.updatedAt
    }

    return secondChat.createdAt - firstChat.createdAt
  })
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

const getChatCwdLabel = (cwd: string | null): string =>
  cwd?.trim() ? getLastPathPart(cwd.trim()) : 'Unknown cwd'

const getChatCwdGroupKey = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? `cwd:${normalizedCwd}` : unknownCwdGroupKey
}

const getDefaultCollapsedGroupState = (groupKey: string): boolean => groupKey === doneGroupKey

const getCollapsedGroupState = (
  groupKey: string,
  collapsedGroups: Record<string, boolean>
): boolean => collapsedGroups[groupKey] ?? getDefaultCollapsedGroupState(groupKey)

const sortChatsForGroup = (chats: ProviderChat[]): ProviderChat[] =>
  [...chats].sort((firstChat, secondChat) => {
    if (secondChat.updatedAt !== firstChat.updatedAt) {
      return secondChat.updatedAt - firstChat.updatedAt
    }

    return secondChat.createdAt - firstChat.createdAt
  })

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

    const key = getChatCwdGroupKey(chat.cwd)
    const existingGroup = groupsByCwd.get(key)

    if (existingGroup) {
      existingGroup.chats.push(chat)
      continue
    }

    const cwd = chat.cwd?.trim() || null
    groupsByCwd.set(key, {
      key,
      cwd,
      label: getChatCwdLabel(cwd),
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
  createdAt: existingChat?.createdAt ?? updatedAt,
  updatedAt,
  status: detail.status,
  pinned: detail.pinned ?? existingChat?.pinned ?? false,
  done: detail.done ?? existingChat?.done ?? false
})

const getOptimisticItems = (items: ProviderChatItem[], message: string): ProviderChatItem[] => {
  const id = `optimistic:${Date.now()}`

  return [
    ...items,
    {
      type: 'message',
      id: `${id}:user`,
      role: 'user',
      content: message
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
  const [accessMode, setAccessMode] = useState<ProviderAccessMode>('sandbox')
  const [model, setModel] = useState<ProviderModelId>('gpt-5.5')
  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>('xhigh')
  const [approvalResolution, setApprovalResolution] = useState<ApprovalResolutionState>({
    approvalId: null,
    decision: null,
    error: null
  })
  const [newChatOpen, setNewChatOpen] = useState(true)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedCwdGroups, setCollapsedCwdGroups] = useState<Record<string, boolean>>({})
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [chatPageLoadState, setChatPageLoadState] = useState<IncrementalLoadState>('ready')
  const [changeSource, setChangeSource] = useState<ChangeSource>('branch')
  const [gitChanges, setGitChanges] = useState<AppGitChangesResult | null>(null)
  const [gitChangeLoadState, setGitChangeLoadState] = useState<LoadState>('ready')
  const [gitChangeLoadRequest, setGitChangeLoadRequest] = useState(0)
  const [commitMode, setCommitMode] = useState<CommitMode>('agent')
  const [commitAction, setCommitAction] = useState<AppGitCommitAction>('commit')
  const [manualCommitMessage, setManualCommitMessage] = useState('')
  const [commitState, setCommitState] = useState<SendState>('idle')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [pushState, setPushState] = useState<SendState>('idle')
  const [pushError, setPushError] = useState<string | null>(null)
  const sidebarBodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const chatLoadTriggerRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const changesResizeHandleRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sendInFlightRef = useRef(false)

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
    const gitChangeSource = changeSource === 'lastTurn' ? 'uncommitted' : changeSource

    if (changeSource !== 'lastTurn') {
      queueMicrotask(() => {
        if (active) setGitChangeLoadState('loading')
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
        if (changeSource !== 'lastTurn') setGitChangeLoadState('ready')
      })
      .catch(() => {
        if (!active) return
        setGitChanges(null)
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
      const metadataGroups = await Promise.all(
        providerIds.map((providerId) => providerApi.markCwdChatsDone(providerId, group.cwd))
      )
      applyChatMetadata(metadataGroups.flat())

      if (
        selectedChat &&
        !selectedChat.done &&
        getChatCwdGroupKey(selectedChat.cwd) === getChatCwdGroupKey(group.cwd)
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
  const gitChangedFiles = useMemo(
    () => (changesCwd ? getGitChangedFiles(gitChanges) : []),
    [changesCwd, gitChanges]
  )
  const changedFiles = changeSource === 'lastTurn' ? lastTurnChangedFiles : gitChangedFiles
  const changesLoadState = changeSource === 'lastTurn' || !changesCwd ? 'ready' : gitChangeLoadState
  const unpushedCount = gitChanges?.unpushedCount ?? 0
  const hasUnpushedChanges = unpushedCount > 0
  const manualCommitMessageValue = manualCommitMessage.trim()
  const commitFiles = useMemo(() => getCommitFiles(changedFiles), [changedFiles])
  const manualCommitNeedsMessage = commitMode === 'manual' && commitAction !== 'amend'
  const commitDisabled =
    changedFiles.length === 0 ||
    commitFiles.length === 0 ||
    changesLoadState !== 'ready' ||
    commitState === 'sending' ||
    pushState === 'sending' ||
    (commitMode === 'manual'
      ? !changesCwd || (manualCommitNeedsMessage && !manualCommitMessageValue)
      : sendState === 'sending' ||
        Boolean(editingMessage) ||
        (selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false))
  const pushDisabled = !changesCwd || pushState === 'sending' || commitState === 'sending'
  const changesEmptyMessage = getChangesEmptyMessage(changeSource, changesCwd, gitChanges)
  const changesContextLabel =
    changeSource === 'branch' && gitChanges?.branchName
      ? gitChanges.baseRef
        ? `${gitChanges.branchName} from ${gitChanges.baseRef}`
        : gitChanges.branchName
      : changesCwd
        ? getFolderName(changesCwd)
        : 'No folder'

  const renderChangedFile = (file: ChangedFile): React.ReactElement => (
    <li className={`changes-sidebar__file changes-sidebar__file--${file.kind}`} key={file.path}>
      <span className="changes-sidebar__file-icon">
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
      {file.kind === 'edit' ? (
        <span
          className="changes-sidebar__file-kind-icon"
          aria-label={changeKindLabels[file.kind]}
          title={changeKindLabels[file.kind]}
        >
          <ChangeKindIcon kind={file.kind} />
        </span>
      ) : (
        <span className="changes-sidebar__file-kind">{changeKindLabels[file.kind]}</span>
      )}
    </li>
  )

  const handleCommitModeToggle = (): void => {
    setCommitState('idle')
    setCommitError(null)
    setCommitMode((currentMode) => (currentMode === 'manual' ? 'agent' : 'manual'))
  }

  const handleCommitActionChange = (action: AppGitCommitAction): void => {
    setCommitAction(action)
    setCommitState('idle')
    setCommitError(null)
  }

  const handleCommitChangedFiles = async (): Promise<void> => {
    if (commitDisabled) return

    if (commitMode === 'manual') {
      if (!changesCwd) return

      setCommitState('sending')
      setCommitError(null)

      try {
        await appApi.commitGitChanges({
          cwd: changesCwd,
          action: commitAction,
          files: commitFiles,
          message: commitAction === 'amend' ? null : manualCommitMessageValue
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

    await handleSendMessage(getCommitMessage(changedFiles, commitAction))
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
      <Group className="chat__panels" orientation="horizontal">
        <Panel
          className="chat__sidebar-panel"
          defaultSize={320}
          minSize={280}
          maxSize={560}
          groupResizeBehavior="preserve-pixel-size"
          id="sidebar"
        >
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
        </Panel>

        <Separator
          className="chat__resize-handle"
          elementRef={resizeHandleRef}
          id="chat-sidebar-resize"
          onFocus={(event) => event.currentTarget.blur()}
          onPointerDown={(event) => event.currentTarget.blur()}
          onPointerUp={(event) => event.currentTarget.blur()}
        />

        <Panel className="chat__detail-panel" minSize={0} id="detail">
          <section
            className={`chat-panel${selectedChat ? ' chat-panel--selected' : ' chat-panel--empty'}${newChatOpen ? ' chat-panel--new' : ''}`}
            aria-label={selectedChat?.title ?? 'No chat selected'}
          >
            {selectedChat && (
              <>
                <header className="chat-detail__header">
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
                </header>
                <div className="chat-detail__messages" ref={contentRef}>
                  {chatLoadState === 'loading' && <p className="chat__status">Loading messages…</p>}
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
              </>
            )}
            {!selectedChat && newChatOpen && (
              <header className="chat-detail__header chat-detail__new-header">
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
              </header>
            )}
            <div className="chat-panel__composer">
              {!selectedChat && newChatOpen && (
                <div className="chat-panel__new-session">
                  <span>New session in</span>
                  <Button
                    title={newSessionCwd ?? 'Choose folder'}
                    disabled={sendState === 'sending'}
                    callback={() => void handleSelectNewSessionFolder()}
                    label={getFolderName(newSessionCwd)}
                    theme="transparent"
                    size="small"
                  />
                  <span>with</span>
                  <Dropdown
                    className="chat-panel__new-session-select"
                    aria-label="Provider"
                    disabled={sendState === 'sending'}
                    options={providerOptions}
                    placement="top"
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
                autoFocus={!selectedChat && newChatOpen}
                disabled={messageBoxDisabled}
                editSession={editingMessage}
                error={sendState === 'error' ? 'Unable to complete request.' : null}
                model={model}
                pending={sendState === 'sending'}
                reasoningEffort={reasoningEffort}
                onAccessModeChange={setAccessMode}
                onCancelEdit={handleCancelEditMessage}
                onModelChange={setModel}
                onReasoningEffortChange={setReasoningEffort}
                onStop={handleStopChat}
                onSend={handleSendMessage}
              />
            </div>
          </section>
        </Panel>

        <Separator
          className="chat__resize-handle chat__resize-handle--changes"
          elementRef={changesResizeHandleRef}
          id="chat-changes-resize"
          onFocus={(event) => event.currentTarget.blur()}
          onPointerDown={(event) => event.currentTarget.blur()}
          onPointerUp={(event) => event.currentTarget.blur()}
        />

        <Panel
          className="chat__changes-panel"
          defaultSize={300}
          minSize={240}
          maxSize={420}
          groupResizeBehavior="preserve-pixel-size"
          id="changes"
        >
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
                className="changes-sidebar__select"
                id="changes-source"
                options={changeSourceOptions}
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
                    icon={<RefreshCw aria-hidden="true" />}
                  />
                )}
              </div>
            </header>
            <div className="changes-sidebar__body">
              {changesLoadState === 'loading' && (
                <p className="changes-sidebar__status">Loading changes...</p>
              )}
              {changesLoadState === 'error' && (
                <p className="changes-sidebar__status">Unable to load changes.</p>
              )}
              {changesLoadState === 'ready' && changedFiles.length === 0 && (
                <p className="changes-sidebar__status">{changesEmptyMessage}</p>
              )}
              {changesLoadState === 'ready' && changedFiles.length > 0 && (
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
                    disabled={commitAction === 'amend'}
                    value={manualCommitMessage}
                    placeholder={
                      commitAction === 'amend' ? 'Uses last commit message' : 'Commit message'
                    }
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
                <div className="changes-sidebar__commit-control">
                  <Button
                    disabled={commitDisabled}
                    callback={() => void handleCommitChangedFiles()}
                    icon={<GitCommitHorizontal aria-hidden="true" />}
                    label={<span>{commitActionLabels[commitAction]}</span>}
                    theme="primary"
                    fill
                  />
                  <label className="sr-only" htmlFor="changes-commit-action">
                    Commit action
                  </label>
                  <Dropdown
                    className="changes-sidebar__commit-action"
                    id="changes-commit-action"
                    options={commitActionOptions}
                    placement="top"
                    title={commitActionLabels[commitAction]}
                    value={commitAction}
                    onChange={handleCommitActionChange}
                  />
                </div>
                <Button
                  aria-label={
                    commitMode === 'manual' ? 'Use AI commit flow' : 'Write commit message'
                  }
                  title={commitMode === 'manual' ? 'Use AI commit flow' : 'Write commit message'}
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
        </Panel>
      </Group>
    </main>
  )
}

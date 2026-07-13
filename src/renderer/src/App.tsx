import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCheck, ChevronRight, Search, SquarePen, X } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatItem,
  ProviderChatMetadata,
  ProviderMessage,
  ProviderAccessMode,
  ProviderId,
  ProviderModelId,
  ProviderReasoningEffort
} from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { ChatList } from './components/ChatList'
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

const chatPageSize = 20
const unknownCwdGroupKey = 'cwd:unknown'
const doneGroupKey = 'done'

const providerLabels = {
  codex: 'Codex'
} satisfies Record<ProviderId, string>

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

type ChatCwdGroup = {
  key: string
  cwd: string | null
  label: string
  chats: ProviderChat[]
  kind: 'cwd' | 'done'
}

const sortChatsForGroup = (chats: ProviderChat[]): ProviderChat[] =>
  [...chats].sort((firstChat, secondChat) => {
    if (firstChat.pinned !== secondChat.pinned) return firstChat.pinned ? -1 : 1

    if (secondChat.updatedAt !== firstChat.updatedAt) {
      return secondChat.updatedAt - firstChat.updatedAt
    }

    return secondChat.createdAt - firstChat.createdAt
  })

const groupChatsByCwd = (chats: ProviderChat[]): ChatCwdGroup[] => {
  const groupsByCwd = new Map<string, ChatCwdGroup>()
  const doneChats: ProviderChat[] = []

  for (const chat of chats) {
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

  if (doneChats.length === 0) return cwdGroups

  return [
    ...cwdGroups,
    {
      key: doneGroupKey,
      cwd: null,
      label: 'Done',
      chats: sortChatsForGroup(doneChats),
      kind: 'done' as const
    }
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
  const [newChatOpen, setNewChatOpen] = useState(true)
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null)
  const [newSessionProvider, setNewSessionProvider] = useState<ProviderId>('codex')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedCwdGroups, setCollapsedCwdGroups] = useState<Record<string, boolean>>({})
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [chatPageLoadState, setChatPageLoadState] = useState<IncrementalLoadState>('ready')
  const sidebarBodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const chatLoadTriggerRef = useRef<HTMLDivElement>(null)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (!selectedProviderId || !selectedChatId) return

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
  }, [chatLoadRequest, selectedProviderId, selectedChatId])

  useEffect(() => {
    const resizeHandle = resizeHandleRef.current
    if (!resizeHandle) return

    const removeTabStop = (): void => {
      resizeHandle.removeAttribute('tabindex')
      if (document.activeElement === resizeHandle) resizeHandle.blur()
    }

    removeTabStop()

    const observer = new MutationObserver(removeTabStop)
    observer.observe(resizeHandle, {
      attributeFilter: ['tabindex'],
      attributes: true
    })

    return () => observer.disconnect()
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
  const chatGroups = groupChatsByCwd(filteredChats)
  const activeChatGroups = chatGroups.filter((group) => group.kind !== 'done')
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

  const handleMarkCwdChatsDone = async (group: ChatCwdGroup): Promise<void> => {
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

  const renderChatGroup = (group: ChatCwdGroup, contentId: string): React.ReactElement => {
    const groupOpen =
      searchTerms.length > 0 || !getCollapsedGroupState(group.key, collapsedCwdGroups)

    return (
      <section
        className={`chat-list-section chat-list-section--cwd${groupOpen ? ' chat-list-section--open' : ''}`}
        aria-label={`${group.label} chats`}
        key={group.key}
      >
        <div className="chat-list-section__header">
          <button
            className="chat-list-section__toggle"
            type="button"
            aria-controls={contentId}
            aria-expanded={groupOpen}
            title={group.cwd ?? group.label}
            onClick={() => handleToggleCwdGroup(group.key)}
          >
            <ChevronRight className="chat-list-section__chevron" aria-hidden="true" />
            <span className="chat-list-section__title">{group.label}</span>
          </button>
          {group.kind === 'cwd' && (
            <button
              className="chat-list-section__action"
              type="button"
              aria-label={`Mark all ${group.label} chats done`}
              title="Mark project chats done"
              onClick={() => void handleMarkCwdChatsDone(group)}
            >
              <CheckCheck aria-hidden="true" />
            </button>
          )}
        </div>
        {groupOpen && (
          <blockquote className="chat-list-section__quote" id={contentId}>
            <ChatList
              ariaLabel={`${group.label} chats`}
              chats={group.chats}
              onMarkDone={handleMarkChatDone}
              onSelect={handleSelectChat}
              onTogglePinned={handleToggleChatPinned}
            />
          </blockquote>
        )}
      </section>
    )
  }

  const chatIsWaiting =
    chatDetail?.status === 'waitingOnApproval' || chatDetail?.status === 'waitingOnUserInput'
  const chatIsBusy = chatIsWaiting || hasActiveWorkingStep(chatDetail)
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
                  <button
                    className="chat-home__icon-button"
                    type="button"
                    aria-label="Close search"
                    aria-controls="chat-search"
                    title="Close search"
                    onClick={handleCloseSearch}
                  >
                    <X aria-hidden="true" />
                  </button>
                </>
              ) : (
                <div className="chat-home__actions">
                  <button
                    className="chat-home__icon-button"
                    type="button"
                    aria-label="New chat"
                    title="New chat"
                    onClick={handleNewChat}
                  >
                    <SquarePen aria-hidden="true" />
                  </button>
                  <button
                    className="chat-home__icon-button"
                    type="button"
                    aria-label="Search conversations"
                    aria-expanded={false}
                    title="Search conversations"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search aria-hidden="true" />
                  </button>
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
                  {activeChatGroups.map((group, groupIndex) =>
                    renderChatGroup(group, `cwd-chats-list-${groupIndex}`)
                  )}
                  {hasMoreChats && chatPageLoadState !== 'error' && (
                    <div className="chat-list-section__sentinel" ref={chatLoadTriggerRef}>
                      {chatPageLoadState === 'loading' ? (
                        'Loading more chats...'
                      ) : (
                        <span className="sr-only">Load more chats</span>
                      )}
                    </div>
                  )}
                  {chatPageLoadState === 'error' && (
                    <button
                      className="chat-list-section__retry"
                      type="button"
                      onClick={() => void loadMoreChats()}
                    >
                      Retry loading chats
                    </button>
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
                  <button
                    className="chat-detail__back"
                    type="button"
                    aria-label="Back"
                    title="Back"
                    onClick={handleBack}
                  >
                    <ArrowLeft aria-hidden="true" />
                  </button>
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
                <button
                  className="chat-detail__back"
                  type="button"
                  aria-label="Back"
                  title="Back"
                  onClick={handleBack}
                >
                  <ArrowLeft aria-hidden="true" />
                </button>
                <h1>New chat</h1>
              </header>
            )}
            <div className="chat-panel__composer">
              {!selectedChat && newChatOpen && (
                <div className="chat-panel__new-session">
                  <span>New session in</span>
                  <button
                    className="chat-panel__new-session-button"
                    type="button"
                    title={newSessionCwd ?? 'Choose folder'}
                    disabled={sendState === 'sending'}
                    onClick={() => void handleSelectNewSessionFolder()}
                  >
                    {getFolderName(newSessionCwd)}
                  </button>
                  <span>with</span>
                  <select
                    className="chat-panel__new-session-select"
                    aria-label="Provider"
                    disabled={sendState === 'sending'}
                    value={newSessionProvider}
                    onChange={(event) => setNewSessionProvider(event.target.value as ProviderId)}
                  >
                    {Object.entries(providerLabels).map(([providerId, label]) => (
                      <option key={providerId} value={providerId}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <MessageBox
                active={editingMessage ? false : chatIsBusy}
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
      </Group>
    </main>
  )
}

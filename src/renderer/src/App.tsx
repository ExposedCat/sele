import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Search, SquarePen, X } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatItem,
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

const chatPageSize = 20
const unknownCwdGroupKey = 'cwd:unknown'

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

type ChatCwdGroup = {
  key: string
  cwd: string | null
  label: string
  chats: ProviderChat[]
}

const groupChatsByCwd = (chats: ProviderChat[]): ChatCwdGroup[] => {
  const groupsByCwd = new Map<string, ChatCwdGroup>()

  for (const chat of chats) {
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
      chats: [chat]
    })
  }

  return Array.from(groupsByCwd.values())
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
  status: detail.status
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

export const App: React.FC = () => {
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('loading')
  const [sendState, setSendState] = useState<SendState>('idle')
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
  }, [selectedProviderId, selectedChatId])

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
      [groupKey]: !currentGroups[groupKey]
    }))
  }

  const handleSelectChat = (chat: ProviderChat): void => {
    setChatDetail(null)
    setChatLoadState('loading')
    setSendState('idle')
    setNewChatOpen(false)
    setSearchOpen(false)
    setSearchQuery('')
    setSelectedChat(chat)
  }

  const handleBack = (): void => {
    setSelectedChat(null)
    setChatDetail(null)
    setNewChatOpen(false)
    setSendState('idle')
  }

  const handleNewChat = (): void => {
    setSelectedChat(null)
    setChatDetail(null)
    setChatLoadState('ready')
    setSendState('idle')
    setSearchOpen(false)
    setSearchQuery('')
    setNewChatOpen(true)
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

  const handleSendMessage = async (message: string): Promise<void> => {
    if (sendInFlightRef.current) return
    sendInFlightRef.current = true
    const turnOptions = { accessMode, model, reasoningEffort }

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

  const chatIsBusy =
    chatDetail?.status === 'active' ||
    chatDetail?.status === 'waitingOnApproval' ||
    chatDetail?.status === 'waitingOnUserInput'
  const messageBoxDisabled = selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false
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
                  {chatGroups.map((group, groupIndex) => {
                    const groupOpen = searchTerms.length > 0 || !collapsedCwdGroups[group.key]
                    const contentId = `cwd-chats-list-${groupIndex}`

                    return (
                      <section
                        className={`chat-list-section chat-list-section--cwd${groupOpen ? ' chat-list-section--open' : ''}`}
                        aria-label={`${group.label} chats`}
                        key={group.key}
                      >
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
                        {groupOpen && (
                          <blockquote className="chat-list-section__quote" id={contentId}>
                            <ChatList
                              ariaLabel={`${group.label} chats`}
                              chats={group.chats}
                              onSelect={handleSelectChat}
                            />
                          </blockquote>
                        )}
                      </section>
                    )
                  })}
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
                </div>
              )}
            </div>
          </aside>
        </Panel>

        <Separator className="chat__resize-handle" id="chat-sidebar-resize" />

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
                  {chatLoadState === 'ready' && chatDetail?.items.length === 0 && (
                    <p className="chat__status">No messages found.</p>
                  )}
                  {chatDetail?.items.map((item) => (
                    <ChatDetailItem item={item} key={item.id} />
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
                active={chatIsBusy}
                accessMode={accessMode}
                disabled={messageBoxDisabled}
                error={sendState === 'error' ? 'Unable to complete request.' : null}
                model={model}
                pending={sendState === 'sending'}
                reasoningEffort={reasoningEffort}
                onAccessModeChange={setAccessMode}
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

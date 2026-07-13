import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatItem,
  ProviderId
} from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { ChatList } from './components/ChatList'
import { MessageBox } from './components/MessageBox'
import { providerApi } from './providerApi'
import './App.css'

type LoadState = 'loading' | 'ready' | 'error'
type SendState = 'idle' | 'sending' | 'error'
type ApplyChatDetailOptions = {
  select?: boolean
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sendInFlightRef = useRef(false)

  useEffect(() => {
    let active = true

    providerApi
      .getChats('codex')
      .then((nextChats) => {
        if (!active) return
        setChats((currentChats) => {
          if (currentChats.length === 0) return nextChats

          const nextChatIds = new Set(nextChats.map((chat) => `${chat.providerId}:${chat.id}`))
          const localChats = currentChats.filter(
            (chat) => !nextChatIds.has(`${chat.providerId}:${chat.id}`)
          )

          return [...localChats, ...nextChats]
        })
        setLoadState('ready')
      })
      .catch(() => {
        if (active) setLoadState('error')
      })

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

        if (!existingChat) return [nextChat, ...currentChats]

        return currentChats.map((chat) =>
          chat.providerId === providerId && chat.id === detail.id ? nextChat : chat
        )
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

  const searchTerms = searchQuery.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const filteredChats =
    searchTerms.length === 0
      ? chats
      : chats.filter((chat) => {
          const title = chat.title.toLocaleLowerCase()
          return searchTerms.every((term) => title.includes(term))
        })

  const handleSelectChat = (chat: ProviderChat): void => {
    setChatDetail(null)
    setChatLoadState('loading')
    setSendState('idle')
    setSelectedChat(chat)
  }

  const handleBack = (): void => {
    setSelectedChat(null)
    setChatDetail(null)
    setSendState('idle')
  }

  const handleSendMessage = async (message: string): Promise<void> => {
    if (sendInFlightRef.current) return
    sendInFlightRef.current = true

    if (!selectedChat) {
      setSendState('sending')

      try {
        const detail = await providerApi.startChat('codex', message)
        applyChatDetail('codex', detail, { select: true })
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
      const detail = await providerApi.continueChat(providerId, chatId, message)
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

  const chatIsBusy =
    chatDetail?.status === 'active' ||
    chatDetail?.status === 'waitingOnApproval' ||
    chatDetail?.status === 'waitingOnUserInput'
  const messageBoxDisabled = selectedChat ? chatLoadState !== 'ready' || chatIsBusy : false

  return (
    <main className={`chat${selectedChat ? ' chat--has-selection' : ' chat--no-selection'}`}>
      <aside className="chat-sidebar" aria-label="Recent conversations">
        <header className="chat-home__header">
          <div
            className={`chat-home__search${searchOpen ? ' chat-home__search--open' : ''}`}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return

              setSearchQuery('')
              setSearchOpen(false)
            }}
          >
            {searchOpen && (
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
                      if (event.key === 'Escape') {
                        setSearchQuery('')
                        setSearchOpen(false)
                      }
                    }}
                  />
                  {searchQuery && (
                    <button
                      className="chat-home__search-clear"
                      type="button"
                      aria-label="Clear search"
                      title="Clear search"
                      onClick={() => {
                        setSearchQuery('')
                        searchInputRef.current?.focus()
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                </div>
              </>
            )}
            <button
              className="chat-home__search-trigger"
              type="button"
              aria-label="Search conversations"
              aria-expanded={searchOpen}
              aria-controls={searchOpen ? 'chat-search' : undefined}
              title="Search conversations"
              onClick={() => {
                setSearchOpen(true)
                searchInputRef.current?.focus()
              }}
            >
              <Search aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="chat-sidebar__body">
          {loadState === 'loading' && <p className="chat__status">Loading chats…</p>}
          {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
          {loadState === 'ready' && chats.length === 0 && (
            <p className="chat__status">No chats found.</p>
          )}
          {loadState === 'ready' && chats.length > 0 && filteredChats.length === 0 && (
            <p className="chat__status">No matching chats.</p>
          )}
          {filteredChats.length > 0 && (
            <ChatList chats={filteredChats} onSelect={handleSelectChat} />
          )}
        </div>
      </aside>

      <section
        className={`chat-panel${selectedChat ? ' chat-panel--selected' : ' chat-panel--empty'}`}
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
        <div className="chat-panel__composer">
          <MessageBox
            disabled={messageBoxDisabled}
            error={sendState === 'error' ? 'Unable to send message.' : null}
            pending={sendState === 'sending'}
            onSend={handleSendMessage}
          />
        </div>
      </section>
    </main>
  )
}

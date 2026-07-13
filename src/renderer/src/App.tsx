import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import type { ProviderChat, ProviderChatDetail } from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { ChatList } from './components/ChatList'
import { MessageBox } from './components/MessageBox'
import { providerApi } from './providerApi'
import './App.css'

type LoadState = 'loading' | 'ready' | 'error'

export const App: React.FC = () => {
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('loading')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true

    providerApi
      .getChats('codex')
      .then((nextChats) => {
        if (!active) return
        setChats(nextChats)
        setLoadState('ready')
      })
      .catch(() => {
        if (active) setLoadState('error')
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedChat) return

    let active = true

    providerApi
      .getChat(selectedChat.providerId, selectedChat.id)
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
  }, [selectedChat])

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
    setSelectedChat(chat)
  }

  const handleBack = (): void => {
    setSelectedChat(null)
    setChatDetail(null)
  }

  return (
    <main className="chat">
      <div className="chat__content" ref={contentRef}>
        {selectedChat ? (
          <section className="chat-detail" aria-label={selectedChat.title}>
            <header className="chat-detail__header">
              <button type="button" aria-label="Back" title="Back" onClick={handleBack}>
                <ArrowLeft aria-hidden="true" />
              </button>
              <h1>{selectedChat.title}</h1>
            </header>
            <div className="chat-detail__messages">
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
          </section>
        ) : (
          <section className="chat-home" aria-label="Recent conversations">
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
          </section>
        )}
      </div>
      {selectedChat && <MessageBox />}
    </main>
  )
}

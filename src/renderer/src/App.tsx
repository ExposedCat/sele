import { useEffect, useRef, useState } from 'react'
import type { ProviderChat, ProviderChatDetail } from '../../shared/provider'
import { ChatDetailItem } from './components/ChatDetailItem'
import { ChatList } from './components/ChatList'
import { MessageBox } from './components/MessageBox'
import { providerApi } from './providerApi'

type LoadState = 'loading' | 'ready' | 'error'

export const App: React.FC = () => {
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
  const [chatDetail, setChatDetail] = useState<ProviderChatDetail | null>(null)
  const [chatLoadState, setChatLoadState] = useState<LoadState>('loading')
  const contentRef = useRef<HTMLDivElement>(null)

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
              <button type="button" onClick={handleBack}>
                <span aria-hidden="true">←</span> Back
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
          <>
            {loadState === 'loading' && <p className="chat__status">Loading chats…</p>}
            {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
            {loadState === 'ready' && chats.length === 0 && (
              <p className="chat__status">No chats found.</p>
            )}
            {chats.length > 0 && <ChatList chats={chats} onSelect={handleSelectChat} />}
          </>
        )}
      </div>
      {selectedChat && <MessageBox />}
    </main>
  )
}

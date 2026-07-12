import { useEffect, useRef, useState } from 'react'
import type { ProviderChat } from '../../shared/provider'
import { ChatList } from './components/ChatList'
import { MessageBox } from './components/MessageBox'
import { providerApi } from './providerApi'

type LoadState = 'loading' | 'ready' | 'error'

export const App: React.FC = () => {
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selectedChat, setSelectedChat] = useState<ProviderChat | null>(null)
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

    contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight })
  }, [selectedChat])

  return (
    <main className="chat">
      <div className="chat__content" ref={contentRef}>
        {selectedChat ? (
          <section className="chat-detail" aria-label={selectedChat.title}>
            <header className="chat-detail__header">
              <button type="button" onClick={() => setSelectedChat(null)}>
                <span aria-hidden="true">←</span> Back
              </button>
              <h1>{selectedChat.title}</h1>
            </header>
            <div className="chat-detail__messages">
              <p className="chat-detail__message">{selectedChat.preview}</p>
            </div>
          </section>
        ) : (
          <>
            {loadState === 'loading' && <p className="chat__status">Loading chats…</p>}
            {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
            {loadState === 'ready' && chats.length === 0 && (
              <p className="chat__status">No chats found.</p>
            )}
            {chats.length > 0 && <ChatList chats={chats} onSelect={setSelectedChat} />}
          </>
        )}
      </div>
      {selectedChat && <MessageBox />}
    </main>
  )
}

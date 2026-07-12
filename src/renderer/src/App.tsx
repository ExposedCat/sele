import { useEffect, useState } from 'react'
import type { ProviderChat } from '../../shared/provider'
import { ChatList } from './components/ChatList'
import { MessageBox } from './components/MessageBox'
import { providerApi } from './providerApi'

type LoadState = 'loading' | 'ready' | 'error'

export const App: React.FC = () => {
  const [chats, setChats] = useState<ProviderChat[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

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

  return (
    <main className="chat">
      <div className="chat__content">
        {loadState === 'loading' && <p className="chat__status">Loading chats…</p>}
        {loadState === 'error' && <p className="chat__status">Unable to load chats.</p>}
        {loadState === 'ready' && chats.length === 0 && (
          <p className="chat__status">No chats found.</p>
        )}
        {chats.length > 0 && <ChatList chats={chats} />}
      </div>
      <MessageBox />
    </main>
  )
}

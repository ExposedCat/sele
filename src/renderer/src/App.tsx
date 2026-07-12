import { useState } from 'react'
import MessageBox from './components/MessageBox'
import MessageList from './components/MessageList'
import { mockMessages } from './data/mockMessages'
import type { ChatMessage } from './types/chat'

const App: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages)

  const handleSend = (content: string): void => {
    setMessages((currentMessages) => [
      ...currentMessages,
      { id: crypto.randomUUID(), role: 'user', content }
    ])
  }

  return (
    <main className="chat">
      <MessageList messages={messages} />
      <MessageBox onSend={handleSend} />
    </main>
  )
}

export default App

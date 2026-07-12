import type { ChatMessage as ChatMessageData } from '../types/chat'
import ChatMessage from './ChatMessage'

type MessageListProps = {
  messages: ChatMessageData[]
}

const MessageList: React.FC<MessageListProps> = ({ messages }) => (
  <div className="message-list" aria-live="polite">
    {messages.map((message) => (
      <ChatMessage key={message.id} message={message} />
    ))}
  </div>
)

export default MessageList

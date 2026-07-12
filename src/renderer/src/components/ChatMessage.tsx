import type { ChatMessage as ChatMessageData } from '../types/chat'

type ChatMessageProps = {
  message: ChatMessageData
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => (
  <article className="chat-message" data-role={message.role}>
    <span className="chat-message__role">{message.role === 'assistant' ? 'Assistant' : 'You'}</span>
    <p>{message.content}</p>
  </article>
)

export default ChatMessage

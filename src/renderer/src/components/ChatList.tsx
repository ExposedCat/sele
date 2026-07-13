import type { ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import './ChatList.css'

type ChatListProps = {
  chats: ProviderChat[]
  onSelect: (chat: ProviderChat) => void
}

export const ChatList: React.FC<ChatListProps> = ({ chats, onSelect }) => (
  <section className="chat-list" aria-label="Chats">
    {chats.map((chat) => (
      <ChatListItem key={chat.id} chat={chat} onClick={() => onSelect(chat)} />
    ))}
  </section>
)

import type { ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import './ChatList.css'

type ChatListProps = {
  ariaLabel?: string
  chats: ProviderChat[]
  onSelect: (chat: ProviderChat) => void
}

export const ChatList: React.FC<ChatListProps> = ({ ariaLabel = 'Chats', chats, onSelect }) => (
  <section className="chat-list" aria-label={ariaLabel}>
    {chats.map((chat) => (
      <ChatListItem
        key={`${chat.providerId}:${chat.id}`}
        chat={chat}
        onClick={() => onSelect(chat)}
      />
    ))}
  </section>
)

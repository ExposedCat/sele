import type { ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import './ChatList.css'

type ChatListProps = {
  ariaLabel?: string
  chats: ProviderChat[]
  onMarkDone: (chat: ProviderChat) => void
  onSelect: (chat: ProviderChat) => void
  onTogglePinned: (chat: ProviderChat) => void
}

export const ChatList: React.FC<ChatListProps> = ({
  ariaLabel = 'Chats',
  chats,
  onMarkDone,
  onSelect,
  onTogglePinned
}) => (
  <section className="chat-list" aria-label={ariaLabel}>
    {chats.map((chat) => (
      <ChatListItem
        key={`${chat.providerId}:${chat.id}`}
        chat={chat}
        onMarkDone={() => onMarkDone(chat)}
        onClick={() => onSelect(chat)}
        onTogglePinned={() => onTogglePinned(chat)}
      />
    ))}
  </section>
)

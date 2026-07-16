import type { ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'
import './ChatList.css'

type ChatListProps = {
  ariaLabel?: string
  chats: ProviderChat[]
  selectedChatKey: string | null
  onMarkDone: (chat: ProviderChat) => void
  onSelect: (chat: ProviderChat) => void
  onTogglePinned: (chat: ProviderChat) => void
}

const getChatKey = (chat: Pick<ProviderChat, 'providerId' | 'id'>): string =>
  `${chat.providerId}:${chat.id}`

export const ChatList: React.FC<ChatListProps> = ({
  ariaLabel = 'Chats',
  chats,
  selectedChatKey,
  onMarkDone,
  onSelect,
  onTogglePinned
}) => (
  <section className="chat-list" aria-label={ariaLabel}>
    {chats.map((chat) => {
      const chatKey = getChatKey(chat)

      return (
        <ChatListItem
          key={chatKey}
          chat={chat}
          selected={chatKey === selectedChatKey}
          onMarkDone={() => onMarkDone(chat)}
          onClick={() => onSelect(chat)}
          onTogglePinned={() => onTogglePinned(chat)}
        />
      )
    })}
  </section>
)

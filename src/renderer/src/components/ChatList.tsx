import type { ProviderChat } from '../../../shared/provider'
import { ChatListItem } from './ChatListItem'

type ChatListProps = {
  chats: ProviderChat[]
}

export const ChatList: React.FC<ChatListProps> = ({ chats }) => (
  <section className="chat-list" aria-label="Chats">
    {chats.map((chat) => (
      <ChatListItem key={chat.id} chat={chat} />
    ))}
  </section>
)

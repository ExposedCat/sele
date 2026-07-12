import type { ProviderChat } from '../../../shared/provider'

type ChatListItemProps = {
  chat: ProviderChat
}

export const ChatListItem: React.FC<ChatListItemProps> = ({ chat }) => (
  <article className="chat-list-item">
    <div className="chat-list-item__header">
      <h2>{chat.title}</h2>
      <time dateTime={new Date(chat.updatedAt).toISOString()}>
        {new Date(chat.updatedAt).toLocaleDateString()}
      </time>
    </div>
    <p>{chat.preview}</p>
  </article>
)

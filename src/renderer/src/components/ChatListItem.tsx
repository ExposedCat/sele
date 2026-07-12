import type { ProviderChat } from '../../../shared/provider'

type ChatListItemProps = {
  chat: ProviderChat
}

const statusLabels = {
  error: 'Error',
  waitingOnApproval: 'Waiting for approval',
  waitingOnUserInput: 'Waiting for your input'
} as const

export const ChatListItem: React.FC<ChatListItemProps> = ({ chat }) => (
  <article className="chat-list-item">
    <div className="chat-list-item__header">
      <h2>{chat.title}</h2>
      <div className="chat-list-item__meta">
        <time dateTime={new Date(chat.updatedAt).toISOString()}>
          {new Date(chat.updatedAt).toLocaleDateString()}
        </time>
        {chat.status && (
          <span
            className={`chat-list-item__status chat-list-item__status--${chat.status}`}
            role="img"
            aria-label={statusLabels[chat.status]}
            title={statusLabels[chat.status]}
          />
        )}
      </div>
    </div>
    <p>{chat.preview}</p>
  </article>
)

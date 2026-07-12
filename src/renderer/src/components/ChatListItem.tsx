import { LoaderCircle } from 'lucide-react'
import type { ProviderChat } from '../../../shared/provider'

type ChatListItemProps = {
  chat: ProviderChat
  onClick: () => void
}

const statusLabels = {
  active: 'In progress',
  error: 'Error',
  waitingOnApproval: 'Waiting for approval',
  waitingOnUserInput: 'Waiting for your input'
} as const

export const ChatListItem: React.FC<ChatListItemProps> = ({ chat, onClick }) => (
  <button className="chat-list-item" type="button" onClick={onClick}>
    <span className="chat-list-item__header">
      <span className="chat-list-item__title">{chat.title}</span>
      <span className="chat-list-item__meta">
        <time dateTime={new Date(chat.updatedAt).toISOString()}>
          {new Date(chat.updatedAt).toLocaleDateString()}
        </time>
        {chat.status && (
          <span className="chat-list-item__status-container" title={statusLabels[chat.status]}>
            {chat.status === 'active' ? (
              <LoaderCircle
                className="chat-list-item__loading"
                aria-label={statusLabels[chat.status]}
              />
            ) : (
              <span
                className={`chat-list-item__status chat-list-item__status--${chat.status}`}
                role="img"
                aria-label={statusLabels[chat.status]}
              />
            )}
          </span>
        )}
      </span>
    </span>
    <span className="chat-list-item__preview">{chat.preview}</span>
  </button>
)

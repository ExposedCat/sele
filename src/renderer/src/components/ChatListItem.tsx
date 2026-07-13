import { ChevronRight, LoaderCircle } from 'lucide-react'
import type { ProviderChat } from '../../../shared/provider'
import './ChatListItem.css'

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

const workingStatuses = new Set<NonNullable<ProviderChat['status']>>([
  'active',
  'waitingOnApproval',
  'waitingOnUserInput'
])

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
            {workingStatuses.has(chat.status) ? (
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
    <span className="chat-list-item__body">
      <span className="chat-list-item__preview">{chat.preview}</span>
      <ChevronRight className="chat-list-item__chevron" aria-hidden="true" />
    </span>
  </button>
)

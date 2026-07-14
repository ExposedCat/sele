import { Check, Folder, LoaderCircle, Pin, PinOff } from 'lucide-react'
import type { ProviderChat } from '../../../shared/provider'
import './ChatListItem.css'

type ChatListItemProps = {
  chat: ProviderChat
  onClick: () => void
  onMarkDone: () => void
  onTogglePinned: () => void
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

const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const getChatProjectName = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? getLastPathPart(normalizedCwd) : 'Unknown cwd'
}

export const ChatListItem: React.FC<ChatListItemProps> = ({
  chat,
  onClick,
  onMarkDone,
  onTogglePinned
}) => {
  const updatedAt = new Date(chat.updatedAt)
  const projectName = getChatProjectName(chat.cwd)
  const workingStatus = chat.status && workingStatuses.has(chat.status) ? chat.status : null
  const trailingStatus = chat.status && !workingStatus ? chat.status : null

  return (
    <article className={`chat-list-item${chat.pinned ? ' chat-list-item--pinned' : ''}`}>
      <button className="chat-list-item__main" type="button" onClick={onClick}>
        <span className="chat-list-item__header">
          {workingStatus && (
            <span
              className="chat-list-item__status-container chat-list-item__status-container--leading"
              title={statusLabels[workingStatus]}
            >
              <LoaderCircle
                className="chat-list-item__loading"
                aria-label={statusLabels[workingStatus]}
              />
            </span>
          )}
          <span className="chat-list-item__title">{chat.title}</span>
          {trailingStatus && (
            <span className="chat-list-item__meta">
              <span
                className="chat-list-item__status-container"
                title={statusLabels[trailingStatus]}
              >
                <span
                  className={`chat-list-item__status chat-list-item__status--${trailingStatus}`}
                  role="img"
                  aria-label={statusLabels[trailingStatus]}
                />
              </span>
            </span>
          )}
        </span>
        <span className="chat-list-item__body">
          <span className="chat-list-item__context" title={chat.cwd ?? projectName}>
            <Folder className="chat-list-item__folder" aria-hidden="true" />
            <span className="chat-list-item__project">{projectName}</span>
            <span className="chat-list-item__separator">·</span>
            <time dateTime={updatedAt.toISOString()}>{updatedAt.toLocaleDateString()}</time>
          </span>
        </span>
      </button>
      <span className="chat-list-item__actions">
        {!chat.done && (
          <button
            className="chat-list-item__action"
            type="button"
            aria-label="Mark chat done"
            title="Mark done"
            onClick={onMarkDone}
          >
            <Check aria-hidden="true" />
          </button>
        )}
        <button
          className={`chat-list-item__action chat-list-item__action--pin${chat.pinned ? ' chat-list-item__action--active' : ''}`}
          type="button"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={onTogglePinned}
        >
          {chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        </button>
      </span>
    </article>
  )
}

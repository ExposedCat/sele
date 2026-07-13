import { ChevronRight, Folder, LoaderCircle } from 'lucide-react'
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

const getLastPathPart = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

const getChatProjectName = (cwd: string | null): string => {
  const normalizedCwd = cwd?.trim()
  return normalizedCwd ? getLastPathPart(normalizedCwd) : 'Unknown cwd'
}

export const ChatListItem: React.FC<ChatListItemProps> = ({ chat, onClick }) => {
  const updatedAt = new Date(chat.updatedAt)
  const projectName = getChatProjectName(chat.cwd)

  return (
    <button className="chat-list-item" type="button" onClick={onClick}>
      <span className="chat-list-item__header">
        <span className="chat-list-item__title">{chat.title}</span>
        {chat.status && (
          <span className="chat-list-item__meta">
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
        <ChevronRight className="chat-list-item__chevron" aria-hidden="true" />
      </span>
    </button>
  )
}

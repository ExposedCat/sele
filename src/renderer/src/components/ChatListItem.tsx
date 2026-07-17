import { Check, Folder, GitBranch, LoaderCircle, Pin, PinOff } from 'lucide-react'
import type { ProviderChat } from '../../../shared/provider'
import { Button } from './Button'
import './ChatListItem.css'

type ChatListItemProps = {
  chat: ProviderChat
  selected: boolean
  showProject: boolean
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
  selected,
  showProject,
  onClick,
  onMarkDone,
  onTogglePinned
}) => {
  const createdAt = new Date(chat.createdAt)
  const contextName = chat.branchName ?? getChatProjectName(chat.cwd)
  const projectName = getChatProjectName(chat.projectCwd ?? chat.cwd)
  const visibleProjectName = showProject && projectName !== contextName ? projectName : null
  const isGitWorktree = chat.cwdKind === 'gitWorktree'
  const ProjectIcon = isGitWorktree ? GitBranch : Folder
  const contextTitle =
    isGitWorktree && chat.cwd
      ? `${chat.branchName ?? 'Git worktree'}: ${chat.cwd}`
      : (chat.cwd ?? contextName)
  const workingStatus = chat.status && workingStatuses.has(chat.status) ? chat.status : null
  const trailingStatus = chat.status && !workingStatus ? chat.status : null

  return (
    <article
      className={`chat-list-item${chat.pinned ? ' chat-list-item--pinned' : ''}${selected ? ' chat-list-item--selected' : ''}`}
    >
      <button
        className="chat-list-item__main"
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
      >
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
          <span
            className={`chat-list-item__context${visibleProjectName ? ' chat-list-item__context--with-project' : ''}`}
            title={contextTitle}
          >
            {visibleProjectName && (
              <>
                <span className="chat-list-item__project-category">{visibleProjectName}</span>
                <span className="chat-list-item__separator">·</span>
              </>
            )}
            <ProjectIcon className="chat-list-item__folder" aria-hidden="true" />
            <span className="chat-list-item__project">{contextName}</span>
            <span className="chat-list-item__separator">·</span>
            <time dateTime={createdAt.toISOString()}>{createdAt.toLocaleDateString()}</time>
          </span>
        </span>
      </button>
      <span className="chat-list-item__actions">
        {!chat.done && (
          <Button
            theme="transparent"
            size="small"
            aria-label="Mark chat done"
            title="Mark done"
            callback={onMarkDone}
            icon={<Check aria-hidden="true" />}
          />
        )}
        <Button
          theme={chat.pinned ? 'secondary' : 'transparent'}
          size="small"
          aria-label={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
          callback={onTogglePinned}
          icon={chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
        />
      </span>
    </article>
  )
}

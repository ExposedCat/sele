import { CheckCheck, PinOff, SquarePen } from 'lucide-react'
import type { ProviderApprovalDecision, ProviderChat } from '../../../shared/provider'
import { Button } from './Button'
import { ChatList } from './ChatList'
import { DisclosureToggle } from './DisclosureToggle'
import './ChatListGroup.css'

export type ChatListGroupData = {
  key: string
  cwd: string | null
  label: string
  chats: ProviderChat[]
  kind: 'pinned' | 'cwd' | 'done'
}

type ChatListGroupProps = {
  contentId: string
  group: ChatListGroupData
  open: boolean
  selectedChatKey: string | null
  onMarkChatDone: (chat: ProviderChat) => void
  onMarkCwdChatsDone: (group: ChatListGroupData) => void
  onNewChatInCwd: (group: ChatListGroupData) => void
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onSelectChat: (chat: ProviderChat) => void
  onToggle: (groupKey: string) => void
  onToggleChatPinned: (chat: ProviderChat) => void
  onUnpinPinnedChats: (group: ChatListGroupData) => void
  resolvingApprovalId?: string | null
}

export const ChatListGroup: React.FC<ChatListGroupProps> = ({
  contentId,
  group,
  open,
  selectedChatKey,
  onMarkChatDone,
  onMarkCwdChatsDone,
  onNewChatInCwd,
  onResolveApproval,
  onSelectChat,
  onToggle,
  onToggleChatPinned,
  onUnpinPinnedChats,
  resolvingApprovalId = null
}) => {
  return (
    <section
      className={`chat-list-group chat-list-group--${group.kind}${open ? ' chat-list-group--open' : ''}`}
      aria-label={`${group.label} chats`}
    >
      <div className="chat-list-group__header">
        <DisclosureToggle
          className="chat-list-group__toggle"
          chevronClassName="chat-list-group__chevron"
          aria-controls={contentId}
          open={open}
          title={group.cwd ?? group.label}
          onClick={() => onToggle(group.key)}
        >
          <span className="chat-list-group__title">{group.label}</span>
        </DisclosureToggle>
        {group.kind === 'cwd' && (
          <span className="chat-list-group__action">
            <Button
              theme="transparent"
              size="small"
              aria-label={`New chat in ${group.label}`}
              title="New chat"
              callback={() => onNewChatInCwd(group)}
              icon={<SquarePen aria-hidden="true" />}
            />
            <Button
              theme="transparent"
              size="small"
              aria-label={`Mark all ${group.label} chats done`}
              title="Mark project chats done"
              callback={() => onMarkCwdChatsDone(group)}
              icon={<CheckCheck aria-hidden="true" />}
            />
          </span>
        )}
        {group.kind === 'pinned' && (
          <span className="chat-list-group__action">
            <Button
              theme="transparent"
              size="small"
              aria-label="Unpin all pinned chats"
              title="Unpin all"
              callback={() => onUnpinPinnedChats(group)}
              icon={<PinOff aria-hidden="true" />}
            />
          </span>
        )}
      </div>
      {open && (
        <blockquote className="chat-list-group__items" id={contentId}>
          <ChatList
            ariaLabel={`${group.label} chats`}
            chats={group.chats}
            selectedChatKey={selectedChatKey}
            showProjects={group.kind === 'pinned' || group.kind === 'done'}
            onMarkDone={onMarkChatDone}
            onResolveApproval={onResolveApproval}
            onSelect={onSelectChat}
            onTogglePinned={onToggleChatPinned}
            resolvingApprovalId={resolvingApprovalId}
          />
        </blockquote>
      )}
    </section>
  )
}

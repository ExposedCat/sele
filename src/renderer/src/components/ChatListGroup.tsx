import {
  CheckCheck,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  PinOff,
  Plus,
  SquarePen,
  StickyNote,
  X
} from 'lucide-react'
import { type CSSProperties, type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ProviderApprovalDecision,
  ProviderChat,
  ProviderCwdNote
} from '../../../shared/provider'
import { Button } from './Button'
import { ChatList } from './ChatList'
import { DisclosureToggle } from './DisclosureToggle'
import { Input } from './Input'
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
  visibleChatCount?: number
  chatPageSize?: number
  projectIconSrc?: string | null
  onLoadMoreChats?: (group: ChatListGroupData) => void
  onShowLessChats?: (group: ChatListGroupData) => void
  notes?: ProviderCwdNote[]
  onMarkChatDone: (chat: ProviderChat, done?: boolean) => void
  onMarkCwdChatsDone: (group: ChatListGroupData) => void
  onNewChatInCwd: (group: ChatListGroupData) => void
  onNotesChange?: (group: ChatListGroupData, notes: ProviderCwdNote[]) => void
  onSelectProjectIcon?: (group: ChatListGroupData) => void
  onResolveApproval: (chat: ProviderChat, decision: ProviderApprovalDecision) => void
  onSelectChat: (chat: ProviderChat) => void
  onToggle: (groupKey: string) => void
  onToggleChatPinned: (chat: ProviderChat) => void
  onUnpinPinnedChats: (group: ChatListGroupData) => void
  resolvingApprovalId?: string | null
}

type ChatListGroupNotesButtonProps = {
  group: ChatListGroupData
  notes: ProviderCwdNote[]
  onNotesChange: (group: ChatListGroupData, notes: ProviderCwdNote[]) => void
}

const createNoteId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const getNotesMenuStyle = (buttonRect: DOMRect): CSSProperties => {
  const viewportInset = 12
  const menuOffset = 6
  const menuWidth = Math.min(320, window.innerWidth - viewportInset * 2)
  const bottomSpace = window.innerHeight - buttonRect.bottom
  const openUp = bottomSpace < 260 && buttonRect.top > bottomSpace
  const nextMenuStyle: CSSProperties = {
    width: menuWidth,
    right: Math.max(viewportInset, window.innerWidth - buttonRect.right)
  }

  if (openUp) {
    nextMenuStyle.bottom = window.innerHeight - buttonRect.top + menuOffset
  } else {
    nextMenuStyle.top = buttonRect.bottom + menuOffset
  }

  return nextMenuStyle
}

const ChatListGroupNotesButton: React.FC<ChatListGroupNotesButtonProps> = ({
  group,
  notes,
  onNotesChange
}) => {
  const rootRef = useRef<HTMLSpanElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [draft, setDraft] = useState('')
  const menuId = `${group.key.replace(/[^a-z0-9_-]/gi, '-')}-notes-menu`

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setMenuStyle(null)
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const buttonRect = rootRef.current?.getBoundingClientRect()

    if (!buttonRect || buttonRect.bottom < 0 || buttonRect.top > window.innerHeight) {
      closeMenu()
      return
    }

    setMenuStyle(getNotesMenuStyle(buttonRect))
  }, [closeMenu])

  const openMenu = (): void => {
    const buttonRect = rootRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getNotesMenuStyle(buttonRect))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    inputRef.current?.focus({ preventScroll: true })

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu()
      }
    }

    const handleResize = (): void => updateMenuPosition()
    const handleScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return

      updateMenuPosition()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [closeMenu, open, updateMenuPosition])

  const commitNotes = (nextNotes: ProviderCwdNote[]): void => {
    onNotesChange(group, nextNotes)
  }

  const handleAddNote = (): void => {
    const text = draft.trim()
    if (!text) return

    commitNotes([
      ...notes,
      {
        id: createNoteId(),
        text,
        createdAt: Date.now()
      }
    ])
    setDraft('')
    inputRef.current?.focus({ preventScroll: true })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    handleAddNote()
  }

  const handleRemoveNote = (noteId: string): void => {
    commitNotes(notes.filter((note) => note.id !== noteId))
  }

  const menu = open ? (
    <div
      ref={menuRef}
      className="chat-list-group-notes-menu"
      id={menuId}
      role="dialog"
      aria-label={`${group.label} notes`}
      style={menuStyle ?? undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return

        event.preventDefault()
        closeMenu()
      }}
    >
      <div className="chat-list-group-notes-menu__items">
        {notes.length === 0 ? (
          <p className="chat-list-group-notes-menu__empty">No notes yet</p>
        ) : (
          notes.map((note) => (
            <div className="chat-list-group-notes-menu__item" key={note.id}>
              <span className="chat-list-group-notes-menu__text">{note.text}</span>
              <Button
                theme="transparent"
                size="small"
                aria-label="Remove note"
                title="Remove note"
                callback={() => handleRemoveNote(note.id)}
                icon={<X aria-hidden="true" />}
              />
            </div>
          ))
        )}
      </div>
      <form className="chat-list-group-notes-menu__form" onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          value={draft}
          maxLength={1000}
          placeholder="Add note"
          aria-label={`Add note to ${group.label}`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          theme="secondary"
          size="small"
          aria-label="Add note"
          title="Add note"
          callback={handleAddNote}
          disabled={!draft.trim()}
          icon={<Plus aria-hidden="true" />}
        />
      </form>
    </div>
  ) : null

  return (
    <span
      className={`chat-list-group-notes${open ? ' chat-list-group-notes--open' : ''}`}
      ref={rootRef}
    >
      <Button
        theme="transparent"
        size="small"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-label={`${group.label} notes`}
        title={notes.length > 0 ? `${notes.length} notes` : 'Notes'}
        callback={() => {
          if (open) closeMenu()
          else openMenu()
        }}
        icon={<StickyNote aria-hidden="true" />}
      />
      {menu && createPortal(menu, document.body)}
    </span>
  )
}

export const ChatListGroup: React.FC<ChatListGroupProps> = ({
  contentId,
  group,
  open,
  selectedChatKey,
  visibleChatCount = group.chats.length,
  chatPageSize = 20,
  projectIconSrc = null,
  onLoadMoreChats,
  onShowLessChats,
  notes = [],
  onMarkChatDone,
  onMarkCwdChatsDone,
  onNewChatInCwd,
  onNotesChange,
  onSelectProjectIcon,
  onResolveApproval,
  onSelectChat,
  onToggle,
  onToggleChatPinned,
  onUnpinPinnedChats,
  resolvingApprovalId = null
}) => {
  const visibleChats = group.chats.slice(0, visibleChatCount)
  const remainingChatCount = Math.max(0, group.chats.length - visibleChats.length)
  const nextChatCount = Math.min(chatPageSize, remainingChatCount)
  const canShowLessChats = visibleChatCount > chatPageSize
  const showChatPaginationActions =
    (remainingChatCount > 0 && onLoadMoreChats) || (canShowLessChats && onShowLessChats)
  const toggle = (
    <DisclosureToggle
      className="chat-list-group__toggle"
      chevronClassName="chat-list-group__chevron"
      contentClassName={
        group.kind === 'cwd' ? 'chat-list-group__toggle-content--project' : undefined
      }
      aria-controls={contentId}
      open={open}
      title={group.cwd ?? group.label}
      onClick={() => onToggle(group.key)}
    >
      <span className="chat-list-group__title">{group.label}</span>
    </DisclosureToggle>
  )

  return (
    <section
      className={`chat-list-group chat-list-group--${group.kind}${open ? ' chat-list-group--open' : ''}`}
      aria-label={`${group.label} chats`}
    >
      <div className="chat-list-group__header">
        {group.kind === 'cwd' ? (
          <span className="chat-list-group__project-toggle">
            <button
              className="chat-list-group__project-icon-button"
              type="button"
              aria-label={`Project: ${group.label}`}
              title="Choose project image"
              onClick={() => onSelectProjectIcon?.(group)}
            >
              {projectIconSrc ? (
                <img className="chat-list-group__project-icon-image" src={projectIconSrc} alt="" />
              ) : (
                <FolderKanban aria-hidden="true" />
              )}
            </button>
            {toggle}
          </span>
        ) : (
          toggle
        )}
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
            {onNotesChange && (
              <ChatListGroupNotesButton group={group} notes={notes} onNotesChange={onNotesChange} />
            )}
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
            chats={visibleChats}
            selectedChatKey={selectedChatKey}
            canMarkDone={group.kind !== 'done'}
            canMarkUndone={group.kind === 'done'}
            showProjects={group.kind === 'pinned' || group.kind === 'done'}
            onMarkDone={onMarkChatDone}
            onResolveApproval={onResolveApproval}
            onSelect={onSelectChat}
            onTogglePinned={onToggleChatPinned}
            resolvingApprovalId={resolvingApprovalId}
          />
          {showChatPaginationActions && (
            <div className="chat-list-group__more">
              {canShowLessChats && onShowLessChats && (
                <Button
                  theme="secondary"
                  size="small"
                  fill
                  aria-label={`Show fewer ${group.label} chats`}
                  title="Show less"
                  callback={() => onShowLessChats(group)}
                  icon={<ChevronUp aria-hidden="true" />}
                  label="Show less"
                />
              )}
              {remainingChatCount > 0 && onLoadMoreChats && (
                <Button
                  theme="secondary"
                  size="small"
                  fill
                  aria-label={`Load next ${nextChatCount} ${group.label} chats`}
                  title={`Load next ${nextChatCount} chats`}
                  callback={() => onLoadMoreChats(group)}
                  icon={<ChevronDown aria-hidden="true" />}
                  label={`Load next ${nextChatCount}`}
                />
              )}
            </div>
          )}
        </blockquote>
      )}
    </section>
  )
}

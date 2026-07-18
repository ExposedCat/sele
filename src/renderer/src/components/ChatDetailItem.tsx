import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react'
import {
  ActivityIcon as AnimatedActivityIcon,
  BoxIcon as AnimatedBoxIcon,
  BrainIcon as AnimatedBrainIcon,
  DeleteIcon as AnimatedDeleteIcon,
  FilePenLineIcon as AnimatedFilePenLineIcon,
  FileStackIcon as AnimatedFileStackIcon,
  FileTextIcon as AnimatedFileTextIcon,
  GitBranchIcon as AnimatedGitBranchIcon,
  HourglassIcon as AnimatedHourglassIcon,
  LoaderPinwheelIcon as AnimatedLoaderPinwheelIcon,
  PenToolIcon as AnimatedPenToolIcon,
  SearchIcon as AnimatedSearchIcon,
  TerminalIcon as AnimatedTerminalIcon,
  WrenchIcon as AnimatedWrenchIcon
} from 'lucide-animated'
import {
  Check,
  ChevronRight,
  Copy,
  FilePlus2,
  FileCode2,
  FileText,
  GitBranch,
  LoaderCircle,
  Package,
  Pencil,
  Search,
  Square,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react'
import Markdown from 'markdown-to-jsx'
import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderPendingMessage,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool
} from '../../../shared/provider'
import { Button } from './Button'
import './ChatDetailItem.css'

type ChatDetailItemProps = {
  canEditOwnMessages?: boolean
  item: ProviderChatItem
  onDeletePendingMessage?: (message: ProviderPendingMessage) => void
  onInterruptPendingMessage?: (message: ProviderPendingMessage) => void
  onEditMessage?: (message: ProviderMessage) => void
}

type ProviderToolItem = Exclude<ProviderWorkingItem, { type: 'message' }>
type ProviderWorkingMessageItem = Extract<ProviderWorkingItem, { type: 'message' }>
type WorkingBlock =
  | { type: 'message'; item: ProviderWorkingMessageItem }
  | { type: 'tools'; items: ProviderToolItem[] }

type AnimatedIconHandle = {
  startAnimation: () => void
  stopAnimation: () => void
}

type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & {
    size?: number
    animateOnHover?: boolean
  } & RefAttributes<AnimatedIconHandle>
>

const activityLabels: Record<ProviderToolActivity, string> = {
  read: 'read files',
  search: 'searched',
  git: 'used Git',
  edit: 'changed files',
  create: 'created files',
  delete: 'deleted files',
  npm: 'ran npm scripts',
  npx: 'ran npx tools',
  script: 'ran scripts',
  command: 'ran commands',
  other: 'used tools'
}

const activeActivityLabels: Record<ProviderToolActivity, string> = {
  read: 'Reading files',
  search: 'Searching',
  git: 'Using Git',
  edit: 'Changing files',
  create: 'Creating files',
  delete: 'Deleting files',
  npm: 'Running npm scripts',
  npx: 'Running npx tools',
  script: 'Running scripts',
  command: 'Running commands',
  other: 'Using tools'
}

const animatedActivityIcons: Record<ProviderToolActivity, AnimatedIconComponent> = {
  read: AnimatedFileTextIcon,
  search: AnimatedSearchIcon,
  git: AnimatedGitBranchIcon,
  edit: AnimatedFilePenLineIcon,
  create: AnimatedFileStackIcon,
  delete: AnimatedDeleteIcon,
  npm: AnimatedBoxIcon,
  npx: AnimatedBoxIcon,
  script: AnimatedPenToolIcon,
  command: AnimatedTerminalIcon,
  other: AnimatedWrenchIcon
}

const placeholderOptions = [
  { label: 'Thinking', Icon: AnimatedBrainIcon },
  { label: 'Analyzing', Icon: AnimatedActivityIcon },
  { label: 'Processing', Icon: AnimatedLoaderPinwheelIcon },
  { label: 'Working', Icon: AnimatedHourglassIcon }
] satisfies Array<{ label: string; Icon: AnimatedIconComponent }>
const longRunningActivities = new Set<ProviderToolActivity>(['npm', 'npx', 'script', 'command'])
const silencePlaceholderDelayMs = 600
const animatedIconReplayMs = 1_050
const markdownOptions = {
  disableParsingRawHTML: true,
  forceBlock: true,
  wrapper: Fragment,
  overrides: {
    a: {
      props: {
        rel: 'noreferrer',
        target: '_blank'
      }
    }
  }
} as const

const getStableIndex = (id: string, length: number): number => {
  let hash = 0

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0
  }

  return Math.abs(hash) % length
}

const getPlaceholderOption = (id: string): (typeof placeholderOptions)[number] =>
  placeholderOptions[getStableIndex(id, placeholderOptions.length)]

const activeLabelReplacements: Array<[RegExp, string]> = [
  [/^Read\b/, 'Reading'],
  [/^Searched\b/, 'Searching'],
  [/^Checked\b/, 'Checking'],
  [/^Viewed\b/, 'Viewing'],
  [/^Ran\b/, 'Running'],
  [/^Used\b/, 'Using'],
  [/^Changed\b/, 'Changing'],
  [/^Created\b/, 'Creating'],
  [/^Deleted\b/, 'Deleting'],
  [/^Applied\b/, 'Applying'],
  [/^Updated\b/, 'Updating']
]

const finishedLabelPrefixes =
  /^(Read|Searched|Checked|Viewed|Ran|Used|Changed|Created|Deleted|Applied|Updated)\b/

const getActiveToolLabel = (label: string, activity: ProviderToolActivity): string => {
  for (const [pattern, replacement] of activeLabelReplacements) {
    if (pattern.test(label)) return label.replace(pattern, replacement)
  }

  return activeActivityLabels[activity]
}

const getFinishedToolLabel = (label: string, activity: ProviderToolActivity): string => {
  if (finishedLabelPrefixes.test(label)) return label
  if (label && label !== 'Tool use') return activity === 'other' ? `Used ${label}` : label

  const fallback = activityLabels[activity] || activityLabels.other
  return fallback.charAt(0).toLocaleUpperCase() + fallback.slice(1)
}

const getToolDisplayLabel = (
  label: string,
  activity: ProviderToolActivity,
  active: boolean
): string => (active ? getActiveToolLabel(label, activity) : getFinishedToolLabel(label, activity))

const DiffContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content">
    {tools.flatMap((tool) =>
      tool.diffs.map((diff, index) => (
        <section key={`${tool.id}:${diff.path}:${index}`}>
          <h3>{diff.path}</h3>
          <pre>{diff.diff}</pre>
        </section>
      ))
    )}
  </div>
)

const CommandContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content chat-detail__activity-content--command">
    {tools.map((tool) => (
      <section key={tool.id}>
        {tool.command && <pre>{tool.command}</pre>}
        {tool.command && tool.stdout && (
          <span className="chat-detail__command-divider" aria-hidden="true" />
        )}
        {tool.stdout && <pre>{tool.stdout}</pre>}
      </section>
    ))}
  </div>
)

const formatRawOutput = (value: unknown): string => {
  if (value == null) return 'null'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const RawContent: React.FC<{ tools: ProviderWorkingTool[] }> = ({ tools }) => (
  <div className="chat-detail__activity-content">
    {tools.map((tool) => (
      <section key={tool.id}>
        <pre>{formatRawOutput(tool.rawOutput)}</pre>
      </section>
    ))}
  </div>
)

const ToolTypeIcon: React.FC<{ activity: ProviderToolActivity }> = ({ activity }) => {
  if (activity === 'read') return <FileText aria-hidden="true" />
  if (activity === 'search') return <Search aria-hidden="true" />
  if (activity === 'git') return <GitBranch aria-hidden="true" />
  if (activity === 'edit') return <Pencil aria-hidden="true" />
  if (activity === 'create') return <FilePlus2 aria-hidden="true" />
  if (activity === 'delete') return <Trash2 aria-hidden="true" />
  if (activity === 'npm' || activity === 'npx') return <Package aria-hidden="true" />
  if (activity === 'script') return <FileCode2 aria-hidden="true" />
  if (activity === 'command') return <Terminal aria-hidden="true" />

  return <Wrench aria-hidden="true" />
}

const LoopingAnimatedIcon: React.FC<{
  Icon: AnimatedIconComponent
  active: boolean
}> = ({ Icon, active }) => {
  const iconRef = useRef<AnimatedIconHandle | null>(null)

  useEffect(() => {
    const icon = iconRef.current

    if (!active) {
      icon?.stopAnimation()
      return undefined
    }

    icon?.startAnimation()
    const interval = window.setInterval(() => icon?.startAnimation(), animatedIconReplayMs)

    return () => {
      window.clearInterval(interval)
      icon?.stopAnimation()
    }
  }, [active])

  return (
    <Icon
      ref={iconRef}
      className="chat-detail__animated-icon"
      size={18}
      animateOnHover={false}
      aria-hidden="true"
    />
  )
}

const ToolStatusIcon: React.FC<{ activity: ProviderToolActivity; active: boolean }> = ({
  activity,
  active
}) => {
  if (active) {
    return <LoopingAnimatedIcon Icon={animatedActivityIcons[activity]} active={active} />
  }

  return <ToolTypeIcon activity={activity} />
}

const Activity: React.FC<{ label: string; tools: ProviderWorkingTool[]; active: boolean }> = ({
  label,
  tools,
  active
}) => {
  const activity = tools[0]?.activity ?? 'other'

  const detailLabel = getToolDisplayLabel(label || tools[0]?.toolId || 'Tool use', activity, active)
  const content =
    activity === 'edit' || activity === 'create' || activity === 'delete' ? (
      <DiffContent tools={tools} />
    ) : activity === 'command' ||
      activity === 'search' ||
      activity === 'git' ||
      activity === 'npm' ||
      activity === 'npx' ||
      activity === 'script' ? (
      <CommandContent tools={tools} />
    ) : (
      <RawContent tools={tools} />
    )

  return (
    <details
      className={`chat-detail__tool-group${active ? ' chat-detail__tool-group--active' : ''}`}
    >
      <summary>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={activity} active={active} />
        </span>
        <span className="chat-detail__tool-label">{detailLabel}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {content}
    </details>
  )
}

const getToolsFromToolItem = (item: ProviderToolItem): ProviderWorkingTool[] =>
  item.type === 'toolGroup' ? item.tools : [item]

const ToolItem: React.FC<{ item: ProviderToolItem; activeToolIds: Set<string> }> = ({
  item,
  activeToolIds
}) => {
  const tools = getToolsFromToolItem(item)
  const activity = tools[0]?.activity ?? 'other'
  const active = tools.some((tool) => activeToolIds.has(tool.id))
  const rawLabel = item.label || tools[0]?.toolId || 'Tool use'
  const label = getToolDisplayLabel(rawLabel, activity, active)

  if (activity === 'read') {
    return (
      <div className={`chat-detail__tool-read${active ? ' chat-detail__tool-read--active' : ''}`}>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity="read" active={active} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
      </div>
    )
  }

  return <Activity label={rawLabel} tools={tools} active={active} />
}

const MarkdownMessage: React.FC<{ className: string; content: string }> = ({
  className,
  content
}) => (
  <div className={className}>
    <Markdown options={markdownOptions}>{content}</Markdown>
  </div>
)

const copyTextToClipboard = async (content: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }

  const textArea = document.createElement('textarea')
  textArea.value = content
  textArea.style.position = 'fixed'
  textArea.style.inset = '0 auto auto 0'
  textArea.style.opacity = '0'
  document.body.append(textArea)
  textArea.focus()
  textArea.select()

  try {
    if (!document.execCommand('copy')) throw new Error('Unable to copy message')
  } finally {
    textArea.remove()
  }
}

const formatMessageTimestamp = (
  timestamp: number | null | undefined
): { dateTime: string; label: string } | null => {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null

  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const sameYear = date.getFullYear() === now.getFullYear()
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  })
  const dayMonthLabel = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  })
  const dayMonthYearLabel = date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
  const dateLabel = sameDay ? '' : sameYear ? dayMonthLabel : dayMonthYearLabel

  return {
    dateTime: date.toISOString(),
    label: dateLabel ? `${dateLabel}, ${timeLabel}` : timeLabel
  }
}

const MessageDate: React.FC<{
  timestamp: ReturnType<typeof formatMessageTimestamp>
  markerSide: 'left' | 'right'
}> = ({ timestamp, markerSide }) => {
  if (!timestamp) {
    return <span className="chat-detail__message-date chat-detail__message-date--empty" />
  }

  return (
    <time
      className="chat-detail__message-date"
      dateTime={timestamp.dateTime}
      title={timestamp.label}
    >
      {markerSide === 'left' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
      <span>{timestamp.label}</span>
      {markerSide === 'right' && (
        <span className="chat-detail__message-date-marker" aria-hidden="true">
          ·
        </span>
      )}
    </time>
  )
}

const getSequenceLabel = (tools: ProviderWorkingTool[]): string => {
  const labels = [...new Set(tools.map((tool) => activityLabels[tool.activity]))]
  const label = labels.join(', ') || activityLabels.other

  return label.charAt(0).toLocaleUpperCase() + label.slice(1)
}

const getDominantActivity = (tools: ProviderWorkingTool[]): ProviderToolActivity => {
  if (tools.length === 0) return 'other'

  const activityCounts = tools.reduce<Map<ProviderToolActivity, number>>((counts, tool) => {
    counts.set(tool.activity, (counts.get(tool.activity) ?? 0) + 1)
    return counts
  }, new Map())
  const highestCount = Math.max(...activityCounts.values())

  return (
    tools.find((tool) => activityCounts.get(tool.activity) === highestCount)?.activity ?? 'other'
  )
}

const ToolSequence: React.FC<{ items: ProviderToolItem[]; activeToolIds: Set<string> }> = ({
  items,
  activeToolIds
}) => {
  const tools = items.flatMap(getToolsFromToolItem)
  const activeTools = tools.filter((tool) => activeToolIds.has(tool.id))
  const active = activeTools.length > 0
  const dominantActivity = getDominantActivity(active ? activeTools : tools)
  const label = active ? activeActivityLabels[dominantActivity] : getSequenceLabel(tools)

  return (
    <details
      className={`chat-detail__tool-sequence${active ? ' chat-detail__tool-sequence--active' : ''}`}
    >
      <summary>
        <span className="chat-detail__tool-icon">
          <ToolStatusIcon activity={dominantActivity} active={active} />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      <div className="chat-detail__tool-sequence-content">
        {items.map((item) => (
          <ToolItem item={item} activeToolIds={activeToolIds} key={item.id} />
        ))}
      </div>
    </details>
  )
}

const WorkingPlaceholder: React.FC<{ id: string }> = ({ id }) => {
  const placeholder = getPlaceholderOption(id)

  return (
    <div className="chat-detail__tool-read chat-detail__tool-read--active chat-detail__tool-placeholder">
      <span className="chat-detail__tool-icon">
        <LoopingAnimatedIcon Icon={placeholder.Icon} active />
      </span>
      <span className="chat-detail__tool-label">{placeholder.label}</span>
    </div>
  )
}

type PlaceholderState = {
  signature: string
  visible: boolean
}

const getToolSignature = (tool: ProviderWorkingTool): string =>
  [
    tool.id,
    tool.label,
    tool.status,
    tool.command?.length ?? 0,
    tool.stdout?.length ?? 0,
    tool.diffs.map((diff) => `${diff.path}:${diff.diff.length}`).join(','),
    tool.backgroundSessionId,
    tool.finishedBackgroundSessionId
  ].join(':')

const getWorkingItemSignature = (item: ProviderWorkingItem): string => {
  if (item.type === 'message') return `message:${item.id}:${item.content.length}`
  if (item.type === 'toolGroup') {
    return `toolGroup:${item.id}:${item.tools.map(getToolSignature).join('|')}`
  }

  return `tool:${getToolSignature(item)}`
}

const getActiveToolIds = (item: ProviderWorkingStep): Set<string> => {
  const activeToolIds = new Set<string>()
  if (item.status !== 'working') return activeToolIds

  const closedBackgroundSessionIds = new Set<string>()

  for (let itemIndex = item.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const workingItem = item.items[itemIndex]
    if (workingItem.type === 'message') continue

    const tools = getToolsFromToolItem(workingItem)
    for (let toolIndex = tools.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = tools[toolIndex]
      if (tool.finishedBackgroundSessionId) {
        closedBackgroundSessionIds.add(tool.finishedBackgroundSessionId)
      }
      if (tool.backgroundSessionId && !closedBackgroundSessionIds.has(tool.backgroundSessionId)) {
        activeToolIds.add(tool.id)
      }
      if (tool.status === 'running' && longRunningActivities.has(tool.activity)) {
        activeToolIds.add(tool.id)
      }
    }
  }

  const lastItem = item.items.at(-1)
  if (lastItem && lastItem.type !== 'message') {
    for (const tool of getToolsFromToolItem(lastItem)) {
      activeToolIds.add(tool.id)
    }
  }

  return activeToolIds
}

const useSilencePlaceholder = (signature: string, active: boolean, immediate: boolean): boolean => {
  const [placeholderState, setPlaceholderState] = useState<PlaceholderState>(() => ({
    signature,
    visible: active && immediate
  }))

  useEffect(() => {
    if (!active) return undefined

    const timeout = window.setTimeout(
      () => setPlaceholderState({ signature, visible: true }),
      immediate ? 0 : silencePlaceholderDelayMs
    )

    return () => window.clearTimeout(timeout)
  }, [active, immediate, signature])

  return active && placeholderState.signature === signature && placeholderState.visible
}

const groupWorkingItems = (items: ProviderWorkingItem[]): WorkingBlock[] => {
  const blocks: WorkingBlock[] = []

  for (const item of items) {
    if (item.type === 'message') {
      blocks.push({ type: 'message', item })
      continue
    }

    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock?.type === 'tools') {
      lastBlock.items.push(item)
    } else {
      blocks.push({ type: 'tools', items: [item] })
    }
  }

  return blocks
}

const WorkingStep: React.FC<{ item: ProviderWorkingStep }> = ({ item }) => {
  const blocks = groupWorkingItems(item.items)
  const lastWorkingItem = item.items.at(-1)
  const signature = useMemo(
    () => `${item.status}:${item.items.map(getWorkingItemSignature).join('|')}`,
    [item.items, item.status]
  )
  const activeToolIds = useMemo(() => getActiveToolIds(item), [item])
  const active = item.status === 'working'
  const showPlaceholder = useSilencePlaceholder(
    signature,
    active && (!lastWorkingItem || lastWorkingItem.type === 'message'),
    !lastWorkingItem
  )
  const label =
    item.status === 'queued'
      ? 'Queued'
      : item.status === 'stopped'
        ? 'Stopped'
        : item.status === 'worked'
          ? 'Worked'
          : 'Working'
  const heading = (
    <span className="chat-detail__working-label">
      {active && <LoaderCircle className="chat-detail__working-spinner" aria-hidden="true" />}
      <span>{label}</span>
    </span>
  )

  if (blocks.length === 0) {
    if (showPlaceholder) {
      return <WorkingPlaceholder id={item.id} />
    }

    return (
      <div
        className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
      >
        <div className="chat-detail__working-heading">{heading}</div>
      </div>
    )
  }

  return (
    <details
      className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
      open={active}
    >
      <summary>
        {heading}
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      <div className="chat-detail__step-content">
        {blocks.map((block, blockIndex) =>
          block.type === 'tools' ? (
            block.items.length > 1 &&
            (blockIndex < blocks.length - 1 || item.status !== 'working' || showPlaceholder) ? (
              <ToolSequence
                items={block.items}
                activeToolIds={activeToolIds}
                key={block.items[0]?.id}
              />
            ) : (
              block.items.map((toolItem) => (
                <ToolItem item={toolItem} activeToolIds={activeToolIds} key={toolItem.id} />
              ))
            )
          ) : (
            <MarkdownMessage
              className="chat-detail__working-message"
              content={block.item.content}
              key={block.item.id}
            />
          )
        )}
        {showPlaceholder && <WorkingPlaceholder id={`${item.id}:${item.items.length}`} />}
      </div>
    </details>
  )
}

const getPendingMessageLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'Steering with' : 'Queue'

const getPendingMessageActionLabel = (message: ProviderPendingMessage): string =>
  message.kind === 'steering' ? 'steering' : 'queued'

export const ChatDetailItem: React.FC<ChatDetailItemProps> = ({
  canEditOwnMessages = false,
  item,
  onDeletePendingMessage,
  onInterruptPendingMessage,
  onEditMessage
}) => {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined

    const timeout = window.setTimeout(() => setCopied(false), 1_200)
    return () => window.clearTimeout(timeout)
  }, [copied])

  if (item.type === 'message' || item.type === 'pendingMessage') {
    const pending = item.type === 'pendingMessage'
    const role = pending ? 'user' : item.role
    const messageLabel = pending ? getPendingMessageLabel(item) : (item.label ?? null)
    const pendingActionLabel = pending ? getPendingMessageActionLabel(item) : 'pending'
    const canEdit = !pending && role === 'user' && canEditOwnMessages && Boolean(onEditMessage)
    const canDelete = pending && Boolean(onDeletePendingMessage)
    const canInterrupt = pending && Boolean(onInterruptPendingMessage)
    const timestamp = formatMessageTimestamp(item.createdAt)
    const handleCopyMessage = async (): Promise<void> => {
      await copyTextToClipboard(item.content)
      setCopied(true)
    }
    const messageActions = (
      <span className="chat-detail__message-actions">
        {canEdit && (
          <Button
            theme="secondary"
            size="small"
            aria-label="Edit message"
            title="Edit message"
            callback={() => {
              if (item.type === 'message') onEditMessage?.(item)
            }}
            icon={<Pencil aria-hidden="true" />}
          />
        )}
        {canInterrupt && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Interrupt with ${pendingActionLabel} message`}
            title={`Interrupt with ${pendingActionLabel} message`}
            callback={() => onInterruptPendingMessage?.(item)}
            icon={<Square aria-hidden="true" />}
          />
        )}
        {canDelete && pending && (
          <Button
            theme="secondary"
            size="small"
            aria-label={`Delete ${pendingActionLabel} message`}
            title={`Delete ${pendingActionLabel} message`}
            callback={() => onDeletePendingMessage?.(item)}
            icon={<Trash2 aria-hidden="true" />}
          />
        )}
        {!canEdit && !canInterrupt && !canDelete && role === 'user' ? (
          <span className="chat-detail__message-action-placeholder" aria-hidden="true" />
        ) : null}
        <Button
          theme="secondary"
          size="small"
          aria-label={copied ? 'Copied message' : 'Copy message'}
          title={copied ? 'Copied' : 'Copy message'}
          callback={handleCopyMessage}
          icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        />
      </span>
    )
    const messageDate = (
      <MessageDate markerSide={role === 'user' ? 'right' : 'left'} timestamp={timestamp} />
    )
    const messageBlockClassName = [
      'chat-detail__message-block',
      `chat-detail__message-block--${role}`,
      pending ? 'chat-detail__message-block--pending' : null,
      pending ? `chat-detail__message-block--pending-${item.kind}` : null
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div className={messageBlockClassName}>
        {messageLabel && <span className="chat-detail__pending-message-label">{messageLabel}</span>}
        <MarkdownMessage
          className={`chat-detail__message chat-detail__message--${role}`}
          content={item.content}
        />
        <div className="chat-detail__message-footer">
          {role === 'user' && messageDate}
          {messageActions}
          {role === 'assistant' && messageDate}
        </div>
      </div>
    )
  }

  return <WorkingStep item={item} />
}

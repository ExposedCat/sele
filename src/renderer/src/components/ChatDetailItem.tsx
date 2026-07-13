import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  FilePlus2,
  FileCode2,
  FileText,
  GitBranch,
  LoaderCircle,
  Package,
  Pencil,
  Search,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react'
import Markdown from 'markdown-to-jsx'
import type {
  ProviderChatItem,
  ProviderMessage,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool
} from '../../../shared/provider'
import './ChatDetailItem.css'

type ChatDetailItemProps = {
  canEditOwnMessages?: boolean
  item: ProviderChatItem
  onEditMessage?: (message: ProviderMessage) => void
}

type ProviderToolItem = Exclude<ProviderWorkingItem, { type: 'message' }>
type ProviderWorkingMessageItem = Extract<ProviderWorkingItem, { type: 'message' }>
type WorkingBlock =
  | { type: 'message'; item: ProviderWorkingMessageItem }
  | { type: 'tools'; items: ProviderToolItem[] }

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

const placeholderLabels = ['Thinking', 'Analyzing', 'Processing'] as const
const silencePlaceholderDelayMs = 600
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

const getPlaceholderLabel = (id: string): (typeof placeholderLabels)[number] => {
  let hash = 0

  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0
  }

  return placeholderLabels[Math.abs(hash) % placeholderLabels.length]
}

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

const Activity: React.FC<{ label: string; tools: ProviderWorkingTool[] }> = ({ label, tools }) => {
  const activity = tools[0]?.activity ?? 'other'

  const detailLabel = label || tools[0]?.toolId || 'Tool use'
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
    <details className="chat-detail__tool-group">
      <summary>
        <span className="chat-detail__tool-icon">
          <ToolTypeIcon activity={activity} />
        </span>
        <span className="chat-detail__tool-label">{detailLabel}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      {content}
    </details>
  )
}

const ToolItem: React.FC<{ item: ProviderToolItem }> = ({ item }) => {
  const tools = item.type === 'toolGroup' ? item.tools : [item]
  const activity = tools[0]?.activity ?? 'other'
  const label = item.label || tools[0]?.toolId || 'Tool use'

  if (activity === 'read') {
    return (
      <div className="chat-detail__tool-read">
        <span className="chat-detail__tool-icon">
          <ToolTypeIcon activity="read" />
        </span>
        <span className="chat-detail__tool-label">{label}</span>
      </div>
    )
  }

  return <Activity label={label} tools={tools} />
}

const MarkdownMessage: React.FC<{ className: string; content: string }> = ({
  className,
  content
}) => (
  <div className={className}>
    <Markdown options={markdownOptions}>{content}</Markdown>
  </div>
)

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

const ToolSequence: React.FC<{ items: ProviderToolItem[] }> = ({ items }) => {
  const tools = items.flatMap((item) => (item.type === 'toolGroup' ? item.tools : [item]))
  const dominantActivity = getDominantActivity(tools)

  return (
    <details className="chat-detail__tool-sequence">
      <summary>
        <span className="chat-detail__tool-icon">
          <ToolTypeIcon activity={dominantActivity} />
        </span>
        <span className="chat-detail__tool-label">{getSequenceLabel(tools)}</span>
        <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
      </summary>
      <div className="chat-detail__tool-sequence-content">
        {items.map((item) => (
          <ToolItem item={item} key={item.id} />
        ))}
      </div>
    </details>
  )
}

const WorkingPlaceholder: React.FC<{ id: string }> = ({ id }) => {
  return (
    <div className="chat-detail__tool-read chat-detail__tool-placeholder">
      <span className="chat-detail__tool-icon">
        <span className="chat-detail__tool-dot" aria-hidden="true" />
      </span>
      <span className="chat-detail__tool-label">{getPlaceholderLabel(id)}</span>
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
    tool.command?.length ?? 0,
    tool.stdout?.length ?? 0,
    tool.diffs.map((diff) => `${diff.path}:${diff.diff.length}`).join(',')
  ].join(':')

const getWorkingItemSignature = (item: ProviderWorkingItem): string => {
  if (item.type === 'message') return `message:${item.id}:${item.content.length}`
  if (item.type === 'toolGroup') {
    return `toolGroup:${item.id}:${item.tools.map(getToolSignature).join('|')}`
  }

  return `tool:${getToolSignature(item)}`
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
  const signature = useMemo(
    () => `${item.status}:${item.items.map(getWorkingItemSignature).join('|')}`,
    [item.items, item.status]
  )
  const showPlaceholder = useSilencePlaceholder(
    signature,
    item.status === 'working',
    blocks.length === 0
  )
  const label =
    item.status === 'stopped' ? 'Stopped' : item.status === 'worked' ? 'Worked' : 'Working'
  const heading = (
    <span className="chat-detail__working-label">
      {item.status === 'working' && (
        <LoaderCircle className="chat-detail__working-spinner" aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  )

  if (blocks.length === 0) {
    if (showPlaceholder) {
      return (
        <details
          className={`chat-detail__step chat-detail__working chat-detail__working--${item.status}`}
          open
        >
          <summary>
            {heading}
            <ChevronRight className="chat-detail__summary-chevron" aria-hidden="true" />
          </summary>
          <div className="chat-detail__step-content">
            <WorkingPlaceholder id={item.id} />
          </div>
        </details>
      )
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
      open={item.status === 'working'}
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
              <ToolSequence items={block.items} key={block.items[0]?.id} />
            ) : (
              block.items.map((toolItem) => <ToolItem item={toolItem} key={toolItem.id} />)
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

export const ChatDetailItem: React.FC<ChatDetailItemProps> = ({
  canEditOwnMessages = false,
  item,
  onEditMessage
}) => {
  if (item.type === 'message') {
    const canEdit = item.role === 'user' && canEditOwnMessages && Boolean(onEditMessage)

    if (canEdit) {
      return (
        <div className="chat-detail__message-row chat-detail__message-row--user">
          <button
            className="chat-detail__message-edit"
            type="button"
            aria-label="Edit message"
            title="Edit message"
            onClick={() => onEditMessage?.(item)}
          >
            <Pencil aria-hidden="true" />
          </button>
          <MarkdownMessage
            className={`chat-detail__message chat-detail__message--${item.role}`}
            content={item.content}
          />
        </div>
      )
    }

    return (
      <MarkdownMessage
        className={`chat-detail__message chat-detail__message--${item.role}`}
        content={item.content}
      />
    )
  }

  return <WorkingStep item={item} />
}

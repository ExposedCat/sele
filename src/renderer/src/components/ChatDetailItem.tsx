import { useState } from 'react'
import type {
  ProviderChatItem,
  ProviderWorkingItem,
  ProviderWorkingStep,
  ProviderWorkingTool
} from '../../../shared/provider'
import './ChatDetailItem.css'

type ChatDetailItemProps = {
  item: ProviderChatItem
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
  <div className="chat-detail__activity-content">
    {tools.map((tool) => (
      <section key={tool.id}>
        {tool.command && (
          <>
            <h3>Command</h3>
            <pre>{tool.command}</pre>
          </>
        )}
        {tool.stdout && (
          <>
            <h3>Output</h3>
            <pre>{tool.stdout}</pre>
          </>
        )}
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
        <h3>Raw output</h3>
        <pre>{formatRawOutput(tool.rawOutput)}</pre>
      </section>
    ))}
  </div>
)

const Activity: React.FC<{ label: string; tools: ProviderWorkingTool[] }> = ({ label, tools }) => {
  const activity = tools[0]?.activity

  if (
    activity !== 'edit' &&
    activity !== 'command' &&
    activity !== 'search' &&
    activity !== 'git' &&
    activity !== 'other'
  ) {
    return <p className="chat-detail__activity-line">{label}</p>
  }

  const detailLabel = label || tools[0]?.toolId
  const content =
    activity === 'edit' ? (
      <DiffContent tools={tools} />
    ) : activity === 'command' || activity === 'search' || activity === 'git' ? (
      <CommandContent tools={tools} />
    ) : (
      <RawContent tools={tools} />
    )

  return (
    <details className="chat-detail__tool-group">
      <summary>{detailLabel}</summary>
      {content}
    </details>
  )
}

const WorkingItem: React.FC<{ item: ProviderWorkingItem }> = ({ item }) => {
  if (item.type === 'message') {
    return <p className="chat-detail__working-message">{item.content}</p>
  }

  return <Activity label={item.label} tools={item.type === 'toolGroup' ? item.tools : [item]} />
}

const WorkingStep: React.FC<{ item: ProviderWorkingStep }> = ({ item }) => {
  const [open, setOpen] = useState(false)

  return (
    <details
      className="chat-detail__step chat-detail__working"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>Working</summary>
      <div className="chat-detail__step-content">
        {item.items.map((workingItem) => (
          <WorkingItem item={workingItem} key={workingItem.id} />
        ))}
      </div>
    </details>
  )
}

export const ChatDetailItem: React.FC<ChatDetailItemProps> = ({ item }) => {
  if (item.type === 'message') {
    return (
      <p className={`chat-detail__message chat-detail__message--${item.role}`}>{item.content}</p>
    )
  }

  return <WorkingStep item={item} />
}

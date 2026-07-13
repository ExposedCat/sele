import type {
  ProviderChatItem,
  ProviderWorkingItem,
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

const Activity: React.FC<{ label: string; tools: ProviderWorkingTool[] }> = ({ label, tools }) => {
  const activity = tools[0]?.activity

  if (activity !== 'edit' && activity !== 'command') {
    return <p className="chat-detail__activity-line">{label}</p>
  }

  return (
    <div className="chat-detail__tool-group">
      <p className="chat-detail__activity-line">{label}</p>
      {activity === 'edit' ? <DiffContent tools={tools} /> : <CommandContent tools={tools} />}
    </div>
  )
}

const WorkingItem: React.FC<{ item: ProviderWorkingItem }> = ({ item }) => {
  if (item.type === 'message') {
    return <p className="chat-detail__working-message">{item.content}</p>
  }

  return <Activity label={item.label} tools={item.type === 'toolGroup' ? item.tools : [item]} />
}

export const ChatDetailItem: React.FC<ChatDetailItemProps> = ({ item }) => {
  if (item.type === 'message') {
    return (
      <p className={`chat-detail__message chat-detail__message--${item.role}`}>{item.content}</p>
    )
  }

  return (
    <details className="chat-detail__step chat-detail__working">
      <summary>Working</summary>
      <div className="chat-detail__step-content">
        {item.items.map((workingItem) => (
          <WorkingItem item={workingItem} key={workingItem.id} />
        ))}
      </div>
    </details>
  )
}

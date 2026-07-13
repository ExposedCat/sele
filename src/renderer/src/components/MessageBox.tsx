import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import type {
  ProviderAccessMode,
  ProviderModelId,
  ProviderReasoningEffort
} from '../../../shared/provider'
import './MessageBox.css'

type MessageBoxProps = {
  accessMode: ProviderAccessMode
  active?: boolean
  disabled?: boolean
  error?: string | null
  model: ProviderModelId
  pending?: boolean
  reasoningEffort: ProviderReasoningEffort
  onAccessModeChange: (accessMode: ProviderAccessMode) => void
  onModelChange: (model: ProviderModelId) => void
  onReasoningEffortChange: (reasoningEffort: ProviderReasoningEffort) => void
  onStop?: () => Promise<void> | void
  onSend: (message: string) => Promise<void> | void
}

const minTextareaHeight = 44
const maxTextareaHeight = 180

const accessModeLabels = {
  sandbox: 'Sandbox',
  auto: 'Auto approve',
  full: 'Full access'
} satisfies Record<ProviderAccessMode, string>

const modelLabels = {
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.3-codex-spark': 'GPT-5.3 Spark'
} satisfies Record<ProviderModelId, string>

const reasoningEffortLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X High'
} satisfies Record<ProviderReasoningEffort, string>

export const MessageBox: React.FC<MessageBoxProps> = ({
  accessMode,
  active = false,
  disabled = false,
  error = null,
  model,
  pending = false,
  reasoningEffort,
  onAccessModeChange,
  onModelChange,
  onReasoningEffortChange,
  onStop,
  onSend
}) => {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = `${minTextareaHeight}px`
    textarea.style.overflowY = 'hidden'

    const nextHeight = Math.min(textarea.scrollHeight, maxTextareaHeight)
    textarea.style.height = `${Math.max(minTextareaHeight, nextHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxTextareaHeight ? 'auto' : 'hidden'
  }, [message])

  const submitMessage = (): void => {
    const nextMessage = message.trim()
    if (!nextMessage || disabled || pending) return

    setMessage('')
    void onSend(nextMessage)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    submitMessage()
  }

  const handleStop = (): void => {
    if (!onStop || pending) return
    void onStop()
  }

  const buttonLabel = active ? 'Stop response' : 'Send message'

  return (
    <form className="message-box" aria-busy={pending} onSubmit={handleSubmit}>
      {error && (
        <p className="message-box__error" role="status">
          {error}
        </p>
      )}
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      <label className="sr-only" htmlFor="access-mode">
        Access mode
      </label>
      <label className="sr-only" htmlFor="model-mode">
        Model
      </label>
      <label className="sr-only" htmlFor="reasoning-effort">
        Reasoning effort
      </label>
      <div className="message-box__input">
        <textarea
          ref={textareaRef}
          id="message-input"
          disabled={disabled || pending}
          rows={1}
          value={message}
          placeholder="Message the assistant"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

            event.preventDefault()
            submitMessage()
          }}
        />
        <div className="message-box__controls">
          <select
            id="access-mode"
            className="message-box__select message-box__access"
            disabled={active || pending}
            value={accessMode}
            title={accessModeLabels[accessMode]}
            onChange={(event) => onAccessModeChange(event.target.value as ProviderAccessMode)}
          >
            {Object.entries(accessModeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="message-box__send-controls">
            <select
              id="model-mode"
              className="message-box__select message-box__model"
              disabled={active || pending}
              value={model}
              title={modelLabels[model]}
              onChange={(event) => onModelChange(event.target.value as ProviderModelId)}
            >
              {Object.entries(modelLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              id="reasoning-effort"
              className="message-box__select message-box__reasoning"
              disabled={active || pending}
              value={reasoningEffort}
              title={`${reasoningEffortLabels[reasoningEffort]} reasoning`}
              onChange={(event) =>
                onReasoningEffortChange(event.target.value as ProviderReasoningEffort)
              }
            >
              {Object.entries(reasoningEffortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="message-box__action"
              type={active ? 'button' : 'submit'}
              aria-label={buttonLabel}
              title={buttonLabel}
              disabled={active ? pending || !onStop : disabled || pending || !message.trim()}
              onClick={active ? handleStop : undefined}
            >
              {active ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}

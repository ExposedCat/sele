import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import type {
  ProviderAccessMode,
  ProviderModelId,
  ProviderReasoningEffort
} from '../../../shared/provider'
import { Button } from './Button'
import { Dropdown, type DropdownOption } from './Dropdown'
import './MessageBox.css'

type MessageBoxProps = {
  accessMode: ProviderAccessMode
  active?: boolean
  autoFocus?: boolean
  disabled?: boolean
  editSession?: { id: string; content: string } | null
  error?: string | null
  model: ProviderModelId
  pending?: boolean
  reasoningEffort: ProviderReasoningEffort
  onAccessModeChange: (accessMode: ProviderAccessMode) => void
  onCancelEdit?: () => void
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

const getDropdownOptions = <TValue extends string>(
  labels: Record<TValue, string>
): DropdownOption<TValue>[] =>
  Object.entries(labels).map(([value, label]) => ({
    value: value as TValue,
    label: label as string
  }))

const accessModeOptions = getDropdownOptions(accessModeLabels)
const modelOptions = getDropdownOptions(modelLabels)
const reasoningEffortOptions = getDropdownOptions(reasoningEffortLabels)

export const MessageBox: React.FC<MessageBoxProps> = ({
  accessMode,
  active = false,
  autoFocus = false,
  disabled = false,
  editSession = null,
  error = null,
  model,
  pending = false,
  reasoningEffort,
  onAccessModeChange,
  onCancelEdit,
  onModelChange,
  onReasoningEffortChange,
  onStop,
  onSend
}) => {
  const [message, setMessage] = useState('')
  const editSessionIdRef = useRef<string | null>(null)
  const messageRef = useRef(message)
  const messageBeforeEditRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editing = Boolean(editSession)

  useEffect(() => {
    messageRef.current = message
  }, [message])

  useEffect(() => {
    if (!editSession) {
      editSessionIdRef.current = null
      messageBeforeEditRef.current = null
      return
    }

    if (editSessionIdRef.current === editSession.id) return

    editSessionIdRef.current = editSession.id
    messageBeforeEditRef.current = messageRef.current
    setMessage(editSession.content)

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [editSession])

  useEffect(() => {
    if (!autoFocus || disabled || pending) return

    const animationFrame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [autoFocus, disabled, pending])

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

    if (editing) {
      void Promise.resolve(onSend(nextMessage))
        .then(() => {
          setMessage(messageBeforeEditRef.current ?? '')
          editSessionIdRef.current = null
          messageBeforeEditRef.current = null
        })
        .catch(() => {})
      return
    }

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

  const handleCancelEdit = (): void => {
    setMessage(messageBeforeEditRef.current ?? '')
    editSessionIdRef.current = null
    messageBeforeEditRef.current = null
    onCancelEdit?.()
  }

  const buttonLabel = active ? 'Stop response' : editing ? 'Save edit' : 'Send message'
  const selectorsDisabled = active || pending || editing

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
          <span className="message-box__select message-box__access">
            <Dropdown
              id="access-mode"
              disabled={selectorsDisabled}
              fill
              options={accessModeOptions}
              placement="top"
              value={accessMode}
              title={accessModeLabels[accessMode]}
              onChange={onAccessModeChange}
            />
          </span>
          <div className="message-box__send-controls">
            <span className="message-box__select message-box__model">
              <Dropdown
                id="model-mode"
                disabled={selectorsDisabled}
                fill
                options={modelOptions}
                placement="top"
                value={model}
                title={modelLabels[model]}
                onChange={onModelChange}
              />
            </span>
            <span className="message-box__select message-box__reasoning">
              <Dropdown
                id="reasoning-effort"
                disabled={selectorsDisabled}
                fill
                options={reasoningEffortOptions}
                placement="top"
                value={reasoningEffort}
                title={`${reasoningEffortLabels[reasoningEffort]} reasoning`}
                onChange={onReasoningEffortChange}
              />
            </span>
            {editing && (
              <Button
                disabled={pending}
                callback={handleCancelEdit}
                label="Cancel"
                theme="secondary"
              />
            )}
            <Button
              aria-label={buttonLabel}
              title={buttonLabel}
              disabled={active ? pending || !onStop : disabled || pending || !message.trim()}
              callback={active ? handleStop : submitMessage}
              icon={active ? <Square aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              theme="primary"
            />
          </div>
        </div>
      </div>
    </form>
  )
}

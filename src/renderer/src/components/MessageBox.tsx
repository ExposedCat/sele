import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  BadgeCheck,
  Bot,
  Flame,
  Gauge,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  UnlockKeyhole,
  Zap
} from 'lucide-react'
import type {
  ProviderAccessMode,
  ProviderAccessModeOption,
  ProviderModel,
  ProviderModelId,
  ProviderReasoningEffort
} from '../../../shared/provider'
import { Button } from './Button'
import { Dropdown, type DropdownOption } from './Dropdown'
import './MessageBox.css'

type MessageBoxProps = {
  accessMode: ProviderAccessMode
  accessModes: ProviderAccessModeOption[]
  active?: boolean
  autoFocus?: boolean
  disabled?: boolean
  editSession?: { id: string; content: string } | null
  error?: string | null
  model: ProviderModelId
  models: ProviderModel[]
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

const reasoningEffortLabels = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X High',
  max: 'Max',
  ultra: 'Ultra'
} satisfies Record<string, string>

const accessModeIcons = {
  sandbox: <Shield aria-hidden="true" />,
  auto: <BadgeCheck aria-hidden="true" />,
  full: <UnlockKeyhole aria-hidden="true" />
} satisfies Record<ProviderAccessMode, ReactNode>

const reasoningEffortIcons = {
  none: <Gauge aria-hidden="true" />,
  minimal: <Gauge aria-hidden="true" />,
  low: <Gauge aria-hidden="true" />,
  medium: <SlidersHorizontal aria-hidden="true" />,
  high: <Zap aria-hidden="true" />,
  xhigh: <Flame aria-hidden="true" />,
  max: <Sparkles aria-hidden="true" />,
  ultra: <Sparkles aria-hidden="true" />
} satisfies Record<string, ReactNode>

const getReasoningEffortLabel = (reasoningEffort: ProviderReasoningEffort): string => {
  const fallbackLabel =
    reasoningEffort
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
      .join(' ') || reasoningEffort

  return reasoningEffortLabels[reasoningEffort] ?? fallbackLabel
}

const getReasoningEffortOptionLabel = (
  reasoningEffort: ProviderReasoningEffort,
  label: string
): string => {
  if (reasoningEffortLabels[reasoningEffort]) return reasoningEffortLabels[reasoningEffort]
  if (label && label !== reasoningEffort) return label

  return getReasoningEffortLabel(reasoningEffort)
}

const getReasoningEffortIcon = (reasoningEffort: ProviderReasoningEffort): ReactNode =>
  reasoningEffortIcons[reasoningEffort] ?? <SlidersHorizontal aria-hidden="true" />

const formatModelLabel = (label: string): string => label.replace(/-/g, ' ')

const formatAccessModeLabel = (mode: ProviderAccessMode): string =>
  mode
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ') || mode

export const MessageBox: React.FC<MessageBoxProps> = ({
  accessMode,
  accessModes,
  active = false,
  autoFocus = false,
  disabled = false,
  editSession = null,
  error = null,
  model,
  models,
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
  const selectedAccessMode = accessModes.find((candidateMode) => candidateMode.id === accessMode)
  const accessModeOptions = accessModes.map((mode): DropdownOption<ProviderAccessMode> => ({
    value: mode.id,
    label: mode.label,
    menuLabel: mode.isDefault ? `${mode.label} (default)` : mode.label,
    description: mode.description || undefined,
    icon: accessModeIcons[mode.id]
  }))
  const displayedAccessModeOptions = accessModeOptions.some((option) => option.value === accessMode)
    ? accessModeOptions
    : [
        ...accessModeOptions,
        {
          value: accessMode,
          label: formatAccessModeLabel(accessMode),
          icon: accessModeIcons[accessMode]
        }
      ]
  const selectedModel = models.find((candidateModel) => candidateModel.id === model)
  const modelOptions = models.map((candidateModel): DropdownOption<ProviderModelId> => ({
    value: candidateModel.id,
    label: formatModelLabel(candidateModel.label),
    menuLabel: candidateModel.isDefault
      ? `${formatModelLabel(candidateModel.label)} (default)`
      : formatModelLabel(candidateModel.label),
    description: candidateModel.description || undefined,
    icon: <Bot aria-hidden="true" />
  }))
  const displayedModelOptions = modelOptions.some((option) => option.value === model)
    ? modelOptions
    : [
        ...modelOptions,
        {
          value: model,
          label: formatModelLabel(model),
          icon: <Bot aria-hidden="true" />
        }
      ]
  const supportedReasoningEfforts = selectedModel?.supportedReasoningEfforts ?? []
  const reasoningEffortOptions = supportedReasoningEfforts.map((option) => {
    const label = getReasoningEffortOptionLabel(option.id, option.label)

    return {
      value: option.id,
      label,
      menuLabel: option.isDefault ? `${label} (default)` : label,
      description: option.description || undefined,
      icon: getReasoningEffortIcon(option.id)
    } satisfies DropdownOption<ProviderReasoningEffort>
  })
  const displayedReasoningEffortOptions = reasoningEffortOptions.some(
    (option) => option.value === reasoningEffort
  )
    ? reasoningEffortOptions
    : [
        ...reasoningEffortOptions,
        {
          value: reasoningEffort,
          label: getReasoningEffortLabel(reasoningEffort),
          icon: getReasoningEffortIcon(reasoningEffort)
        }
      ]
  const selectedModelTitle = selectedModel?.description
    ? `${formatModelLabel(selectedModel.label)}: ${selectedModel.description}`
    : formatModelLabel(selectedModel?.label ?? model)
  const selectedAccessModeTitle = selectedAccessMode?.description
    ? `${selectedAccessMode.label}: ${selectedAccessMode.description}`
    : (selectedAccessMode?.label ?? formatAccessModeLabel(accessMode))
  const selectedReasoningEffortLabel = getReasoningEffortLabel(reasoningEffort)

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
          <div className="message-box__selectors">
            <span className="message-box__select message-box__access">
              <Dropdown
                id="access-mode"
                disabled={selectorsDisabled}
                icon={accessModeIcons[accessMode]}
                options={displayedAccessModeOptions}
                placement="top"
                value={accessMode}
                title={selectedAccessModeTitle}
                onChange={onAccessModeChange}
              />
            </span>
            <span className="message-box__select message-box__model">
              <Dropdown
                id="model-mode"
                disabled={selectorsDisabled}
                icon={<Bot aria-hidden="true" />}
                options={displayedModelOptions}
                placement="top"
                value={model}
                title={selectedModelTitle}
                onChange={onModelChange}
              />
            </span>
            <span className="message-box__select message-box__reasoning">
              <Dropdown
                id="reasoning-effort"
                disabled={selectorsDisabled}
                icon={getReasoningEffortIcon(reasoningEffort)}
                options={displayedReasoningEffortOptions}
                placement="top"
                value={reasoningEffort}
                title={`${selectedReasoningEffortLabel} reasoning`}
                onChange={onReasoningEffortChange}
              />
            </span>
          </div>
          <div className="message-box__send-controls">
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

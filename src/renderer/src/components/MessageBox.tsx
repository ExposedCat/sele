import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import './MessageBox.css'

type MessageBoxProps = {
  disabled?: boolean
  error?: string | null
  pending?: boolean
  onSend: (message: string) => Promise<void> | void
}

export const MessageBox: React.FC<MessageBoxProps> = ({
  disabled = false,
  error = null,
  pending = false,
  onSend
}) => {
  const [message, setMessage] = useState('')

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const nextMessage = message.trim()
    if (!nextMessage || disabled || pending) return

    setMessage('')
    void onSend(nextMessage)
  }

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
      <textarea
        id="message-input"
        disabled={disabled || pending}
        rows={1}
        value={message}
        placeholder="Message the assistant"
        onChange={(event) => setMessage(event.target.value)}
      />
      <button
        type="submit"
        aria-label="Send message"
        title="Send message"
        disabled={disabled || pending || !message.trim()}
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </form>
  )
}

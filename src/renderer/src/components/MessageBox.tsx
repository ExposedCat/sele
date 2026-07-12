import { useState } from 'react'

type MessageBoxProps = {
  onSend?: (message: string) => void
}

export const MessageBox: React.FC<MessageBoxProps> = ({ onSend }) => {
  const [message, setMessage] = useState('')
  const disabled = !onSend

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const content = message.trim()
    if (!content) return

    onSend?.(content)
    setMessage('')
  }

  return (
    <form className="message-box" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      <textarea
        id="message-input"
        rows={1}
        value={message}
        placeholder={disabled ? 'Messaging is not available yet' : 'Message the assistant'}
        disabled={disabled}
        onChange={(event) => setMessage(event.target.value)}
      />
      <button type="submit" disabled={disabled || !message.trim()}>
        Send
      </button>
    </form>
  )
}

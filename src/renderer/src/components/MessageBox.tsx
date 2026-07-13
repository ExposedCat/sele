import { useState } from 'react'
import { ArrowUp } from 'lucide-react'
import './MessageBox.css'

export const MessageBox: React.FC = () => {
  const [message, setMessage] = useState('')

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    if (!message.trim()) return

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
        placeholder="Message the assistant"
        onChange={(event) => setMessage(event.target.value)}
      />
      <button
        type="submit"
        aria-label="Send message"
        title="Send message"
        disabled={!message.trim()}
      >
        <ArrowUp aria-hidden="true" />
      </button>
    </form>
  )
}

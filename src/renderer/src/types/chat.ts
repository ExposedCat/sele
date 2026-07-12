export type MessageRole = 'assistant' | 'user'

export type ChatMessage = {
  id: string
  role: MessageRole
  content: string
}

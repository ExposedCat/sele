import type { ChatMessage } from '../types/chat'

export const mockMessages: ChatMessage[] = [
  { id: '1', role: 'assistant', content: 'What would you like to build today?' },
  { id: '2', role: 'user', content: 'I want to prototype an AI research assistant.' },
  { id: '3', role: 'assistant', content: 'Sounds good. What should it help you research?' },
  { id: '4', role: 'user', content: 'Technical topics, with clear summaries and sources.' },
  { id: '5', role: 'assistant', content: 'Should the answers be concise or comprehensive?' },
  { id: '6', role: 'user', content: 'Concise by default, with the option to go deeper.' },
  { id: '7', role: 'assistant', content: 'I can make that the default response style.' },
  {
    id: '8',
    role: 'user',
    content: 'Great. It should also remember the current conversation.'
  },
  {
    id: '9',
    role: 'assistant',
    content: 'Conversation context will stay available within each session.'
  },
  { id: '10', role: 'user', content: 'Perfect. Let’s start with this scaffold.' }
]

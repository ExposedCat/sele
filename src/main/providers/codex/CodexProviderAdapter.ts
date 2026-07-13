import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatStatus,
  ProviderLoginResult
} from '../../../shared/provider'
import type { ProviderAdapter } from '../ProviderAdapter'
import { CodexAppServerClient } from './CodexAppServerClient'
import { getChatItems } from './CodexItemRenderers'
import { loadRolloutHistory } from './CodexRolloutHistory'

type CodexAccount =
  { type: 'apiKey' } | { type: 'chatgpt'; email: string } | { type: 'amazonBedrock' }

type AccountReadResponse = {
  account: CodexAccount | null
  requiresOpenaiAuth: boolean
}

type LoginResponse =
  | { type: 'chatgpt'; loginId: string; authUrl: string }
  | { type: 'apiKey' }
  | { type: 'chatgptDeviceCode'; loginId: string; verificationUrl: string; userCode: string }
  | { type: 'chatgptAuthTokens' }

type CodexThreadStatus =
  | { type: 'notLoaded' | 'idle' | 'systemError' }
  | {
      type: 'active'
      activeFlags: ('waitingOnApproval' | 'waitingOnUserInput')[]
    }

type CodexThread = {
  id: string
  name: string | null
  preview: string
  createdAt: number
  updatedAt: number
  status: CodexThreadStatus
  path: string | null
  turns: {
    id: string
    status: string
  }[]
}

type ThreadListResponse = {
  data: CodexThread[]
}

type ThreadReadResponse = {
  thread: CodexThread
}

const getAccountLabel = (account: CodexAccount): string => {
  if (account.type === 'chatgpt') return account.email
  if (account.type === 'apiKey') return 'OpenAI API key'
  return 'Amazon Bedrock'
}

const getThreadTitle = (thread: CodexThread): string =>
  thread.name?.trim() || thread.preview.trim().split('\n')[0] || 'Untitled chat'

const getThreadStatus = (thread: CodexThread): ProviderChatStatus | null => {
  if (thread.status.type === 'systemError') return 'error'
  if (thread.status.type !== 'active') return null
  if (thread.status.activeFlags.includes('waitingOnApproval')) return 'waitingOnApproval'
  if (thread.status.activeFlags.includes('waitingOnUserInput')) return 'waitingOnUserInput'
  return 'active'
}

export class CodexProviderAdapter implements ProviderAdapter {
  id = 'codex' as const

  private client = new CodexAppServerClient()

  login = async (): Promise<ProviderLoginResult> => {
    const account = await this.client.request<AccountReadResponse>('account/read', {
      refreshToken: false
    })

    if (account.account) {
      return {
        status: 'authenticated',
        account: { label: getAccountLabel(account.account) }
      }
    }

    if (!account.requiresOpenaiAuth) return { status: 'notRequired' }

    const login = await this.client.request<LoginResponse>('account/login/start', {
      type: 'chatgpt'
    })

    if (login.type !== 'chatgpt') {
      throw new Error(`Unsupported Codex login response: ${login.type}`)
    }

    return {
      status: 'pending',
      loginId: login.loginId,
      authUrl: login.authUrl
    }
  }

  getChats = async (): Promise<ProviderChat[]> => {
    const response = await this.client.request<ThreadListResponse>('thread/list', {
      limit: 50,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false
    })

    return response.data.map((thread) => ({
      id: thread.id,
      providerId: this.id,
      title: getThreadTitle(thread),
      preview: thread.preview.trim(),
      createdAt: thread.createdAt * 1_000,
      updatedAt: thread.updatedAt * 1_000,
      status: getThreadStatus(thread)
    }))
  }

  getChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const response = await this.client.request<ThreadReadResponse>('thread/read', {
      threadId: chatId,
      includeTurns: true
    })

    const turnStatuses = new Map(response.thread.turns.map((turn) => [turn.id, turn.status]))
    const turns = (await loadRolloutHistory(response.thread.path)).map((turn) => ({
      ...turn,
      status: turnStatuses.get(turn.id) ?? null
    }))

    return {
      id: response.thread.id,
      title: getThreadTitle(response.thread),
      items: getChatItems(turns)
    }
  }

  dispose = (): void => {
    this.client.dispose()
  }
}

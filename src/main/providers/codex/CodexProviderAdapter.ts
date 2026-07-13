import type {
  ProviderChatListOptions,
  ProviderChatPage,
  ProviderChatDetail,
  ProviderChatStatus,
  ProviderCapabilities,
  ProviderLoginResult,
  ProviderTurnOptions
} from '../../../shared/provider'
import type { ProviderAdapter } from '../ProviderAdapter'
import { CodexAppServerClient, type RpcNotification } from './CodexAppServerClient'
import { getChatItems, type CodexThreadItem, type CodexTurn } from './CodexItemRenderers'
import { loadRolloutCwd, loadRolloutHistory } from './CodexRolloutHistory'
import { loadSessionThreadName, loadSessionThreadNames } from './CodexSessionIndex'
import { getNestedToolCalls, isPatchToolCall } from './CodexToolCalls'

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
  name?: string | null
  preview: string
  createdAt: number
  updatedAt: number
  cwd?: string | null
  status: CodexThreadStatus
  path: string | null
  turns: CodexTurn[]
}

type ThreadListResponse = {
  data: CodexThread[]
  nextCursor: string | null
}

type ThreadReadResponse = {
  thread: CodexThread
}

type ThreadStartResponse = {
  thread: CodexThread
}

type ThreadResumeResponse = {
  thread: CodexThread
}

type TurnStartResponse = {
  turn: CodexTurn
}

type ThreadRollbackResponse = {
  thread: CodexThread
}

type CodexThreadAccessOptions = {
  approvalPolicy: 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
  sandbox: 'workspace-write' | 'danger-full-access'
}

type CodexThreadModelOptions = {
  model: ProviderTurnOptions['model']
}

type CodexTurnAccessOptions = {
  approvalPolicy: 'on-request' | 'on-failure' | 'never'
  approvalsReviewer?: 'user' | 'auto_review'
  sandboxPolicy: { type: 'workspaceWrite'; networkAccess: boolean } | { type: 'dangerFullAccess' }
}

type CodexTurnModelOptions = {
  model: ProviderTurnOptions['model']
  reasoningEffort: ProviderTurnOptions['reasoningEffort']
}

type ThreadNotificationParams = {
  threadId?: unknown
  status?: unknown
  threadName?: unknown
  thread_name?: unknown
  name?: unknown
}

type TurnNotificationParams = {
  threadId?: unknown
  turn?: unknown
}

type ItemNotificationParams = {
  threadId?: unknown
  turnId?: unknown
  item?: unknown
}

type AgentMessageDeltaParams = {
  threadId?: unknown
  turnId?: unknown
  itemId?: unknown
  delta?: unknown
}

type ReasoningSummaryDeltaParams = AgentMessageDeltaParams & {
  summaryIndex?: unknown
}

type FileChangePatchParams = {
  threadId?: unknown
  turnId?: unknown
  itemId?: unknown
  changes?: unknown
}

type RawResponseItemParams = {
  threadId?: unknown
  turnId?: unknown
  item?: unknown
}

const getAccountLabel = (account: CodexAccount): string => {
  if (account.type === 'chatgpt') return account.email
  if (account.type === 'apiKey') return 'OpenAI API key'
  return 'Amazon Bedrock'
}

const getStringValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const getThreadName = (thread: CodexThread): string | null => {
  const threadFields = thread as CodexThread & {
    threadName?: unknown
    thread_name?: unknown
    title?: unknown
  }

  return (
    getStringValue(thread.name) ??
    getStringValue(threadFields.thread_name) ??
    getStringValue(threadFields.threadName) ??
    getStringValue(threadFields.title)
  )
}

const getThreadTitle = (thread: CodexThread): string => {
  const previewTitle = thread.preview.trim().split('\n')[0]
  return getThreadName(thread) ?? (previewTitle || 'Untitled chat')
}

const getThreadNotificationName = (params: ThreadNotificationParams): string | null =>
  getStringValue(params.threadName) ??
  getStringValue(params.thread_name) ??
  getStringValue(params.name)

const getThreadStatus = (thread: CodexThread): ProviderChatStatus | null => {
  if (thread.status.type === 'systemError') return 'error'
  if (thread.status.type !== 'active') return null
  if (thread.status.activeFlags.includes('waitingOnApproval')) return 'waitingOnApproval'
  if (thread.status.activeFlags.includes('waitingOnUserInput')) return 'waitingOnUserInput'
  return 'active'
}

const getThreadApiCwd = (thread: CodexThread): string | null => {
  const cwd = thread.cwd?.trim()
  return cwd || null
}

const getThreadTurns = (thread: CodexThread): CodexTurn[] =>
  Array.isArray(thread.turns) ? thread.turns : []

const nowSeconds = (): number => Math.floor(Date.now() / 1_000)

const getThreadId = (params: { threadId?: unknown }): string | null =>
  typeof params.threadId === 'string' ? params.threadId : null

const getTurnId = (params: { turnId?: unknown }): string | null =>
  typeof params.turnId === 'string' ? params.turnId : null

const getItemId = (params: { itemId?: unknown }): string | null =>
  typeof params.itemId === 'string' ? params.itemId : null

const getDelta = (params: { delta?: unknown }): string | null =>
  typeof params.delta === 'string' ? params.delta : null

const getRawResponseMessage = (
  item: unknown
): { text: string; phase: CodexThreadItem['phase'] } | null => {
  if (!item || typeof item !== 'object') return null

  const message = item as {
    type?: unknown
    role?: unknown
    content?: unknown
    phase?: unknown
  }

  if (
    message.type !== 'message' ||
    message.role !== 'assistant' ||
    !Array.isArray(message.content)
  ) {
    return null
  }

  const text = message.content
    .map((contentItem) => {
      if (!contentItem || typeof contentItem !== 'object') return ''
      const candidate = contentItem as { type?: unknown; text?: unknown }
      return candidate.type === 'output_text' && typeof candidate.text === 'string'
        ? candidate.text
        : ''
    })
    .join('')
    .trim()

  if (!text) return null

  const phase =
    message.phase === 'commentary' || message.phase === 'final_answer' ? message.phase : null

  return { text, phase }
}

const isPendingUserMessage = (item: CodexThreadItem): boolean =>
  item.type === 'userMessage' && item.id.startsWith('pending:')

const hasUserMessage = (items: CodexThreadItem[]): boolean =>
  items.some((item) => item.type === 'userMessage')

const codexCapabilities = {
  editMessages: true
} satisfies ProviderCapabilities

const createUserTextInput = (
  text: string
): Array<{ type: 'text'; text: string; text_elements: [] }> => [
  { type: 'text', text, text_elements: [] }
]

const getAccessMode = (options?: ProviderTurnOptions): ProviderTurnOptions['accessMode'] =>
  options?.accessMode ?? 'sandbox'

const getThreadModelOptions = (options?: ProviderTurnOptions): CodexThreadModelOptions => ({
  model: options?.model ?? 'gpt-5.5'
})

const getTurnModelOptions = (options?: ProviderTurnOptions): CodexTurnModelOptions => ({
  model: options?.model ?? 'gpt-5.5',
  reasoningEffort: options?.reasoningEffort ?? 'xhigh'
})

const getThreadAccessOptions = (options?: ProviderTurnOptions): CodexThreadAccessOptions => {
  const accessMode = getAccessMode(options)
  if (accessMode === 'full') {
    return {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access'
    }
  }

  if (accessMode === 'auto') {
    return {
      approvalPolicy: 'on-failure',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write'
    }
  }

  return {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: 'workspace-write'
  }
}

const getTurnAccessOptions = (options?: ProviderTurnOptions): CodexTurnAccessOptions => {
  const accessMode = getAccessMode(options)
  if (accessMode === 'full') {
    return {
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' }
    }
  }

  if (accessMode === 'auto') {
    return {
      approvalPolicy: 'on-failure',
      approvalsReviewer: 'auto_review',
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false }
    }
  }

  return {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'workspaceWrite', networkAccess: false }
  }
}

export class CodexProviderAdapter implements ProviderAdapter {
  id = 'codex' as const

  private client = new CodexAppServerClient()
  private disposeNotificationListener: (() => void) | null = null
  private chatUpdatedListeners = new Set<(detail: ProviderChatDetail) => void>()
  private threads = new Map<string, CodexThread>()
  private pendingTurnIds = new Map<string, string>()
  private activeTurnIds = new Map<string, string>()
  private chatUpdatedTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private rolledBackTurnIds = new Map<string, Set<string>>()

  constructor() {
    this.disposeNotificationListener = this.client.onNotification(this.handleNotification)
  }

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

  getChats = async (options: ProviderChatListOptions = {}): Promise<ProviderChatPage> => {
    const response = await this.client.request<ThreadListResponse>('thread/list', {
      cursor: options.cursor ?? null,
      limit: options.limit ?? 50,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false
    })

    const threadNames = await loadSessionThreadNames(response.data.map((thread) => thread.id))
    const chats = await Promise.all(
      response.data.map(async (thread) => {
        const namedThread = this.withResolvedThreadName(thread, threadNames.get(thread.id) ?? null)

        return {
          id: namedThread.id,
          providerId: this.id,
          title: getThreadTitle(namedThread),
          preview: namedThread.preview.trim(),
          cwd: await this.resolveThreadCwd(namedThread),
          createdAt: namedThread.createdAt * 1_000,
          updatedAt: namedThread.updatedAt * 1_000,
          status: getThreadStatus(namedThread),
          pinned: false,
          done: false
        }
      })
    )

    return {
      chats,
      nextCursor: response.nextCursor ?? null
    }
  }

  getChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const response = await this.client.request<ThreadReadResponse>('thread/read', {
      threadId: chatId,
      includeTurns: true
    })

    const [cwd, name, turns] = await Promise.all([
      this.resolveThreadCwd(response.thread),
      this.resolveThreadName(response.thread),
      this.getTurnsForThread(response.thread)
    ])
    const thread = {
      ...response.thread,
      name,
      cwd,
      turns: this.filterRolledBackTurns(response.thread.id, turns)
    }
    this.cacheThread(thread)

    return this.createChatDetail(thread)
  }

  startChat = async (
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot start a chat with an empty message')

    const startedThread = await this.client.request<ThreadStartResponse>('thread/start', {
      cwd: options?.cwd,
      ...getThreadAccessOptions(options),
      ...getThreadModelOptions(options)
    })
    const [cwd, name, turns] = await Promise.all([
      this.resolveThreadCwd(startedThread.thread, options?.cwd ?? null),
      this.resolveThreadName(startedThread.thread),
      this.getTurnsForThread(startedThread.thread)
    ])
    const thread = {
      ...startedThread.thread,
      name,
      cwd,
      status: { type: 'active', activeFlags: [] },
      turns
    } satisfies CodexThread
    this.cacheThread(thread)

    const pendingTurn = this.addPendingTurn(thread.id, text)
    if (pendingTurn) this.emitChatUpdated(thread.id)

    try {
      const startedTurn = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: thread.id,
        cwd: options?.cwd,
        input: createUserTextInput(text),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.activeTurnIds.set(thread.id, startedTurn.turn.id)
      this.replacePendingTurn(thread.id, pendingTurn?.id ?? null, startedTurn.turn)
      this.pendingTurnIds.delete(thread.id)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(thread.id, pendingTurn.id)
      throw error
    }

    const detail = this.getCachedChatDetail(thread.id)
    if (!detail) throw new Error('Unable to start chat')

    this.emitChatUpdated(thread.id)
    return detail
  }

  continueChat = async (
    chatId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot continue a chat with an empty message')

    const pendingTurn = this.addPendingTurn(chatId, text)
    if (pendingTurn) this.emitChatUpdated(chatId)

    try {
      const existingCwd = this.threads.get(chatId)?.cwd ?? null
      await this.resumeThreadForMutation(chatId, options, existingCwd)

      const started = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: chatId,
        input: createUserTextInput(text),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.activeTurnIds.set(chatId, started.turn.id)
      this.replacePendingTurn(chatId, pendingTurn?.id ?? null, started.turn)
      this.pendingTurnIds.delete(chatId)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(chatId, pendingTurn.id)
      throw error
    }

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to continue chat')

    this.emitChatUpdated(chatId)
    return detail
  }

  editMessage = async (
    chatId: string,
    messageId: string,
    message: string,
    options?: ProviderTurnOptions
  ): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot edit a message to empty content')

    if (!this.threads.has(chatId)) {
      await this.getChat(chatId)
    }

    let thread = this.threads.get(chatId)
    if (!thread) throw new Error('Unable to load chat for editing')

    thread = await this.resumeThreadForMutation(chatId, options, thread.cwd ?? null)

    const targetTurnIndex = this.findUserMessageTurnIndex(thread, messageId)
    if (targetTurnIndex < 0) throw new Error('Message cannot be edited')

    const numTurns = thread.turns.length - targetTurnIndex
    if (numTurns < 1) throw new Error('Message cannot be edited')

    const rolledBackTurnIds = new Set(thread.turns.slice(targetTurnIndex).map((turn) => turn.id))
    const rollback = await this.client.request<ThreadRollbackResponse>('thread/rollback', {
      threadId: chatId,
      numTurns
    })
    const [cwd, name] = await Promise.all([
      this.resolveThreadCwd(rollback.thread, thread.cwd ?? null),
      this.resolveThreadName(rollback.thread)
    ])
    this.rememberRolledBackTurns(chatId, rolledBackTurnIds)
    this.cacheThread({
      ...rollback.thread,
      name,
      cwd,
      turns: thread.turns.slice(0, targetTurnIndex)
    })
    this.emitChatUpdated(chatId)

    const pendingTurn = this.addPendingTurn(chatId, text)
    if (pendingTurn) this.emitChatUpdated(chatId)

    try {
      const started = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: chatId,
        input: createUserTextInput(text),
        ...getTurnModelOptions(options),
        ...getTurnAccessOptions(options)
      })

      this.allowRolledBackTurn(chatId, started.turn.id)
      this.activeTurnIds.set(chatId, started.turn.id)
      this.replacePendingTurn(chatId, pendingTurn?.id ?? null, started.turn)
      this.pendingTurnIds.delete(chatId)
    } catch (error) {
      if (pendingTurn) this.removePendingTurn(chatId, pendingTurn.id)
      throw error
    }

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to edit message')

    this.emitChatUpdated(chatId)
    return detail
  }

  stopChat = async (chatId: string): Promise<ProviderChatDetail> => {
    const turnId = this.getActiveTurnId(chatId)
    if (!turnId) throw new Error('No active turn to stop')

    await this.client.request('turn/interrupt', {
      threadId: chatId,
      turnId
    })

    this.activeTurnIds.delete(chatId)
    this.markTurnInterrupted(chatId, turnId)
    this.setThreadStatus(chatId, { type: 'idle' })

    const detail = this.getCachedChatDetail(chatId)
    if (!detail) throw new Error('Unable to stop chat')

    this.emitChatUpdated(chatId)
    return detail
  }

  onChatUpdated = (listener: (detail: ProviderChatDetail) => void): (() => void) => {
    this.chatUpdatedListeners.add(listener)
    return () => this.chatUpdatedListeners.delete(listener)
  }

  dispose = (): void => {
    this.disposeNotificationListener?.()
    this.disposeNotificationListener = null
    this.chatUpdatedTimers.forEach((timer) => clearTimeout(timer))
    this.chatUpdatedTimers.clear()
    this.client.dispose()
  }

  private resolveThreadCwd = async (
    thread: CodexThread,
    fallbackCwd: string | null = null
  ): Promise<string | null> =>
    getThreadApiCwd(thread) ?? fallbackCwd ?? (await loadRolloutCwd(thread.path))

  private getTurnsForThread = async (thread: CodexThread): Promise<CodexTurn[]> => {
    const structuredTurns = getThreadTurns(thread)
    if (structuredTurns.length > 0) return structuredTurns

    return loadRolloutHistory(thread.path)
  }

  private createChatDetail = (thread: CodexThread): ProviderChatDetail => ({
    id: thread.id,
    title: getThreadTitle(thread),
    cwd: getThreadApiCwd(thread),
    status: getThreadStatus(thread),
    pinned: false,
    done: false,
    capabilities: codexCapabilities,
    items: getChatItems(thread.turns)
  })

  private cacheThread = (thread: CodexThread): void => {
    this.threads.set(thread.id, thread)
  }

  private getCachedChatDetail = (threadId: string): ProviderChatDetail | null => {
    const thread = this.threads.get(threadId)
    return thread ? this.createChatDetail(thread) : null
  }

  private rememberRolledBackTurns = (threadId: string, turnIds: Set<string>): void => {
    if (turnIds.size === 0) return

    const rolledBackTurnIds = this.rolledBackTurnIds.get(threadId) ?? new Set<string>()
    turnIds.forEach((turnId) => rolledBackTurnIds.add(turnId))
    this.rolledBackTurnIds.set(threadId, rolledBackTurnIds)

    const activeTurnId = this.activeTurnIds.get(threadId)
    if (activeTurnId && turnIds.has(activeTurnId)) this.activeTurnIds.delete(threadId)

    const pendingTurnId = this.pendingTurnIds.get(threadId)
    if (pendingTurnId && turnIds.has(pendingTurnId)) this.pendingTurnIds.delete(threadId)
  }

  private allowRolledBackTurn = (threadId: string, turnId: string): void => {
    const rolledBackTurnIds = this.rolledBackTurnIds.get(threadId)
    if (!rolledBackTurnIds) return

    rolledBackTurnIds.delete(turnId)
    if (rolledBackTurnIds.size === 0) this.rolledBackTurnIds.delete(threadId)
  }

  private isRolledBackTurn = (threadId: string, turnId: string): boolean =>
    this.rolledBackTurnIds.get(threadId)?.has(turnId) ?? false

  private filterRolledBackTurns = (threadId: string, turns: CodexTurn[]): CodexTurn[] => {
    const rolledBackTurnIds = this.rolledBackTurnIds.get(threadId)
    if (!rolledBackTurnIds || rolledBackTurnIds.size === 0) return turns

    return turns.filter((turn) => !rolledBackTurnIds.has(turn.id))
  }

  private findUserMessageTurnIndex = (thread: CodexThread, messageId: string): number =>
    thread.turns.findIndex((turn) =>
      turn.items.some(
        (item) => item.type === 'userMessage' && `${turn.id}:${item.id}` === messageId
      )
    )

  private withResolvedThreadName = (
    thread: CodexThread,
    fallbackName: string | null
  ): CodexThread => ({
    ...thread,
    name: fallbackName ?? getThreadName(thread)
  })

  private resolveThreadName = async (thread: CodexThread): Promise<string | null> =>
    (await loadSessionThreadName(thread.id)) ?? getThreadName(thread)

  private resumeThreadForMutation = async (
    threadId: string,
    options: ProviderTurnOptions | undefined,
    fallbackCwd: string | null
  ): Promise<CodexThread> => {
    const existingThread = this.threads.get(threadId) ?? null
    const resume = await this.client.request<ThreadResumeResponse>('thread/resume', {
      threadId,
      ...getThreadAccessOptions(options)
    })
    const [cwd, name, resumedTurns] = await Promise.all([
      this.resolveThreadCwd(resume.thread, fallbackCwd),
      this.resolveThreadName(resume.thread),
      existingThread ? Promise.resolve<CodexTurn[]>([]) : this.getTurnsForThread(resume.thread)
    ])
    const thread = {
      ...resume.thread,
      name,
      cwd,
      status: existingThread?.status ?? resume.thread.status,
      turns: existingThread
        ? existingThread.turns
        : this.filterRolledBackTurns(threadId, resumedTurns)
    }

    this.cacheThread(thread)
    return thread
  }

  private emitChatUpdated = (threadId: string): void => {
    const detail = this.getCachedChatDetail(threadId)
    if (!detail) return

    this.chatUpdatedListeners.forEach((listener) => listener(detail))
  }

  private scheduleChatUpdated = (threadId: string): void => {
    if (this.chatUpdatedTimers.has(threadId)) return

    const timer = setTimeout(() => {
      this.chatUpdatedTimers.delete(threadId)
      this.emitChatUpdated(threadId)
    }, 50)

    this.chatUpdatedTimers.set(threadId, timer)
  }

  private updateThread = (
    threadId: string,
    update: (thread: CodexThread) => CodexThread
  ): CodexThread | null => {
    const thread = this.threads.get(threadId)
    if (!thread) return null

    const nextThread = update({
      ...thread,
      updatedAt: nowSeconds()
    })
    this.cacheThread(nextThread)
    return nextThread
  }

  private setThreadStatus = (threadId: string, status: CodexThreadStatus): void => {
    this.updateThread(threadId, (thread) => ({
      ...thread,
      status
    }))
  }

  private createPendingTurn = (turnId: string, text: string): CodexTurn => ({
    id: turnId,
    status: 'inProgress',
    items: [
      {
        type: 'userMessage',
        id: `${turnId}:user`,
        content: [{ type: 'text', text }]
      }
    ]
  })

  private addPendingTurn = (threadId: string, text: string): CodexTurn | null => {
    const thread = this.threads.get(threadId)
    if (!thread) return null

    const previousPendingTurnId = this.pendingTurnIds.get(threadId)
    const pendingTurnId = `pending:${Date.now()}`
    const pendingTurn = this.createPendingTurn(pendingTurnId, text)
    this.pendingTurnIds.set(threadId, pendingTurnId)

    this.cacheThread({
      ...thread,
      status: { type: 'active', activeFlags: [] },
      updatedAt: nowSeconds(),
      turns: [...thread.turns.filter((turn) => turn.id !== previousPendingTurnId), pendingTurn]
    })

    return pendingTurn
  }

  private removePendingTurn = (threadId: string, pendingTurnId: string): void => {
    this.pendingTurnIds.delete(threadId)
    this.updateThread(threadId, (thread) => ({
      ...thread,
      turns: thread.turns.filter((turn) => turn.id !== pendingTurnId)
    }))
    this.emitChatUpdated(threadId)
  }

  private getActiveTurnId = (threadId: string): string | null => {
    const activeTurnId = this.activeTurnIds.get(threadId)
    if (activeTurnId) return activeTurnId

    const thread = this.threads.get(threadId)
    return thread?.turns.findLast((turn) => turn.status === 'inProgress')?.id ?? null
  }

  private markTurnInterrupted = (threadId: string, turnId: string): void => {
    this.updateThread(threadId, (thread) => ({
      ...thread,
      turns: thread.turns.map((turn) =>
        turn.id === turnId ? { ...turn, status: 'interrupted' } : turn
      )
    }))
  }

  private mergeItem = (previous: CodexThreadItem, next: CodexThreadItem): CodexThreadItem => ({
    ...previous,
    ...next,
    content:
      next.content && next.content.length > 0 ? next.content : (previous.content ?? next.content),
    text: next.text ?? previous.text,
    command: next.command ?? previous.command,
    server: next.server ?? previous.server,
    tool: next.tool ?? previous.tool,
    namespace: next.namespace ?? previous.namespace,
    query: next.query ?? previous.query,
    aggregatedOutput: next.aggregatedOutput ?? previous.aggregatedOutput,
    result: next.result ?? previous.result,
    error: next.error ?? previous.error,
    customToolName: next.customToolName ?? previous.customToolName,
    customToolInput: next.customToolInput ?? previous.customToolInput,
    customToolOutput: next.customToolOutput ?? previous.customToolOutput,
    changes: next.changes && next.changes.length > 0 ? next.changes : previous.changes,
    summary: next.summary && next.summary.length > 0 ? next.summary : previous.summary,
    rawToolData: next.rawToolData ?? previous.rawToolData
  })

  private createFileChangeItem = (item: CodexThreadItem): CodexThreadItem => ({
    ...item,
    type: 'fileChange',
    changes: item.changes ?? [],
    rawToolData: item.rawToolData ?? [item]
  })

  private createNestedCustomToolItem = (
    item: CodexThreadItem,
    call: { name: string; offset: number },
    index: number,
    callCount: number
  ): CodexThreadItem => ({
    ...item,
    type: 'customToolCall',
    id: callCount === 1 ? item.id : `${item.id}:${index}`,
    customToolName: call.name,
    customToolInput: item.command?.slice(call.offset) ?? null,
    customToolOutput: item.customToolOutput ?? item.aggregatedOutput,
    rawToolData: item.rawToolData ?? [item]
  })

  private normalizeLiveItem = (item: CodexThreadItem): CodexThreadItem[] => {
    if (item.type === 'fileChange') return [item]

    if (item.type === 'customToolCall') {
      if (item.customToolName === 'apply_patch') return [this.createFileChangeItem(item)]

      const input = item.customToolInput ?? ''
      if (input && isPatchToolCall(input)) return [this.createFileChangeItem(item)]
      return [item]
    }

    if (item.type !== 'commandExecution' || !item.command) return [item]

    const nestedCalls = getNestedToolCalls(item.command, { includeQuoted: true })
    if (isPatchToolCall(item.command, nestedCalls)) return [this.createFileChangeItem(item)]
    if (nestedCalls.length === 0) return [item]

    return nestedCalls.map((call, index) =>
      this.createNestedCustomToolItem(item, call, index, nestedCalls.length)
    )
  }

  private normalizeLiveTurn = (turn: CodexTurn): CodexTurn => ({
    ...turn,
    items: turn.items.flatMap((item) => this.normalizeLiveItem(item))
  })

  private mergeTurn = (previous: CodexTurn, next: CodexTurn): CodexTurn => {
    const previousCarriedItems = hasUserMessage(next.items)
      ? previous.items.filter((item) => !isPendingUserMessage(item))
      : previous.items
    const previousItems = new Map(previousCarriedItems.map((item) => [item.id, item]))
    const nextItemIds = new Set(next.items.map((item) => item.id))
    const mergedItems = [
      ...next.items.map((item) => {
        const previousItem = previousItems.get(item.id)
        return previousItem ? this.mergeItem(previousItem, item) : item
      }),
      ...previousCarriedItems.filter((item) => !nextItemIds.has(item.id))
    ]

    return {
      ...previous,
      ...next,
      status: next.status ?? previous.status,
      items: mergedItems
    }
  }

  private replacePendingTurn = (
    threadId: string,
    pendingTurnId: string | null,
    nextTurn: CodexTurn
  ): void => {
    this.updateThread(threadId, (thread) => {
      const pendingTurn = pendingTurnId
        ? thread.turns.find((turn) => turn.id === pendingTurnId)
        : null
      const existingTurn = thread.turns.find((turn) => turn.id === nextTurn.id)
      const previousTurn = pendingTurn
        ? {
            ...pendingTurn,
            id: nextTurn.id
          }
        : existingTurn

      const mergedTurn = previousTurn ? this.mergeTurn(previousTurn, nextTurn) : nextTurn
      const turns = thread.turns.filter(
        (turn) => turn.id !== pendingTurnId && turn.id !== nextTurn.id
      )

      return {
        ...thread,
        turns: [...turns, mergedTurn]
      }
    })
  }

  private upsertTurn = (threadId: string, turn: CodexTurn): void => {
    this.updateThread(threadId, (thread) => {
      const turnIndex = thread.turns.findIndex((candidate) => candidate.id === turn.id)
      const turns = [...thread.turns]
      const previousTurn = turnIndex >= 0 ? turns[turnIndex] : null
      const nextTurn = previousTurn ? this.mergeTurn(previousTurn, turn) : turn

      if (turnIndex >= 0) turns[turnIndex] = nextTurn
      else turns.push(nextTurn)

      return {
        ...thread,
        turns
      }
    })
  }

  private upsertItems = (threadId: string, turnId: string, items: CodexThreadItem[]): void => {
    this.updateTurnItems(threadId, turnId, (currentItems) => {
      const nextItems = hasUserMessage(items)
        ? currentItems.filter((item) => !isPendingUserMessage(item))
        : [...currentItems]

      for (const item of items) {
        const itemIndex = nextItems.findIndex((candidate) => candidate.id === item.id)
        if (itemIndex < 0) {
          nextItems.push(item)
          continue
        }

        nextItems[itemIndex] = this.mergeItem(nextItems[itemIndex], item)
      }

      return nextItems
    })
  }

  private updateItem = (
    threadId: string,
    turnId: string,
    itemId: string,
    update: (item: CodexThreadItem | null) => CodexThreadItem | null
  ): void => {
    this.updateTurnItems(threadId, turnId, (items) => {
      const itemIndex = items.findIndex((candidate) => candidate.id === itemId)
      const nextItem = update(itemIndex >= 0 ? items[itemIndex] : null)
      if (!nextItem) return items

      if (itemIndex < 0) return [...items, nextItem]

      const nextItems = [...items]
      nextItems[itemIndex] = nextItem
      return nextItems
    })
  }

  private updateTurnItems = (
    threadId: string,
    turnId: string,
    update: (items: CodexThreadItem[]) => CodexThreadItem[]
  ): void => {
    if (this.isRolledBackTurn(threadId, turnId)) return

    this.updateThread(threadId, (thread) => {
      const turnIndex = thread.turns.findIndex((candidate) => candidate.id === turnId)
      const turns = [...thread.turns]
      const turn =
        turnIndex >= 0
          ? turns[turnIndex]
          : {
              id: turnId,
              status: 'inProgress',
              items: []
            }

      turns[turnIndex >= 0 ? turnIndex : turns.length] = {
        ...turn,
        items: update(turn.items)
      }

      return {
        ...thread,
        turns
      }
    })
  }

  private handleTurnNotification = (
    notification: RpcNotification,
    params: TurnNotificationParams
  ): void => {
    const threadId = getThreadId(params)
    if (!threadId || !params.turn || typeof params.turn !== 'object') return
    const turn = this.normalizeLiveTurn(params.turn as CodexTurn)

    if (this.isRolledBackTurn(threadId, turn.id)) {
      if (notification.method !== 'turn/started' || !this.pendingTurnIds.has(threadId)) return
      this.allowRolledBackTurn(threadId, turn.id)
    }

    if (notification.method === 'turn/started') {
      this.activeTurnIds.set(threadId, turn.id)
      this.setThreadStatus(threadId, { type: 'active', activeFlags: [] })
    }
    if (notification.method === 'turn/completed') {
      if (this.activeTurnIds.get(threadId) === turn.id) this.activeTurnIds.delete(threadId)
      this.setThreadStatus(threadId, { type: 'idle' })
    }

    const pendingTurnId =
      notification.method === 'turn/started' ? (this.pendingTurnIds.get(threadId) ?? null) : null

    if (pendingTurnId) {
      this.replacePendingTurn(threadId, pendingTurnId, turn)
      this.pendingTurnIds.delete(threadId)
    } else {
      this.upsertTurn(threadId, turn)
    }

    this.scheduleChatUpdated(threadId)
  }

  private handleItemNotification = (params: ItemNotificationParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    if (!threadId || !turnId || !params.item || typeof params.item !== 'object') return

    this.upsertItems(threadId, turnId, this.normalizeLiveItem(params.item as CodexThreadItem))
    this.scheduleChatUpdated(threadId)
  }

  private handleAgentMessageDelta = (params: AgentMessageDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    if (!threadId || !turnId || !itemId || delta == null) return

    this.updateItem(threadId, turnId, itemId, (item) => ({
      ...(item?.type === 'agentMessage' ? item : { type: 'agentMessage', id: itemId }),
      text: `${item?.type === 'agentMessage' ? (item.text ?? '') : ''}${delta}`,
      phase: item?.type === 'agentMessage' ? (item.phase ?? null) : null
    }))
    this.scheduleChatUpdated(threadId)
  }

  private handlePlanDelta = (params: AgentMessageDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    if (!threadId || !turnId || !itemId || delta == null) return

    this.updateItem(threadId, turnId, itemId, (item) => ({
      ...(item?.type === 'plan' ? item : { type: 'plan', id: itemId }),
      text: `${item?.type === 'plan' ? (item.text ?? '') : ''}${delta}`
    }))
    this.scheduleChatUpdated(threadId)
  }

  private handleReasoningSummaryDelta = (params: ReasoningSummaryDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    const summaryIndex =
      typeof params.summaryIndex === 'number' && Number.isInteger(params.summaryIndex)
        ? params.summaryIndex
        : null
    if (!threadId || !turnId || !itemId || delta == null || summaryIndex == null) return

    this.updateItem(threadId, turnId, itemId, (item) => {
      const summary = item?.summary ? [...item.summary] : []
      summary[summaryIndex] = `${summary[summaryIndex] ?? ''}${delta}`

      return {
        ...(item?.type === 'reasoning' ? item : { type: 'reasoning', id: itemId }),
        summary
      }
    })
    this.scheduleChatUpdated(threadId)
  }

  private handleCommandOutputDelta = (params: AgentMessageDeltaParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    const delta = getDelta(params)
    if (!threadId || !turnId || !itemId || delta == null) return

    this.updateItem(threadId, turnId, itemId, (item) => {
      if (!item) return { type: 'commandExecution', id: itemId, aggregatedOutput: delta }

      if (item.type === 'commandExecution') {
        return {
          ...item,
          aggregatedOutput: `${item.aggregatedOutput ?? ''}${delta}`
        }
      }

      if (item.type === 'customToolCall') {
        return {
          ...item,
          customToolOutput: `${
            typeof item.customToolOutput === 'string' ? item.customToolOutput : ''
          }${delta}`
        }
      }

      return item
    })
    this.scheduleChatUpdated(threadId)
  }

  private handleFileChangePatchUpdated = (params: FileChangePatchParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const itemId = getItemId(params)
    if (!threadId || !turnId || !itemId || !Array.isArray(params.changes)) return

    this.updateItem(threadId, turnId, itemId, (item) => ({
      ...(item ?? { id: itemId }),
      type: 'fileChange',
      changes: params.changes as CodexThreadItem['changes'],
      rawToolData: item?.rawToolData ?? (item ? [item] : undefined)
    }))
    this.scheduleChatUpdated(threadId)
  }

  private handleRawResponseItemCompleted = (params: RawResponseItemParams): void => {
    const threadId = getThreadId(params)
    const turnId = getTurnId(params)
    const message = getRawResponseMessage(params.item)
    if (!threadId || !turnId || !message) return

    this.updateTurnItems(threadId, turnId, (items) => {
      const finalMessageIndex = items.findLastIndex(
        (item) =>
          item.type === 'agentMessage' &&
          (item.phase === 'final_answer' || item.phase == null || item.text === message.text)
      )

      if (finalMessageIndex >= 0) {
        const nextItems = [...items]
        nextItems[finalMessageIndex] = {
          ...nextItems[finalMessageIndex],
          text: message.text,
          phase: message.phase ?? nextItems[finalMessageIndex].phase ?? 'final_answer'
        }
        return nextItems
      }

      return [
        ...items,
        {
          type: 'agentMessage',
          id: `${turnId}:raw-final`,
          text: message.text,
          phase: message.phase ?? 'final_answer'
        }
      ]
    })
    this.scheduleChatUpdated(threadId)
  }

  private handleThreadNotification = (
    notification: RpcNotification,
    params: ThreadNotificationParams
  ): void => {
    const threadId = getThreadId(params)
    if (!threadId) return

    if (notification.method === 'thread/status/changed' && params.status) {
      this.setThreadStatus(threadId, params.status as CodexThreadStatus)
    }

    if (notification.method === 'thread/name/updated') {
      const name = getThreadNotificationName(params)
      this.updateThread(threadId, (thread) => ({
        ...thread,
        name
      }))
    }

    this.scheduleChatUpdated(threadId)
  }

  private handleNotification = (notification: RpcNotification): void => {
    const params = notification.params
    if (!params || typeof params !== 'object') return

    if (notification.method === 'turn/started' || notification.method === 'turn/completed') {
      this.handleTurnNotification(notification, params as TurnNotificationParams)
      return
    }

    if (notification.method === 'item/started' || notification.method === 'item/completed') {
      this.handleItemNotification(params as ItemNotificationParams)
      return
    }

    if (notification.method === 'item/agentMessage/delta') {
      this.handleAgentMessageDelta(params as AgentMessageDeltaParams)
      return
    }

    if (notification.method === 'item/plan/delta') {
      this.handlePlanDelta(params as AgentMessageDeltaParams)
      return
    }

    if (notification.method === 'item/reasoning/summaryTextDelta') {
      this.handleReasoningSummaryDelta(params as ReasoningSummaryDeltaParams)
      return
    }

    if (notification.method === 'item/commandExecution/outputDelta') {
      this.handleCommandOutputDelta(params as AgentMessageDeltaParams)
      return
    }

    if (notification.method === 'item/fileChange/patchUpdated') {
      this.handleFileChangePatchUpdated(params as FileChangePatchParams)
      return
    }

    if (notification.method === 'rawResponseItem/completed') {
      this.handleRawResponseItemCompleted(params as RawResponseItemParams)
      return
    }

    if (
      notification.method === 'thread/status/changed' ||
      notification.method === 'thread/name/updated'
    ) {
      this.handleThreadNotification(notification, params as ThreadNotificationParams)
    }
  }
}

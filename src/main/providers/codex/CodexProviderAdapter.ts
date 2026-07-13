import type {
  ProviderChat,
  ProviderChatDetail,
  ProviderChatStatus,
  ProviderLoginResult
} from '../../../shared/provider'
import type { ProviderAdapter } from '../ProviderAdapter'
import { CodexAppServerClient, type RpcNotification } from './CodexAppServerClient'
import { getChatItems, type CodexThreadItem, type CodexTurn } from './CodexItemRenderers'
import { loadRolloutHistory } from './CodexRolloutHistory'
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
  name: string | null
  preview: string
  createdAt: number
  updatedAt: number
  status: CodexThreadStatus
  path: string | null
  turns: CodexTurn[]
}

type ThreadListResponse = {
  data: CodexThread[]
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

type ThreadNotificationParams = {
  threadId?: unknown
  status?: unknown
  threadName?: unknown
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

const getThreadTitle = (thread: CodexThread): string =>
  thread.name?.trim() || thread.preview.trim().split('\n')[0] || 'Untitled chat'

const getThreadStatus = (thread: CodexThread): ProviderChatStatus | null => {
  if (thread.status.type === 'systemError') return 'error'
  if (thread.status.type !== 'active') return null
  if (thread.status.activeFlags.includes('waitingOnApproval')) return 'waitingOnApproval'
  if (thread.status.activeFlags.includes('waitingOnUserInput')) return 'waitingOnUserInput'
  return 'active'
}

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

const createUserTextInput = (
  text: string
): Array<{ type: 'text'; text: string; text_elements: [] }> => [
  { type: 'text', text, text_elements: [] }
]

export class CodexProviderAdapter implements ProviderAdapter {
  id = 'codex' as const

  private client = new CodexAppServerClient()
  private disposeNotificationListener: (() => void) | null = null
  private chatUpdatedListeners = new Set<(detail: ProviderChatDetail) => void>()
  private threads = new Map<string, CodexThread>()
  private pendingTurnIds = new Map<string, string>()
  private chatUpdatedTimers = new Map<string, ReturnType<typeof setTimeout>>()

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

    const thread = {
      ...response.thread,
      turns: await this.getTurnsForThread(response.thread)
    }
    this.cacheThread(thread)

    return this.createChatDetail(thread)
  }

  startChat = async (message: string): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot start a chat with an empty message')

    const startedThread = await this.client.request<ThreadStartResponse>('thread/start', {})
    const thread = {
      ...startedThread.thread,
      status: { type: 'active', activeFlags: [] },
      turns: await this.getTurnsForThread(startedThread.thread)
    } satisfies CodexThread
    this.cacheThread(thread)

    const pendingTurn = this.addPendingTurn(thread.id, text)
    if (pendingTurn) this.emitChatUpdated(thread.id)

    try {
      const startedTurn = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: thread.id,
        input: createUserTextInput(text)
      })

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

  continueChat = async (chatId: string, message: string): Promise<ProviderChatDetail> => {
    const text = message.trim()
    if (!text) throw new Error('Cannot continue a chat with an empty message')

    const pendingTurn = this.addPendingTurn(chatId, text)
    if (pendingTurn) this.emitChatUpdated(chatId)

    try {
      const resume = await this.client.request<ThreadResumeResponse>('thread/resume', {
        threadId: chatId
      })
      const resumedTurns = await this.getTurnsForThread(resume.thread)
      const turns =
        pendingTurn && !resumedTurns.some((turn) => turn.id === pendingTurn.id)
          ? [...resumedTurns, pendingTurn]
          : resumedTurns

      this.cacheThread({
        ...resume.thread,
        status: { type: 'active', activeFlags: [] },
        turns
      })

      const started = await this.client.request<TurnStartResponse>('turn/start', {
        threadId: chatId,
        input: createUserTextInput(text)
      })

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

  private getTurnsForThread = async (thread: CodexThread): Promise<CodexTurn[]> => {
    const turnStatuses = new Map(thread.turns.map((turn) => [turn.id, turn.status]))
    const rolloutTurns = await loadRolloutHistory(thread.path)
    if (rolloutTurns.length === 0) return thread.turns

    const rolloutTurnIds = new Set(rolloutTurns.map((turn) => turn.id))
    const structuredOnlyTurns = thread.turns.filter(
      (turn) => !rolloutTurnIds.has(turn.id) && turn.items.length > 0
    )

    return [
      ...rolloutTurns.map((turn) => ({
        ...turn,
        status: turnStatuses.get(turn.id) ?? turn.status ?? null
      })),
      ...structuredOnlyTurns
    ]
  }

  private createChatDetail = (thread: CodexThread): ProviderChatDetail => ({
    id: thread.id,
    title: getThreadTitle(thread),
    status: getThreadStatus(thread),
    items: getChatItems(thread.turns)
  })

  private cacheThread = (thread: CodexThread): void => {
    this.threads.set(thread.id, thread)
  }

  private getCachedChatDetail = (threadId: string): ProviderChatDetail | null => {
    const thread = this.threads.get(threadId)
    return thread ? this.createChatDetail(thread) : null
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

    if (notification.method === 'turn/started') {
      this.setThreadStatus(threadId, { type: 'active', activeFlags: [] })
    }
    if (notification.method === 'turn/completed') {
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
      this.updateThread(threadId, (thread) => ({
        ...thread,
        name: typeof params.threadName === 'string' ? params.threadName : null
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

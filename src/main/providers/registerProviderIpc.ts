import { isAbsolute } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type {
  ProviderApprovalDecision,
  ProviderActiveSendMode,
  ProviderChatListOptions,
  ProviderCwdNote,
  ProviderId,
  ProviderOneShotOptions,
  ProviderTurnOptions,
  ProviderUsageOptions
} from '../../shared/provider'
import {
  isProviderApprovalPolicy,
  isProviderApprovalsReviewer,
  isProviderActiveSendMode,
  isProviderId,
  isProviderModelId,
  isProviderReasoningEffort,
  isProviderSandboxMode,
  providerIpcChannels
} from '../../shared/provider'
import { providerApi } from './providerService'

const requireProviderId = (value: unknown): ProviderId => {
  if (!isProviderId(value)) throw new Error(`Unknown provider: ${String(value)}`)
  return value
}

const requireChatId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid chat ID')
  return value
}

const requireMessageId = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('Invalid message ID')
  return value
}

const requireGenerationId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid generation ID')
  return value
}

const requireOptionalCwd = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Invalid cwd')
  return value
}

const requireBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value')
  return value
}

const requireTimestamp = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Invalid timestamp')
  }

  return Math.floor(value)
}

const requireCwdNotes = (value: unknown): ProviderCwdNote[] => {
  if (!Array.isArray(value)) throw new Error('Invalid notes')
  if (value.length > 100) throw new Error('Too many notes')

  return value.map((note) => {
    if (!note || typeof note !== 'object') throw new Error('Invalid note')

    const candidate = note as Partial<ProviderCwdNote>
    if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 128) {
      throw new Error('Invalid note ID')
    }
    if (
      typeof candidate.text !== 'string' ||
      !candidate.text.trim() ||
      candidate.text.length > 1000
    ) {
      throw new Error('Invalid note text')
    }
    if (
      typeof candidate.createdAt !== 'number' ||
      !Number.isFinite(candidate.createdAt) ||
      candidate.createdAt < 0
    ) {
      throw new Error('Invalid note timestamp')
    }

    return {
      id: candidate.id.trim(),
      text: candidate.text.trim(),
      createdAt: Math.floor(candidate.createdAt)
    }
  })
}

const requireApprovalDecision = (value: unknown): ProviderApprovalDecision => {
  if (value !== 'allow' && value !== 'deny') throw new Error('Invalid approval decision')
  return value
}

const requireActiveSendMode = (value: unknown): ProviderActiveSendMode => {
  if (!isProviderActiveSendMode(value)) throw new Error('Invalid active send mode')
  return value
}

const requireChatListOptions = (value: unknown): ProviderChatListOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid chat list options')
  }

  const options = value as { cursor?: unknown; limit?: unknown }
  const cursor = options.cursor
  if (cursor != null && typeof cursor !== 'string') throw new Error('Invalid chat list cursor')

  const limit = options.limit
  if (
    limit != null &&
    (!Number.isInteger(limit) || typeof limit !== 'number' || limit < 1 || limit > 100)
  ) {
    throw new Error('Invalid chat list limit')
  }

  return {
    cursor: cursor ?? null,
    limit: limit ?? null
  }
}

const requireUsageOptions = (value: unknown): ProviderUsageOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid usage options')

  const options = value as { includeStatistics?: unknown }
  const includeStatistics = options.includeStatistics
  if (includeStatistics != null && typeof includeStatistics !== 'boolean') {
    throw new Error('Invalid usage statistics option')
  }

  return {
    includeStatistics: includeStatistics ?? false
  }
}

const requireMessage = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid message')
  return value
}

const requireTurnOptions = (value: unknown): ProviderTurnOptions | undefined => {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid turn options')

  const options = value as {
    approvalPolicy?: unknown
    approvalsReviewer?: unknown
    cwd?: unknown
    model?: unknown
    reasoningEffort?: unknown
    sandboxMode?: unknown
  }
  const approvalPolicy = options.approvalPolicy
  if (!isProviderApprovalPolicy(approvalPolicy)) throw new Error('Invalid approval policy')

  const approvalsReviewer = options.approvalsReviewer ?? 'user'
  if (!isProviderApprovalsReviewer(approvalsReviewer)) {
    throw new Error('Invalid approvals reviewer')
  }

  const sandboxMode = options.sandboxMode
  if (!isProviderSandboxMode(sandboxMode)) throw new Error('Invalid sandbox mode')

  const cwd = options.cwd
  if (cwd != null && (typeof cwd !== 'string' || !isAbsolute(cwd))) {
    throw new Error('Invalid cwd')
  }

  const model = options.model ?? 'gpt-5.5'
  if (!isProviderModelId(model)) throw new Error('Invalid model')

  const reasoningEffort = options.reasoningEffort ?? 'xhigh'
  if (!isProviderReasoningEffort(reasoningEffort)) throw new Error('Invalid reasoning effort')

  return {
    approvalPolicy,
    approvalsReviewer,
    cwd: cwd ?? undefined,
    model,
    reasoningEffort,
    sandboxMode
  }
}

const requireOneShotOptions = (value: unknown): ProviderOneShotOptions | undefined => {
  const turnOptions = requireTurnOptions(value)
  if (value == null) return turnOptions
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid one-shot options')

  const generationId = (value as { generationId?: unknown }).generationId
  if (generationId != null) {
    return {
      ...turnOptions!,
      generationId: requireGenerationId(generationId)
    }
  }

  return turnOptions
}

export const registerProviderIpc = (): void => {
  providerApi.onChatUpdated((event) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(providerIpcChannels.chatUpdated, event)
    })
  })

  ipcMain.handle(providerIpcChannels.login, (_, providerId: unknown) =>
    providerApi.login(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getUpdateAvailability, (_, providerId: unknown) =>
    providerApi.getUpdateAvailability(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.updateProvider, (_, providerId: unknown) =>
    providerApi.updateProvider(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getApprovalModes, (_, providerId: unknown) =>
    providerApi.getApprovalModes(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getSandboxModes, (_, providerId: unknown) =>
    providerApi.getSandboxModes(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getModels, (_, providerId: unknown) =>
    providerApi.getModels(requireProviderId(providerId))
  )

  ipcMain.handle(providerIpcChannels.getUsage, (_, providerId: unknown, options: unknown) =>
    providerApi.getUsage(requireProviderId(providerId), requireUsageOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getChats, (_, providerId: unknown, options: unknown) =>
    providerApi.getChats(requireProviderId(providerId), requireChatListOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getChat, (_, providerId: unknown, chatId: unknown) =>
    providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
  )

  ipcMain.handle(
    providerIpcChannels.generateOneShot,
    (_, providerId: unknown, message: unknown, options: unknown) =>
      providerApi.generateOneShot(
        requireProviderId(providerId),
        requireMessage(message),
        requireOneShotOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.cancelOneShot,
    (_, providerId: unknown, generationId: unknown) =>
      providerApi.cancelOneShot(requireProviderId(providerId), requireGenerationId(generationId))
  )

  ipcMain.handle(
    providerIpcChannels.startChat,
    (_, providerId: unknown, message: unknown, options: unknown) =>
      providerApi.startChat(
        requireProviderId(providerId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.continueChat,
    (_, providerId: unknown, chatId: unknown, message: unknown, options: unknown) =>
      providerApi.continueChat(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.sendActiveChatMessage,
    (_, providerId: unknown, chatId: unknown, message: unknown, mode: unknown, options: unknown) =>
      providerApi.sendActiveChatMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessage(message),
        requireActiveSendMode(mode),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.deletePendingMessage,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      providerApi.deletePendingMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId)
      )
  )

  ipcMain.handle(
    providerIpcChannels.editPendingMessage,
    (
      _,
      providerId: unknown,
      chatId: unknown,
      messageId: unknown,
      message: unknown,
      options: unknown
    ) =>
      providerApi.editPendingMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(
    providerIpcChannels.interruptPendingMessage,
    (_, providerId: unknown, chatId: unknown, messageId: unknown) =>
      providerApi.interruptPendingMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId)
      )
  )

  ipcMain.handle(
    providerIpcChannels.editMessage,
    (
      _,
      providerId: unknown,
      chatId: unknown,
      messageId: unknown,
      message: unknown,
      options: unknown
    ) =>
      providerApi.editMessage(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireMessageId(messageId),
        requireMessage(message),
        requireTurnOptions(options)
      )
  )

  ipcMain.handle(providerIpcChannels.stopChat, (_, providerId: unknown, chatId: unknown) =>
    providerApi.stopChat(requireProviderId(providerId), requireChatId(chatId))
  )

  ipcMain.handle(
    providerIpcChannels.resolveApproval,
    (_, providerId: unknown, chatId: unknown, decision: unknown) =>
      providerApi.resolveApproval(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireApprovalDecision(decision)
      )
  )

  ipcMain.handle(
    providerIpcChannels.markChatDone,
    (_, providerId: unknown, chatId: unknown, done: unknown) =>
      providerApi.markChatDone(
        requireProviderId(providerId),
        requireChatId(chatId),
        done == null ? true : requireBoolean(done)
      )
  )

  ipcMain.handle(providerIpcChannels.markCwdChatsDone, (_, providerId: unknown, cwd: unknown) =>
    providerApi.markCwdChatsDone(requireProviderId(providerId), requireOptionalCwd(cwd))
  )

  ipcMain.handle(providerIpcChannels.getCwdNotes, (_, providerId: unknown, cwd: unknown) =>
    providerApi.getCwdNotes(requireProviderId(providerId), requireOptionalCwd(cwd))
  )

  ipcMain.handle(
    providerIpcChannels.setCwdNotes,
    (_, providerId: unknown, cwd: unknown, notes: unknown) =>
      providerApi.setCwdNotes(
        requireProviderId(providerId),
        requireOptionalCwd(cwd),
        requireCwdNotes(notes)
      )
  )

  ipcMain.handle(
    providerIpcChannels.markChatSeen,
    (_, providerId: unknown, chatId: unknown, seenUpdatedAt: unknown) =>
      providerApi.markChatSeen(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireTimestamp(seenUpdatedAt)
      )
  )

  ipcMain.handle(
    providerIpcChannels.setChatPinned,
    (_, providerId: unknown, chatId: unknown, pinned: unknown) =>
      providerApi.setChatPinned(
        requireProviderId(providerId),
        requireChatId(chatId),
        requireBoolean(pinned)
      )
  )
}

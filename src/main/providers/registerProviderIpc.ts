import { isAbsolute } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type {
  ProviderApprovalDecision,
  ProviderChatListOptions,
  ProviderId,
  ProviderTurnOptions
} from '../../shared/provider'
import {
  isProviderApprovalPolicy,
  isProviderApprovalsReviewer,
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

const requireOptionalCwd = (value: unknown): string | null => {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Invalid cwd')
  return value
}

const requireBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value')
  return value
}

const requireApprovalDecision = (value: unknown): ProviderApprovalDecision => {
  if (value !== 'allow' && value !== 'deny') throw new Error('Invalid approval decision')
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

  ipcMain.handle(providerIpcChannels.getChats, (_, providerId: unknown, options: unknown) =>
    providerApi.getChats(requireProviderId(providerId), requireChatListOptions(options))
  )

  ipcMain.handle(providerIpcChannels.getChat, (_, providerId: unknown, chatId: unknown) =>
    providerApi.getChat(requireProviderId(providerId), requireChatId(chatId))
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

  ipcMain.handle(providerIpcChannels.markChatDone, (_, providerId: unknown, chatId: unknown) =>
    providerApi.markChatDone(requireProviderId(providerId), requireChatId(chatId))
  )

  ipcMain.handle(providerIpcChannels.markCwdChatsDone, (_, providerId: unknown, cwd: unknown) =>
    providerApi.markCwdChatsDone(requireProviderId(providerId), requireOptionalCwd(cwd))
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

import type {
  ProviderApi,
  ProviderChat,
  ProviderChatDetail,
  ProviderChatMetadata,
  ProviderChatUpdatedEvent,
  ProviderId
} from '../../shared/provider'
import {
  getChatMetadata,
  getChatMetadataByIds,
  setChatDone,
  setChatPinned,
  setChatsDone
} from '../database/chat'
import { CodexProviderAdapter } from './codex/CodexProviderAdapter'
import { getCwdMetadata } from './cwdMetadata'
import type { ProviderAdapter } from './ProviderAdapter'

const adapters: Record<ProviderId, ProviderAdapter> = {
  codex: new CodexProviderAdapter()
}

const chatUpdatedListeners = new Set<(event: ProviderChatUpdatedEvent) => void>()

const normalizeCwd = (cwd: string | null | undefined): string | null => {
  const trimmedCwd = cwd?.trim()
  return trimmedCwd || null
}

const applyMetadataToChat = (
  chat: ProviderChat,
  metadata: ProviderChatMetadata | undefined
): ProviderChat => ({
  ...chat,
  pinned: metadata?.pinned ?? false,
  done: metadata?.done ?? false
})

const applyMetadataToChats = async (chats: ProviderChat[]): Promise<ProviderChat[]> => {
  const metadataById = await getChatMetadataByIds(chats.map((chat) => chat.id))
  return Promise.all(
    chats.map(async (chat) => {
      const cwdMetadata = await getCwdMetadata(chat.cwd)

      return {
        ...applyMetadataToChat(chat, metadataById.get(chat.id)),
        cwdKind: cwdMetadata.kind,
        projectCwd: cwdMetadata.projectCwd,
        branchName: cwdMetadata.branchName
      }
    })
  )
}

const applyMetadataToDetail = async (detail: ProviderChatDetail): Promise<ProviderChatDetail> => {
  const [metadata, cwdMetadata] = await Promise.all([
    getChatMetadata(detail.id),
    getCwdMetadata(detail.cwd)
  ])
  return {
    ...detail,
    cwdKind: cwdMetadata.kind,
    projectCwd: cwdMetadata.projectCwd,
    branchName: cwdMetadata.branchName,
    pinned: metadata.pinned,
    done: metadata.done
  }
}

const collectProviderChatIdsByCwd = async (
  providerId: ProviderId,
  cwd: string | null
): Promise<string[]> => {
  const adapter = adapters[providerId]
  const normalizedCwd = normalizeCwd(cwd)
  const chatIds = new Set<string>()
  let cursor: string | null = null

  do {
    const page = await adapter.getChats({
      cursor,
      limit: 100
    })

    page.chats.forEach((chat) => {
      if (normalizeCwd(chat.cwd) === normalizedCwd) chatIds.add(chat.id)
    })

    cursor = page.nextCursor
  } while (cursor)

  return Array.from(chatIds)
}

for (const adapter of Object.values(adapters)) {
  adapter.onChatUpdated((detail) => {
    void applyMetadataToDetail(detail)
      .then((enrichedDetail) => {
        const event = {
          providerId: adapter.id,
          chatId: enrichedDetail.id,
          detail: enrichedDetail
        } satisfies ProviderChatUpdatedEvent

        chatUpdatedListeners.forEach((listener) => listener(event))
      })
      .catch((error) => {
        console.error('Unable to apply chat metadata to update', error)
      })
  })
}

export const providerApi: ProviderApi = {
  login: (providerId) => adapters[providerId].login(),
  getAccessModes: (providerId) => adapters[providerId].getAccessModes(),
  getModels: (providerId) => adapters[providerId].getModels(),
  getChats: async (providerId, options) => {
    const page = await adapters[providerId].getChats(options)
    return {
      ...page,
      chats: await applyMetadataToChats(page.chats)
    }
  },
  getChat: async (providerId, chatId) =>
    applyMetadataToDetail(await adapters[providerId].getChat(chatId)),
  startChat: async (providerId, message, options) =>
    applyMetadataToDetail(await adapters[providerId].startChat(message, options)),
  continueChat: (providerId, chatId, message, options) =>
    adapters[providerId]
      .continueChat(chatId, message, options)
      .then((detail) => applyMetadataToDetail(detail)),
  editMessage: (providerId, chatId, messageId, message, options) =>
    adapters[providerId]
      .editMessage(chatId, messageId, message, options)
      .then((detail) => applyMetadataToDetail(detail)),
  resolveApproval: (providerId, chatId, decision) =>
    adapters[providerId]
      .resolveApproval(chatId, decision)
      .then((detail) => applyMetadataToDetail(detail)),
  stopChat: (providerId, chatId) =>
    adapters[providerId].stopChat(chatId).then((detail) => applyMetadataToDetail(detail)),
  markChatDone: (_providerId, chatId) => setChatDone(chatId, true),
  markCwdChatsDone: async (providerId, cwd) =>
    setChatsDone(await collectProviderChatIdsByCwd(providerId, cwd), true),
  setChatPinned: (_providerId, chatId, pinned) => setChatPinned(chatId, pinned),
  onChatUpdated: (listener) => {
    chatUpdatedListeners.add(listener)
    return () => chatUpdatedListeners.delete(listener)
  }
}

export const disposeProviderAdapters = (): void => {
  Object.values(adapters).forEach((adapter) => adapter.dispose())
}

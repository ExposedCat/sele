import { readFile } from 'node:fs/promises'
import type { CodexThreadItem, CodexTurn } from './CodexItemRenderers'

type RolloutPayload = {
  type: string
  turn_id?: string
  call_id?: string
  id?: string
  name?: string
  input?: string
  output?: unknown
  message?: string
  phase?: 'commentary' | 'final_answer' | null
  [key: string]: unknown
}

type RolloutRecord = {
  payload?: RolloutPayload
  [key: string]: unknown
}

type RolloutEntry = {
  record: RolloutRecord
  payload: RolloutPayload
}

type NestedToolCall = {
  name: string
  offset: number
}

type CustomToolMerge = {
  items: CodexThreadItem[]
  normalizedChildIds: string[]
}

const isNestedToolName = (name: string): boolean =>
  name === 'exec_command' ||
  name === 'apply_patch' ||
  name === 'write_stdin' ||
  name === 'view_image' ||
  name.startsWith('mcp__') ||
  name.startsWith('web__') ||
  name.startsWith('image_gen__')

const getNestedToolCalls = (input: string): NestedToolCall[] => {
  const calls: NestedToolCall[] = []
  let quote: string | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const nextCharacter = input[index + 1]

    if (lineComment) {
      if (character === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (character === '*' && nextCharacter === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '/' && nextCharacter === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (character === '/' && nextCharacter === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (!input.startsWith('tools.', index)) continue

    const match = input.slice(index).match(/^tools\.([A-Za-z0-9_]+)\s*\(/)
    if (match && isNestedToolName(match[1])) calls.push({ name: match[1], offset: index })
  }

  return calls
}

const parseRollout = (contents: string): RolloutEntry[] => {
  const entries: RolloutEntry[] = []

  for (const line of contents.split('\n')) {
    if (!line.trim()) continue

    try {
      const record = JSON.parse(line) as RolloutRecord
      if (record.payload?.type) entries.push({ record, payload: record.payload })
    } catch {
      // A malformed rollout row should not prevent the rest of the history from loading.
    }
  }

  return entries
}

const groupEntriesByTurn = (entries: RolloutEntry[]): Map<string, RolloutEntry[]> => {
  const entriesByTurn = new Map<string, RolloutEntry[]>()
  let currentTurnId: string | null = null

  for (const entry of entries) {
    if (entry.payload.type === 'task_started') currentTurnId = entry.payload.turn_id ?? null

    const turnId = entry.payload.turn_id ?? currentTurnId
    if (!turnId) continue

    const turnEntries = entriesByTurn.get(turnId) ?? []
    turnEntries.push(entry)
    entriesByTurn.set(turnId, turnEntries)
  }

  return entriesByTurn
}

const findNextItem = (
  items: CodexThreadItem[],
  usedItemIds: Set<string>,
  predicate: (item: CodexThreadItem) => boolean
): CodexThreadItem | null => {
  const item = items.find((candidate) => !usedItemIds.has(candidate.id) && predicate(candidate))
  if (item) usedItemIds.add(item.id)
  return item ?? null
}

const getMatchingNormalizedItem = (
  payload: RolloutPayload,
  items: CodexThreadItem[],
  itemsById: Map<string, CodexThreadItem>,
  usedItemIds: Set<string>
): CodexThreadItem | null => {
  if (payload.call_id) {
    const item = itemsById.get(payload.call_id)
    if (item && !usedItemIds.has(item.id)) {
      usedItemIds.add(item.id)
      return item
    }
  }

  if (payload.type === 'user_message') {
    return findNextItem(items, usedItemIds, (item) => item.type === 'userMessage')
  }

  if (payload.type === 'agent_message' && payload.message) {
    const message = payload.message.trim()
    return findNextItem(
      items,
      usedItemIds,
      (item) =>
        item.type === 'agentMessage' &&
        item.text?.trim() === message &&
        (payload.phase == null || item.phase === payload.phase)
    )
  }

  return null
}

const getCustomToolMerge = (
  entry: RolloutEntry,
  entries: RolloutEntry[],
  entryIndex: number,
  itemsById: Map<string, CodexThreadItem>
): CustomToolMerge => {
  const { payload } = entry
  if (!payload.input) return { items: [], normalizedChildIds: [] }

  const outputIndex = entries.findIndex(
    (candidate, index) =>
      index > entryIndex &&
      candidate.payload.type === 'custom_tool_call_output' &&
      candidate.payload.call_id === payload.call_id
  )
  const lastIndex = outputIndex < 0 ? entryIndex : outputIndex
  const callEntries = entries.slice(entryIndex, lastIndex + 1)
  const normalizedChildren = callEntries
    .map((candidate) =>
      candidate.payload.call_id ? itemsById.get(candidate.payload.call_id) : undefined
    )
    .filter((item): item is CodexThreadItem => item != null)
  const output = outputIndex < 0 ? null : entries[outputIndex].payload.output
  const nestedCalls = getNestedToolCalls(payload.input)
  const calls = nestedCalls.length > 0 ? nestedCalls : [{ name: payload.name ?? 'tool', offset: 0 }]
  const rawToolData: unknown[] = [
    ...callEntries.map((candidate) => candidate.record),
    ...normalizedChildren
  ]
  const changes = normalizedChildren.flatMap((item) => item.changes ?? [])

  return {
    items: calls.map((call, index) => ({
      type: 'customToolCall',
      id: `${payload.id ?? payload.call_id ?? 'custom-tool'}:${index}`,
      customToolName: call.name,
      customToolInput: payload.input?.slice(call.offset) ?? '',
      customToolOutput: output,
      rawToolData,
      changes
    })),
    normalizedChildIds: normalizedChildren.map((item) => item.id)
  }
}

const mergeTurnEntries = (turn: CodexTurn, entries: RolloutEntry[]): CodexTurn => {
  const itemsById = new Map(turn.items.map((item) => [item.id, item]))
  const usedItemIds = new Set<string>()
  const suppressedItemIds = new Set<string>()
  const rawRecordsByItemId = new Map<string, RolloutRecord[]>()
  const beforeFirstItem: CodexThreadItem[] = []
  const itemsAfter = new Map<string, CodexThreadItem[]>()
  let previousItemId: string | null = null

  for (const [entryIndex, entry] of entries.entries()) {
    const { payload } = entry
    if (payload.call_id) {
      const directItem = itemsById.get(payload.call_id)
      if (directItem && directItem.type !== 'userMessage' && directItem.type !== 'agentMessage') {
        const records = rawRecordsByItemId.get(directItem.id) ?? []
        records.push(entry.record)
        rawRecordsByItemId.set(directItem.id, records)
      }
    }

    const normalizedItem = getMatchingNormalizedItem(payload, turn.items, itemsById, usedItemIds)
    if (normalizedItem) {
      if (!suppressedItemIds.has(normalizedItem.id)) previousItemId = normalizedItem.id
      continue
    }

    if (payload.type !== 'custom_tool_call') continue

    const customMerge = getCustomToolMerge(entry, entries, entryIndex, itemsById)
    customMerge.normalizedChildIds.forEach((itemId) => suppressedItemIds.add(itemId))
    if (customMerge.items.length === 0) continue

    if (!previousItemId) {
      beforeFirstItem.push(...customMerge.items)
      continue
    }

    const trailingItems = itemsAfter.get(previousItemId) ?? []
    trailingItems.push(...customMerge.items)
    itemsAfter.set(previousItemId, trailingItems)
  }

  const normalizedItems = turn.items
    .filter((item) => !suppressedItemIds.has(item.id))
    .map((item) => {
      const rawRecords = rawRecordsByItemId.get(item.id)
      return rawRecords ? { ...item, rawToolData: [item, ...rawRecords] } : item
    })

  return {
    ...turn,
    items: [
      ...beforeFirstItem,
      ...normalizedItems.flatMap((item) => [item, ...(itemsAfter.get(item.id) ?? [])])
    ]
  }
}

export const mergeRolloutHistory = async (
  turns: CodexTurn[],
  rolloutPath: string | null
): Promise<CodexTurn[]> => {
  if (!rolloutPath) return turns

  try {
    const entries = parseRollout(await readFile(rolloutPath, 'utf8'))
    const entriesByTurn = groupEntriesByTurn(entries)
    return turns.map((turn) => {
      const turnEntries = entriesByTurn.get(turn.id)
      return turnEntries ? mergeTurnEntries(turn, turnEntries) : turn
    })
  } catch {
    return turns
  }
}

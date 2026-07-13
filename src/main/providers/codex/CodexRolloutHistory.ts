import { readFile } from 'node:fs/promises'
import type { CodexThreadItem, CodexTurn } from './CodexItemRenderers'

type RolloutPatchChange = {
  type?: 'add' | 'delete' | 'update'
  unified_diff?: string
  content?: string
  move_path?: string | null
}

type RolloutPayload = {
  type: string
  turn_id?: string
  client_id?: string
  call_id?: string
  id?: string
  name?: string
  input?: string
  arguments?: unknown
  output?: unknown
  message?: string
  last_agent_message?: string
  phase?: 'commentary' | 'final_answer' | null
  changes?: Record<string, RolloutPatchChange>
  [key: string]: unknown
}

type RolloutRecord = {
  payload?: RolloutPayload
  [key: string]: unknown
}

type RolloutEntry = {
  record: RolloutRecord
  payload: RolloutPayload
  index: number
}

type NestedToolCall = {
  name: string
  offset: number
}

const isToolCallPayload = (payload: RolloutPayload): boolean =>
  payload.type === 'custom_tool_call' ||
  payload.type === 'function_call' ||
  payload.type === 'tool_search_call'

const getToolCallOutputType = (payload: RolloutPayload): string | null => {
  if (payload.type === 'function_call') return 'function_call_output'
  if (payload.type === 'custom_tool_call') return 'custom_tool_call_output'
  if (payload.type === 'tool_search_call') return 'tool_search_output'
  return null
}

const getToolCallName = (payload: RolloutPayload): string =>
  payload.name ?? (payload.type === 'tool_search_call' ? 'tool_search' : 'tool')

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

  contents.split('\n').forEach((line, index) => {
    if (!line.trim()) return

    try {
      const record = JSON.parse(line) as RolloutRecord
      if (record.payload?.type) entries.push({ record, payload: record.payload, index })
    } catch {
      // A malformed rollout row should not prevent the rest of the history from loading.
    }
  })

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

const getToolCallInput = (payload: RolloutPayload): string | null => {
  if (typeof payload.input === 'string') return payload.input
  if (typeof payload.arguments === 'string') {
    return `tools.${getToolCallName(payload)}(${payload.arguments})`
  }
  if (payload.arguments !== undefined) {
    return `tools.${getToolCallName(payload)}(${JSON.stringify(payload.arguments)})`
  }
  return null
}

const getOutputEntry = (
  entries: RolloutEntry[],
  entryIndex: number,
  payload: RolloutPayload
): RolloutEntry | null => {
  const outputType = getToolCallOutputType(payload)
  if (!outputType || !payload.call_id) return null

  return (
    entries.find(
      (candidate, index) =>
        index > entryIndex &&
        candidate.payload.type === outputType &&
        candidate.payload.call_id === payload.call_id
    ) ?? null
  )
}

const getPatchEntryForToolCall = (
  entries: RolloutEntry[],
  entryIndex: number,
  outputEntry: RolloutEntry | null
): RolloutEntry | null => {
  const searchEnd = outputEntry ? entries.indexOf(outputEntry) : entryIndex + 8

  for (let index = entryIndex + 1; index <= searchEnd && index < entries.length; index += 1) {
    if (entries[index].payload.type === 'patch_apply_end') return entries[index]
  }

  return null
}

const isPatchToolCall = (input: string, calls: NestedToolCall[]): boolean =>
  calls.some((call) => call.name === 'apply_patch') || input.includes('*** Begin Patch')

const getPatchChanges = (payload: RolloutPayload): CodexThreadItem['changes'] => {
  if (!payload.changes) return []

  return Object.entries(payload.changes).flatMap(([path, change]) => {
    if (!change.type) return []

    return {
      path,
      kind:
        change.type === 'update'
          ? ({ type: 'update', move_path: change.move_path ?? null } as const)
          : ({ type: change.type } as const),
      diff: change.unified_diff ?? change.content ?? ''
    }
  })
}

const getRawEntriesBetween = (
  entries: RolloutEntry[],
  startIndex: number,
  endEntry: RolloutEntry | null,
  extraEntries: RolloutEntry[] = []
): unknown[] => {
  const endIndex = endEntry ? entries.indexOf(endEntry) : startIndex
  const rawEntries = entries.slice(startIndex, endIndex + 1).map((entry) => entry.record)

  for (const entry of extraEntries) {
    if (!rawEntries.includes(entry.record)) rawEntries.push(entry.record)
  }

  return rawEntries
}

const createToolItems = (
  entry: RolloutEntry,
  entries: RolloutEntry[],
  entryIndex: number,
  usedPatchEntryIndexes: Set<number>
): CodexThreadItem[] => {
  const { payload } = entry
  const input = getToolCallInput(payload)
  const outputEntry = getOutputEntry(entries, entryIndex, payload)
  const output = outputEntry?.payload.output ?? null

  if (!input) {
    return [
      {
        type: 'customToolCall',
        id: payload.id ?? payload.call_id ?? `${payload.type}:${entry.index}`,
        customToolName: getToolCallName(payload),
        customToolInput:
          payload.arguments === undefined
            ? null
            : typeof payload.arguments === 'string'
              ? payload.arguments
              : JSON.stringify(payload.arguments),
        customToolOutput: output,
        rawToolData: getRawEntriesBetween(entries, entryIndex, outputEntry)
      }
    ]
  }

  const nestedCalls = getNestedToolCalls(input)
  const patchEntry = getPatchEntryForToolCall(entries, entryIndex, outputEntry)

  if (patchEntry && isPatchToolCall(input, nestedCalls)) {
    usedPatchEntryIndexes.add(patchEntry.index)
    return [
      {
        type: 'fileChange',
        id: payload.id ?? payload.call_id ?? `patch:${entry.index}`,
        changes: getPatchChanges(patchEntry.payload),
        rawToolData: getRawEntriesBetween(entries, entryIndex, outputEntry, [patchEntry])
      }
    ]
  }

  const calls =
    nestedCalls.length > 0 ? nestedCalls : [{ name: getToolCallName(payload), offset: 0 }]

  return calls.map((call, index) => ({
    type: 'customToolCall',
    id: `${payload.id ?? payload.call_id ?? `${payload.type}:${entry.index}`}:${index}`,
    customToolName: call.name,
    customToolInput: input.slice(call.offset),
    customToolOutput: output,
    rawToolData: getRawEntriesBetween(entries, entryIndex, outputEntry)
  }))
}

const createStandalonePatchItem = (entry: RolloutEntry): CodexThreadItem => ({
  type: 'fileChange',
  id: entry.payload.call_id ?? entry.payload.id ?? `patch:${entry.index}`,
  changes: getPatchChanges(entry.payload),
  rawToolData: [entry.record]
})

const createUserMessageItem = (entry: RolloutEntry): CodexThreadItem | null => {
  const message = entry.payload.message?.trim()
  if (!message) return null

  return {
    type: 'userMessage',
    id: entry.payload.client_id ?? entry.payload.id ?? `user:${entry.index}`,
    content: [{ type: 'text', text: message }],
    rawToolData: [entry.record]
  }
}

const createAgentMessageItem = (entry: RolloutEntry): CodexThreadItem | null => {
  const message = entry.payload.message?.trim()
  if (!message) return null

  return {
    type: 'agentMessage',
    id: entry.payload.id ?? `agent:${entry.index}`,
    text: message,
    phase: entry.payload.phase ?? null,
    rawToolData: [entry.record]
  }
}

const createTaskCompleteFallbackItem = (
  entry: RolloutEntry,
  hasFinalAgentMessage: boolean
): CodexThreadItem | null => {
  if (hasFinalAgentMessage) return null

  const message = entry.payload.last_agent_message?.trim()
  if (!message) return null

  return {
    type: 'agentMessage',
    id: entry.payload.id ?? `task-complete:${entry.index}`,
    text: message,
    phase: 'final_answer',
    rawToolData: [entry.record]
  }
}

const createContextCompactionItem = (entry: RolloutEntry): CodexThreadItem => ({
  type: 'contextCompaction',
  id: entry.payload.id ?? `context-compaction:${entry.index}`,
  rawToolData: [entry.record]
})

const createTurn = (turnId: string, entries: RolloutEntry[]): CodexTurn => {
  const items: CodexThreadItem[] = []
  const usedPatchEntryIndexes = new Set<number>()
  const hasFinalAgentMessage = entries.some(
    (entry) => entry.payload.type === 'agent_message' && entry.payload.phase === 'final_answer'
  )

  entries.forEach((entry, entryIndex) => {
    const { payload } = entry

    if (payload.type === 'user_message') {
      const item = createUserMessageItem(entry)
      if (item) items.push(item)
      return
    }

    if (payload.type === 'agent_message') {
      const item = createAgentMessageItem(entry)
      if (item) items.push(item)
      return
    }

    if (isToolCallPayload(payload)) {
      items.push(...createToolItems(entry, entries, entryIndex, usedPatchEntryIndexes))
      return
    }

    if (payload.type === 'patch_apply_end' && !usedPatchEntryIndexes.has(entry.index)) {
      items.push(createStandalonePatchItem(entry))
      return
    }

    if (payload.type === 'task_complete') {
      const item = createTaskCompleteFallbackItem(entry, hasFinalAgentMessage)
      if (item) items.push(item)
      return
    }

    if (payload.type === 'context_compacted') {
      items.push(createContextCompactionItem(entry))
    }
  })

  return { id: turnId, items }
}

export const loadRolloutHistory = async (rolloutPath: string | null): Promise<CodexTurn[]> => {
  if (!rolloutPath) return []

  try {
    const entriesByTurn = groupEntriesByTurn(parseRollout(await readFile(rolloutPath, 'utf8')))
    return [...entriesByTurn.entries()].map(([turnId, entries]) => createTurn(turnId, entries))
  } catch {
    return []
  }
}

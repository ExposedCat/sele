import type {
  ProviderChatItem,
  ProviderFileDiff,
  ProviderMessage,
  ProviderToolActivity,
  ProviderWorkingItem,
  ProviderWorkingTool
} from '../../../shared/provider'

export type CodexUserInput =
  | { type: 'text'; text: string }
  | { type: 'image' | 'localImage' }
  | { type: 'skill' | 'mention'; name: string }

export type CodexThreadItem = {
  type: string
  id: string
  content?: CodexUserInput[]
  text?: string
  phase?: 'commentary' | 'final_answer' | null
  command?: string
  server?: string
  tool?: string
  namespace?: string | null
  query?: string
  changes?: {
    path: string
    kind: { type: 'add' | 'delete' } | { type: 'update'; move_path: string | null }
    diff: string
  }[]
  aggregatedOutput?: string | null
  result?: unknown
  error?: unknown
  customToolName?: string
  customToolInput?: string
  customToolOutput?: unknown
  rawToolData?: unknown[]
}

export type CodexTurn = {
  id: string
  items: CodexThreadItem[]
}

type WorkingItemRenderResult =
  | { type: 'message'; content: string }
  | {
      type: 'tool'
      activity: ProviderToolActivity
      label: string
      command: string | null
      stdout: string | null
      diffs: ProviderFileDiff[]
      raw: unknown[]
    }

type WorkingItemRenderMatcher = {
  matches: (item: CodexThreadItem) => boolean
  render: (item: CodexThreadItem) => WorkingItemRenderResult | WorkingItemRenderResult[] | null
}

type ShellToken = {
  value: string
  quoted: boolean
}

const truncate = (value: string, length = 120): string =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value

const getFileName = (path: string): string => path.split(/[/\\]/).pop() || path

const tokenizeShellCommand = (command: string): ShellToken[] => {
  const tokens: ShellToken[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false
  let quoted = false

  const pushCurrent = (): void => {
    if (!current) return
    tokens.push({ value: current, quoted })
    current = ''
    quoted = false
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    const nextCharacter = command[index + 1]

    if (escaped) {
      current += character
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      quoted = true
      continue
    }

    if (/\s/.test(character)) {
      pushCurrent()
      continue
    }

    if (character === ';' || character === '|' || (character === '&' && nextCharacter === '&')) {
      pushCurrent()
      tokens.push({ value: character === '&' ? '&&' : character, quoted: false })
      if (character === '&') index += 1
      continue
    }

    current += character
  }

  pushCurrent()
  return tokens
}

const isPathLikeToken = (token: string): boolean =>
  token.length > 0 &&
  token !== '-' &&
  !token.startsWith('-') &&
  !token.startsWith('$') &&
  !token.includes('=') &&
  !['>', '>>', '<', '2>', '2>>', '&>'].includes(token)

const skipOptions = (
  tokens: ShellToken[],
  optionValueFlags = new Set(['-C', '-d', '-e', '-f', '-g', '-m', '-p'])
): ShellToken[] => {
  const remaining: ShellToken[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value
    if (value === '--') {
      remaining.push(...tokens.slice(index + 1))
      break
    }
    if (!value.startsWith('-') || value === '-') {
      remaining.push(tokens[index])
      continue
    }
    if (
      optionValueFlags.has(value) &&
      tokens[index + 1] &&
      !tokens[index + 1].value.startsWith('-')
    ) {
      index += 1
    }
  }

  return remaining
}

const extractReadPathsFromSegment = (segment: ShellToken[]): string[] => {
  if (segment.length === 0) return []

  const [first, second, ...rest] = segment
  const executable = getFileName(first.value)
  const command = executable === 'command' && second?.value === '-v' ? 'command -v' : executable
  const args = command === 'command -v' ? rest : segment.slice(1)

  if (['pwd', 'which', 'command -v'].includes(command)) return []

  if (command === 'git') {
    const subcommand = args[0]?.value
    if (!subcommand || !['status', 'diff', 'log', 'show', 'branch'].includes(subcommand)) return []
    const pathSeparatorIndex = args.findIndex((token) => token.value === '--')
    return pathSeparatorIndex >= 0
      ? args
          .slice(pathSeparatorIndex + 1)
          .map((token) => token.value)
          .filter(isPathLikeToken)
      : []
  }

  if (command === 'sed') {
    const remaining = skipOptions(args)
    return remaining
      .slice(1)
      .map((token) => token.value)
      .filter(isPathLikeToken)
  }

  if (command === 'rg' || command === 'grep') {
    const hasFilesMode = args.some((token) => token.value === '--files')
    const remaining = skipOptions(args)
    return remaining
      .slice(hasFilesMode ? 0 : 1)
      .map((token) => token.value)
      .filter(isPathLikeToken)
  }

  if (
    [
      'cat',
      'head',
      'tail',
      'nl',
      'wc',
      'stat',
      'file',
      'tree',
      'du',
      'realpath',
      'readlink',
      'ls',
      'find'
    ].includes(command)
  ) {
    return skipOptions(args, new Set(command === 'head' || command === 'tail' ? ['-c', '-n'] : []))
      .map((token) => token.value)
      .filter(isPathLikeToken)
  }

  return []
}

const getReadCommandPaths = (command: string): string[] => {
  const paths: string[] = []
  let segment: ShellToken[] = []

  for (const token of tokenizeShellCommand(command)) {
    if ([';', '|', '&&'].includes(token.value)) {
      paths.push(...extractReadPathsFromSegment(segment))
      segment = []
      continue
    }
    segment.push(token)
  }

  paths.push(...extractReadPathsFromSegment(segment))
  return [...new Set(paths.map(getFileName))]
}

const getReadToolLabel = (command: string): string => {
  const files = getReadCommandPaths(command)
  if (files.length === 0) return 'Read files'

  const visibleFiles = files.slice(0, 3).join(', ')
  return files.length === 1
    ? `Read file ${visibleFiles}`
    : `Read files ${visibleFiles}${files.length > 3 ? ', …' : ''}`
}

const getJsonToolArgument = (input: string, toolName: string): Record<string, unknown> | null => {
  const markerIndex = input.indexOf(`tools.${toolName}(`)
  const objectStart = input.indexOf('{', markerIndex)
  if (markerIndex < 0 || objectStart < 0) return null

  let depth = 0
  let quote: string | null = null
  let escaped = false

  for (let index = objectStart; index < input.length; index += 1) {
    const character = input[index]

    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      continue
    }

    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth !== 0) continue

    try {
      return JSON.parse(input.slice(objectStart, index + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }

  return null
}

const getToolStringArgument = (input: string, toolName: string, key: string): string | null => {
  const parsedValue = getJsonToolArgument(input, toolName)?.[key]
  if (typeof parsedValue === 'string') return parsedValue

  const markerIndex = input.indexOf(`tools.${toolName}(`)
  if (markerIndex < 0) return null

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = input
    .slice(markerIndex)
    .match(new RegExp(`["']?${escapedKey}["']?\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`))
  if (!match) return null

  try {
    const value = JSON.parse(match[1])
    return typeof value === 'string' ? value : null
  } catch {
    return match[1]
      .slice(1, -1)
      .replace(/\\(u[\dA-Fa-f]{4}|x[\dA-Fa-f]{2}|[\\"'bfnrtv0])/g, (_, escape: string) => {
        if (escape.startsWith('u')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))
        if (escape.startsWith('x')) return String.fromCharCode(Number.parseInt(escape.slice(1), 16))

        return (
          {
            '\\': '\\',
            '"': '"',
            "'": "'",
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
            v: '\v',
            0: '\0'
          } as Record<string, string>
        )[escape]
      })
  }
}

const isReadCommand = (command: string): boolean => {
  const hasReadAction =
    /(^|[;&|]\s*)(pwd|rg|grep|sed\s+-n|find|ls|cat|head|tail|nl|wc|stat|file|tree|du|realpath|readlink|which|command\s+-v|git\s+(status|diff|log|show|branch))\b/m.test(
      command
    )
  const hasExecutionAction =
    /(^|[;&|]\s*)(npm|npx|pnpm|yarn|node|python|python3|deno|bun|cargo|go|make|cmake|pytest|vitest|jest|eslint|tsc|vite|electron|codex)\b/m.test(
      command
    )
  return hasReadAction && !hasExecutionAction
}

const getCustomToolLabel = (item: CodexThreadItem): string | null => {
  const name = item.customToolName
  if (!name) return null

  if (name === 'exec_command') {
    const command = getToolStringArgument(item.customToolInput ?? '', name, 'cmd')
    return command && isReadCommand(command) ? getReadToolLabel(command) : 'Ran a command'
  }

  if (name === 'write_stdin') return 'Interacted with a command'
  if (name === 'view_image') return 'Viewed an image'
  if (name.startsWith('web__')) return 'Searched the web'
  if (name.startsWith('image_gen__')) return 'Generated an image'

  if (name.startsWith('mcp__')) {
    const [server, ...toolParts] = name.slice(5).split('__')
    const tool = toolParts.join('/')
    return `Called ${tool ? `${server}/${tool}` : server}`
  }

  return name === 'exec' ? 'Ran a tool' : `Used ${name}`
}

const getOutputFromEnvelope = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const envelope = value as { output?: unknown; stdout?: unknown; result?: unknown }
  if (typeof envelope.output === 'string') return envelope.output.trimEnd() || null
  if (typeof envelope.stdout === 'string') return envelope.stdout.trimEnd() || null
  return getOutputFromEnvelope(envelope.result)
}

const getOutputFromText = (text: string): string | null => {
  const outputMarker = '\nOutput:\n'
  const outputIndex = text.indexOf(outputMarker)
  const output = outputIndex >= 0 ? text.slice(outputIndex + outputMarker.length) : text
  const trimmedOutput = output.trimEnd()
  if (!trimmedOutput) return null

  try {
    const parsed = JSON.parse(trimmedOutput) as unknown
    return getOutputFromEnvelope(parsed) ?? trimmedOutput
  } catch {
    return trimmedOutput
  }
}

const getToolStdout = (value: unknown): string | null => {
  if (typeof value === 'string') return getOutputFromText(value)

  const envelopeOutput = getOutputFromEnvelope(value)
  if (envelopeOutput != null) return envelopeOutput

  if (!Array.isArray(value)) return null

  const text = value
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const candidate = part as { text?: unknown }
      return typeof candidate.text === 'string' ? candidate.text : ''
    })
    .join('')
  return getOutputFromText(text)
}

const getFileDiffs = (item: CodexThreadItem): ProviderFileDiff[] =>
  (item.changes ?? []).map((change) => ({
    path: change.path,
    kind: change.kind.type === 'add' ? 'create' : change.kind.type === 'delete' ? 'delete' : 'edit',
    diff: change.diff
  }))

const renderTool = (
  item: CodexThreadItem,
  activity: ProviderToolActivity,
  label: string,
  command: string | null = null,
  stdout: string | null = null,
  diffs: ProviderFileDiff[] = []
): WorkingItemRenderResult => ({
  type: 'tool',
  activity,
  label,
  command,
  stdout,
  diffs,
  raw: item.rawToolData ?? [item]
})

const renderFileChanges = (item: CodexThreadItem): WorkingItemRenderResult[] => {
  const diffs = getFileDiffs(item)
  if (diffs.length === 0) return [renderTool(item, 'edit', 'Changed files')]

  const results: WorkingItemRenderResult[] = []
  for (const diff of diffs) {
    const previous = results.at(-1)
    if (previous?.type === 'tool' && previous.activity === diff.kind) {
      previous.diffs.push(diff)
      continue
    }

    results.push(renderTool(item, diff.kind, '', null, null, [diff]))
  }

  for (const result of results) {
    if (result.type !== 'tool') continue
    const files = [...new Set(result.diffs.map((diff) => getFileName(diff.path)))]
    const visibleFiles = files.slice(0, 3).join(', ')
    result.label =
      result.activity === 'create'
        ? `Created ${visibleFiles || 'a file'}${files.length > 3 ? ', …' : ''}`
        : result.activity === 'delete'
          ? `Deleted ${visibleFiles || 'a file'}${files.length > 3 ? ', …' : ''}`
          : `Changed ${visibleFiles || 'files'}${files.length > 3 ? ', …' : ''}`
  }

  return results
}

const workingItemRenderMatchers: WorkingItemRenderMatcher[] = [
  {
    matches: (item) => item.type === 'agentMessage',
    render: (item) => {
      const content = item.text?.trim()
      return content ? { type: 'message', content } : null
    }
  },
  {
    matches: (item) => item.type === 'customToolCall',
    render: (item) => {
      if (item.customToolName === 'apply_patch') return renderFileChanges(item)

      const label = getCustomToolLabel(item)
      if (!label) return null

      const command =
        item.customToolName === 'exec_command'
          ? getToolStringArgument(item.customToolInput ?? '', item.customToolName, 'cmd')
          : null
      const isRead = command != null && isReadCommand(command)
      return renderTool(
        item,
        isRead ? 'read' : item.customToolName === 'exec_command' ? 'command' : 'other',
        label,
        command,
        getToolStdout(item.customToolOutput)
      )
    }
  },
  {
    matches: (item) => item.type === 'commandExecution',
    render: (item) => {
      const command = item.command?.replace(/\s+/g, ' ')
      const activity = item.command && isReadCommand(item.command) ? 'read' : 'command'
      return command
        ? renderTool(
            item,
            activity,
            activity === 'read' && item.command
              ? getReadToolLabel(item.command)
              : `Ran ${truncate(command)}`,
            item.command ?? null,
            getToolStdout(item.aggregatedOutput)
          )
        : null
    }
  },
  {
    matches: (item) => item.type === 'fileChange',
    render: renderFileChanges
  },
  {
    matches: (item) => item.type === 'mcpToolCall',
    render: (item) => {
      if (!item.tool) return null
      const name = item.server ? `${item.server}/${item.tool}` : item.tool
      return renderTool(item, 'other', `Called ${name}`)
    }
  },
  {
    matches: (item) => item.type === 'dynamicToolCall',
    render: (item) => {
      if (!item.tool) return null
      const name = item.namespace ? `${item.namespace}/${item.tool}` : item.tool
      return renderTool(item, 'other', `Called ${name}`)
    }
  },
  {
    matches: (item) => item.type === 'collabAgentToolCall',
    render: (item) => (item.tool ? renderTool(item, 'other', `Used ${item.tool}`) : null)
  },
  {
    matches: (item) => item.type === 'webSearch',
    render: (item) =>
      item.query ? renderTool(item, 'other', `Searched for “${truncate(item.query, 80)}”`) : null
  },
  {
    matches: (item) => item.type === 'imageView',
    render: (item) => renderTool(item, 'other', 'Viewed an image')
  },
  {
    matches: (item) => item.type === 'imageGeneration',
    render: (item) => renderTool(item, 'other', 'Generated an image')
  }
]

const renderWorkingItems = (item: CodexThreadItem, turnId: string): ProviderWorkingItem[] => {
  const matcher = workingItemRenderMatchers.find((candidate) => candidate.matches(item))
  const result = matcher?.render(item)
  if (!result) return []

  const results = Array.isArray(result) ? result : [result]
  return results.map((workingItem, index) => ({
    ...workingItem,
    id: `${turnId}:${item.id}${results.length > 1 ? `:${index}` : ''}`
  }))
}

const groupConsecutiveEdits = (items: ProviderWorkingItem[]): ProviderWorkingItem[] => {
  const groupedItems: ProviderWorkingItem[] = []

  for (let index = 0; index < items.length;) {
    const item = items[index]
    if (item.type !== 'tool' || item.activity !== 'edit') {
      groupedItems.push(item)
      index += 1
      continue
    }

    const tools: ProviderWorkingTool[] = []
    while (
      index < items.length &&
      items[index].type === 'tool' &&
      (items[index] as ProviderWorkingTool).activity === item.activity
    ) {
      tools.push(items[index] as ProviderWorkingTool)
      index += 1
    }

    if (tools.length === 1) {
      groupedItems.push(tools[0])
    } else {
      const files = [
        ...new Set(tools.flatMap((tool) => tool.diffs.map((diff) => getFileName(diff.path))))
      ]
      const visibleFiles = files.slice(0, 3).join(', ')
      const label = `Changed ${visibleFiles || 'files'}${files.length > 3 ? ', …' : ''}`
      groupedItems.push({ type: 'toolGroup', id: `${tools[0].id}:group`, label, tools })
    }
  }

  return groupedItems
}

const getUserInputText = (input: CodexUserInput): string => {
  if (input.type === 'text') return input.text
  if (input.type === 'skill') return `$${input.name}`
  if (input.type === 'mention') return `@${input.name}`
  return '[Image]'
}

const getFinalMessageIndex = (items: CodexThreadItem[]): number => {
  const explicitFinalIndex = items.findLastIndex(
    (item) => item.type === 'agentMessage' && item.phase === 'final_answer'
  )
  if (explicitFinalIndex >= 0) return explicitFinalIndex

  const lastAgentMessageIndex = items.findLastIndex((item) => item.type === 'agentMessage')
  if (lastAgentMessageIndex < 0) return -1

  return items[lastAgentMessageIndex].phase === 'commentary' ? -1 : lastAgentMessageIndex
}

export const getChatItems = (turns: CodexTurn[]): ProviderChatItem[] => {
  const chatItems: ProviderChatItem[] = []

  for (const turn of turns) {
    const finalMessageIndex = getFinalMessageIndex(turn.items)
    let finalMessage: ProviderMessage | null = null
    const workingItems: ProviderWorkingItem[] = []

    for (const [itemIndex, item] of turn.items.entries()) {
      if (item.type === 'userMessage' && item.content) {
        const content = item.content.map(getUserInputText).filter(Boolean).join('\n').trim()
        if (content) {
          chatItems.push({
            type: 'message',
            id: `${turn.id}:${item.id}`,
            role: 'user',
            content
          })
        }
        continue
      }

      if (itemIndex === finalMessageIndex && item.text?.trim()) {
        finalMessage = {
          type: 'message',
          id: `${turn.id}:${item.id}`,
          role: 'assistant',
          content: item.text.trim()
        }
        continue
      }

      workingItems.push(...renderWorkingItems(item, turn.id))
    }

    if (workingItems.length > 0) {
      chatItems.push({
        type: 'working',
        id: `${turn.id}:working`,
        items: groupConsecutiveEdits(workingItems)
      })
    }
    if (finalMessage) chatItems.push(finalMessage)
  }

  return chatItems
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { Idea } from '../types'

// A side shelf: the person parks ideas while Claude works (no model turn),
// edits or deletes them, then sends the whole list to Claude with one press.
// Works alone (its own pane) or as one section of the side-stack pane.

const PANE = 'idea-shelf'
const STACK = 'side-stack'
const HEADER = 'Ideas I parked on my idea shelf while we worked:'
const MAX_IDEAS = 200
// In the shared stack the section keeps a row budget, so it never pushes the
// other sections off screen: the first few ideas, then "Show all".
const STACK_SHOWN = 6

const ideas = atom({ plugin: 'idea-shelf', key: 'ideas' } as const, [])
const nextId = atom({ plugin: 'idea-shelf', key: 'nextId' } as const, 1)
const editing = atom({ plugin: 'idea-shelf', key: 'editing' } as const, null)
const queued = atom({ plugin: 'idea-shelf', key: 'queued' } as const, [])
const expanded = atom({ plugin: 'idea-shelf', key: 'expanded' } as const, false)
// Set by the side-stack host plugin; this mod only reads it.
const hostPresent = atom({ plugin: 'side-stack', key: 'present' } as const, false)

async function isStacked($: EngineInterface): Promise<boolean> {
  try {
    return (await read($, hostPresent)) === true
  } catch {
    return false
  }
}

// ---- Saved shelf -------------------------------------------------------------
// The shelf is kept in $.store per folder, so a /clear (a new session) or an
// app reload brings it back. Only Delete, or a sent list entering the chat,
// takes an idea off. Saves run one after another and each reads the shelf as
// it is then, so the last save always holds the latest shelf.

let storeKey = 'ideas:default'
let saving: Promise<void> = Promise.resolve()

function saveIdeas($: EngineInterface): Promise<void> {
  saving = saving.then(async () => {
    try {
      await $.store.set(storeKey, { items: await read($, ideas), nextId: await read($, nextId) })
    } catch {
      // The shelf still holds for this session.
    }
  })
  return saving
}

async function loadIdeas($: EngineInterface, cwd: string): Promise<void> {
  storeKey = `ideas:${cwd}`
  try {
    const saved = (await $.store.get(storeKey)) as { items?: unknown; nextId?: unknown } | undefined
    if (saved === undefined || saved === null || !Array.isArray(saved.items)) return
    const items = (saved.items as Partial<Idea>[])
      .filter((i): i is Idea => typeof i?.id === 'number' && typeof i?.text === 'string')
      .slice(-MAX_IDEAS)
    // Ideas parked in this session before the load stay; saved ones go first.
    await update($, ideas, list => {
      const have = new Set(list.map(i => i.id))
      return [...items.filter(i => !have.has(i.id)), ...list].slice(-MAX_IDEAS)
    })
    const top = Math.max(Number(saved.nextId) || 1, ...items.map(i => i.id + 1))
    await update($, nextId, n => Math.max(n, top))
  } catch {
    // Starts empty.
  }
}

// ---- Pane --------------------------------------------------------------------

const openPane = async ($: EngineInterface, focus = false): Promise<void> => {
  const count = (await read($, ideas)).length
  await $.ui.open({
    id: PANE,
    title: count > 0 ? `Ideas (${count})` : 'Ideas',
    columns: 21,
    ...(focus ? { focus: true as const } : {}),
  })
}

// Brings the own pane's title up to date; a pane that fails never costs an idea.
// Inside the stack the host owns the pane and its title, so nothing to do.
const redraw = async ($: EngineInterface): Promise<void> => {
  try {
    if (await isStacked($)) return
    await openPane($)
  } catch {
    // Nothing to do: the shelf itself is unchanged.
  }
}

// Host present: no own pane (close it if it opened before the host loaded).
// Host absent: the own pane, as always.
const placePane = async ($: EngineInterface): Promise<void> => {
  try {
    if (await isStacked($)) await $.ui.close({ id: PANE })
    else await openPane($)
  } catch {
    // The engine said no (headless, narrow window): the shelf is unchanged.
  }
}

// ---- Shelf changes -----------------------------------------------------------

const clean = (raw: string): string => raw.trim().slice(0, 1000)

const addIdea = async ($: EngineInterface, raw: string): Promise<void> => {
  const text = clean(raw)
  if (text === '') return
  // update() writes atomically and resolves what it wrote, so two ideas at once get two ids.
  const id = (await update($, nextId, n => n + 1)) - 1
  await update($, ideas, list => [...list, { id, text }].slice(-MAX_IDEAS))
  await saveIdeas($)
  await redraw($)
}

const editIdea = async ($: EngineInterface, id: number, raw: string): Promise<void> => {
  const text = clean(raw)
  await update($, ideas, list => (text === '' ? list.filter(i => i.id !== id) : list.map(i => (i.id === id ? { ...i, text } : i))))
  await update($, editing, () => null)
  await saveIdeas($)
  await redraw($)
}

const removeIdea = async ($: EngineInterface, id: number): Promise<void> => {
  await update($, ideas, list => list.filter(i => i.id !== id))
  await update($, queued, q => q.filter(x => x !== id))
  await update($, editing, v => (v === id ? null : v))
  await saveIdeas($)
  await redraw($)
}

const removeIdeas = async ($: EngineInterface, ids: number[]): Promise<void> => {
  await update($, queued, q => q.filter(id => !ids.includes(id)))
  await update($, ideas, list => list.filter(i => !ids.includes(i.id)))
  await saveIdeas($)
  await redraw($)
}

const unsentIdeas = async ($: EngineInterface): Promise<Idea[]> => {
  const waiting = await read($, queued)
  return (await read($, ideas)).filter(i => !waiting.includes(i.id))
}

// Send does not empty the shelf first. The ideas stay, marked "sent, waiting
// for Claude", until the message enters the chat (the submit resolves, or the
// mod sees the prompt or its turn start); a plugin's prompt only enters once
// the session is idle. If it is dropped or fails, they are simply unmarked.
// The waiting mark lives in the session only, so after a /clear before the
// message entered they come back as normal ideas. The ideas are claimed in one
// atomic update, so two sends at once never send the same idea twice, and an
// idea parked meanwhile stays.
const sendAll = async ($: EngineInterface): Promise<void> => {
  const shelf = await read($, ideas)
  let list: Idea[] = []
  await update($, queued, q => {
    list = shelf.filter(i => !q.includes(i.id))
    return list.length === 0 ? q : [...q, ...list.map(i => i.id)]
  })
  if (list.length === 0) return
  const ids = list.map(i => i.id)
  let delivered = false
  try {
    await update($, editing, v => (v !== null && ids.includes(v) ? null : v))
    const lines = list.map((i, n) => `${n + 1}. ${i.text}`)
    let result: Awaited<ReturnType<typeof $.prompt.submit>> | undefined
    try {
      result = await $.prompt.submit({ text: [HEADER, ...lines].join('\n') })
    } catch {
      result = undefined
    }
    delivered = result !== undefined && result.drop === undefined
  } finally {
    if (delivered) await removeIdeas($, ids)
    else await update($, queued, q => q.filter(id => !ids.includes(id)))
  }
  if (!delivered) $.ui.toast('Ideas not delivered. They are back on the shelf.')
}

// Sent ideas entered the chat (their prompt or their turn started): they leave
// the shelf now. In the app the submit's promise may never settle. Matched by
// the numbered lines under the header, among the ideas still waiting.
const ideasEntered = async ($: EngineInterface, text: string): Promise<void> => {
  if (!text.includes(HEADER)) return
  const sent = new Set([...text.matchAll(/^\d+\. (.*)$/gm)].map(m => (m[1] ?? '').trim()))
  const waiting = await read($, queued)
  const ids = (await read($, ideas)).filter(i => waiting.includes(i.id) && sent.has(i.text)).map(i => i.id)
  if (ids.length > 0) await removeIdeas($, ids)
}

// ---- Drawing -----------------------------------------------------------------

// One drawing for both places. Inside the stack the keys carry an `idea-`
// prefix (other sections share the tree), a heading names the section, and
// only the first few ideas show until "Show all".
async function drawShelf<E extends ResolveInput>($: EngineInterface, e: E, stacked: boolean) {
  const table = $.ui.resolve(e)
  const { Box, Text, Button } = table
  // The mobile app draws no text field yet: /ideas <text> parks one there.
  const Input = 'Input' in table ? table.Input : undefined
  const k = stacked ? 'idea-' : ''
  const list = await read($, ideas)
  const editId = await read($, editing)
  const waiting = await read($, queued)
  const isExpanded = await read($, expanded)
  const unsent = list.filter(i => !waiting.includes(i.id)).length
  const shown = stacked && !isExpanded ? list.slice(0, STACK_SHOWN) : list

  return (
    <Box key={stacked ? 'idea-shelf' : 'shelf'} flexDirection="column" gap={1}>
      {stacked && <Text bold>{list.length > 0 ? `Ideas (${list.length})` : 'Ideas'}</Text>}
      {Input !== undefined ? (
        <Input key={`${k}new`} placeholder="Park an idea" submitLabel="park" onSubmit={(value: string) => addIdea($, value)} />
      ) : (
        <Text dimColor>Type /ideas your idea to park one.</Text>
      )}
      {list.length === 0 && <Text dimColor>No ideas parked.</Text>}
      {shown.map(i => {
        const isWaiting = waiting.includes(i.id)
        return (
          <Box key={`idea-${i.id}`} flexDirection="column">
            {editId === i.id && Input !== undefined && !isWaiting ? (
              <Input
                key={`${k}edit-input-${i.id}`}
                value={i.text}
                submitLabel="save"
                autoFocus
                onSubmit={(value: string) => editIdea($, i.id, value)}
              />
            ) : (
              <Text wrap="wrap">• {i.text}</Text>
            )}
            {isWaiting && <Text dimColor>sent, waiting for Claude</Text>}
            <Box flexDirection="row" gap={1}>
              {Input !== undefined && !isWaiting && (
                <Button key={`${k}edit-${i.id}`} plain onPress={() => update($, editing, v => (v === i.id ? null : i.id))}>
                  {editId === i.id ? 'Cancel' : 'Edit'}
                </Button>
              )}
              <Button key={`${k}del-${i.id}`} plain onPress={() => removeIdea($, i.id)}>
                Delete
              </Button>
            </Box>
          </Box>
        )
      })}
      {stacked && list.length > STACK_SHOWN && (
        <Button key="idea-more" plain onPress={() => update($, expanded, v => !v)}>
          {isExpanded ? 'Show fewer' : `Show all ${list.length}`}
        </Button>
      )}
      {unsent > 0 && (
        <Button key={`${k}send`} variant="primary" onPress={() => sendAll($)}>
          {`Send ${unsent}`}
        </Button>
      )}
    </Box>
  )
}

// ---- Hooks -------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadIdeas($, e.cwd)
    await $.command.register({
      name: 'ideas',
      description: 'Open the idea shelf (or: /ideas <text> to park one, /ideas send)',
      argumentHint: '<idea>|send',
    })
    void placePane($)
    // Plugin load order is unknown: the host may set its flag after this
    // start. Look once more about a second later.
    try {
      $.clock.after(1000, () => void placePane($))
    } catch {
      // No clock: the first look stands.
    }
    return next(e)
  })

  on('command.run', { command: 'ideas' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg.toLowerCase() === 'send') {
      const count = (await unsentIdeas($)).length
      if (count === 0) return { text: 'No ideas to send.' }
      // Not awaited: a prompt from a mod waits until Claude's turn ends.
      void sendAll($).catch(() => undefined)
      return { text: `Sending ${count} idea${count === 1 ? '' : 's'} to Claude.` }
    }
    if (arg !== '') {
      await addIdea($, arg)
      return { text: 'Idea parked on the shelf.' }
    }
    if (await isStacked($)) {
      // The host's /stack opens the shared pane. Not awaited: a command run
      // from a mod is queued until the session is idle.
      void $.command.run({ command: 'stack' }).catch(() => undefined)
      return { text: 'The idea shelf is in the Stack pane.' }
    }
    await openPane($, true)
    return { text: 'Idea shelf opened.' }
  })

  // The mod's own prompt passing through: the sent ideas entered.
  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin as { kind: string; name?: string } | undefined
    if (origin?.kind === 'plugin' && origin.name === $.plugin.name) await ideasEntered($, e.text ?? '').catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The sent ideas' turn starting: they entered.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await ideasEntered($, e.text).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (await isStacked($)) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The idea shelf is in the Stack pane.</Text>
    }
    return drawShelf($, e, false)
  })

  // Inside the side-stack pane: this section, then every other section below.
  on('ui.render', { component: 'Pane', requestId: STACK }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)
    let section = null
    try {
      section = await drawShelf($, e, true)
    } catch {
      // A broken section never takes the others down.
    }
    const below = await next(e)
    return (
      <Box flexDirection="column" gap={1}>
        {section}
        {below}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput } from 'claude-code'

import type { Idea, ShelfIdea } from '../types'

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
// Section order (side-stack protocol v4): the section is keyed so side-stack
// can move it, and side-stack leaves an empty Box keyed SLOT_KEY where it wants
// a section that sits above it in the chain.
const SECTION_KEY = 'side-stack:idea-shelf'
const SLOT_KEY = 'side-stack:slot:idea-shelf'

const ideas = atom({ plugin: 'idea-shelf', key: 'ideas' } as const, [])
const nextId = atom({ plugin: 'idea-shelf', key: 'nextId' } as const, 1)
const editing = atom({ plugin: 'idea-shelf', key: 'editing' } as const, null)
const expanded = atom({ plugin: 'idea-shelf', key: 'expanded' } as const, false)
// Published for side-stack: true while this shelf draws inside the stack.
const stackedFlag = atom({ plugin: 'idea-shelf', key: 'stacked' } as const, false)
const loadedFor = atom({ plugin: 'idea-shelf', key: 'loadedFor' } as const, null)

// Line breaks and runs of spaces become one space, so every idea is one line
// of the sent message and the line can be matched when the message enters.
const clean = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, 1000)

const plain = (i: ShelfIdea): Idea => ({ id: i.id, text: i.text })

// ---- side-stack --------------------------------------------------------------

// side-stack counts as present when its /stack command is live. That alone:
// its `present` state is per session and is gone after a /clear.
async function hostPresent($: EngineInterface): Promise<boolean> {
  try {
    const commands = await $.command.list()
    return commands.some(c => c.name === 'stack' && (c.plugin ?? '').split('@')[0] === 'side-stack')
  } catch {
    return false
  }
}

// Checks the host and keeps the published `stacked` flag in step with it. A
// render hook may not write state: there `publish` is false and the write is
// left to a timer.
async function isStacked($: EngineInterface, publish = true): Promise<boolean> {
  const stacked = await hostPresent($)
  try {
    if ((await read($, stackedFlag)) !== stacked) {
      if (publish) await update($, stackedFlag, () => stacked)
      else later($, () => void isStacked($))
    }
  } catch {
    // The flag is a courtesy to side-stack; the shelf works without it.
  }
  return stacked
}

// Runs `fn` as its own dispatch, right after the current one.
function later($: EngineInterface, fn: () => void): void {
  try {
    $.clock.after(0, fn)
  } catch {
    // No clock: the next event does it.
  }
}

// ---- Saved shelf -------------------------------------------------------------
// The shelf is kept in $.store per folder. The store is one file shared by
// every session of every folder, so a change never writes this session's copy
// over it: each change re-reads the saved shelf, applies itself to that, and
// writes the result (another session's ideas stay). Changes run one after
// another. An empty shelf removes its key. The "sent" marks are never saved.

type Saved = { items: Idea[]; nextId: number }

let storeKey = 'ideas:default'
let chain: Promise<void> = Promise.resolve()
// Changes this session holds that the store lacks: the store could not be read
// (nothing is written then, it would go over ideas this session never saw), or
// the write failed. `unread` keeps the shelf as this session last knew the
// store, before those changes; the next good read applies the difference
// (adds, edits and deletes, see rebase) to the saved shelf and writes it.
let unread: Saved | null = null
let failureLogged = false

function logOnce($: EngineInterface, text: string): void {
  if (failureLogged) return
  failureLogged = true
  try {
    $.ui.log(text)
  } catch {
    // Nowhere to say it.
  }
}
// The session the shelf was loaded for is kept in the session state itself
// (`loadedFor`), not in a module variable. On a real /clear the engine goes on
// under a new session id, empties $.state and keeps module variables, and
// events can reach the mod between session.end and the emptying; a module
// variable then says "loaded" while the shelf is empty (seen in a real
// session, 0.3.0). A marker in $.state goes when the state goes.

function parseSaved(raw: unknown): Saved | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object') return undefined
  const value = raw as { items?: unknown; nextId?: unknown }
  if (!Array.isArray(value.items)) return undefined
  const seen = new Set<number>()
  const items: Idea[] = []
  for (const one of value.items as Partial<Idea>[]) {
    if (typeof one?.id !== 'number' || typeof one?.text !== 'string' || seen.has(one.id)) continue
    const text = clean(one.text)
    if (text === '') continue
    seen.add(one.id)
    items.push({ id: one.id, text })
  }
  const top = Math.max(Number(value.nextId) || 1, ...items.map(i => i.id + 1))
  return { items: items.slice(-MAX_IDEAS), nextId: top }
}

async function writeSaved($: EngineInterface, saved: Saved): Promise<void> {
  if (saved.items.length === 0) await $.store.delete(storeKey)
  else await $.store.set(storeKey, saved)
}

// A full store (4 MiB in all): empty shelves of other folders are dropped
// before one more try. Reported once per process.
async function writeWithRoom($: EngineInterface, saved: Saved): Promise<void> {
  try {
    await writeSaved($, saved)
    return
  } catch (first) {
    try {
      for (const key of await $.store.keys()) {
        if (key === storeKey || !key.startsWith('ideas:')) continue
        const other = parseSaved(await $.store.get(key))
        if (other === undefined || other.items.length === 0) await $.store.delete(key)
      }
      await writeSaved($, saved)
    } catch {
      throw first
    }
  }
}

/** `saved` with this session's changes from `before` to `now`: an idea new
 *  here is added with a new id (its local id may be taken), an edit or delete
 *  applies only to an idea the store still holds as this session last saw it. */
function rebase(saved: Saved, before: Idea[], now: Idea[]): Saved {
  const was = new Map(before.map(i => [i.id, i.text]))
  const is = new Map(now.map(i => [i.id, i.text]))
  const items: Idea[] = []
  for (const i of saved.items) {
    if (was.get(i.id) !== i.text) items.push(i)
    else if (is.has(i.id)) items.push({ id: i.id, text: is.get(i.id)! })
  }
  let next = saved.nextId
  for (const i of now) if (!was.has(i.id)) items.push({ id: next++, text: i.text })
  return { items, nextId: next }
}

type Change = (items: Idea[], next: number) => Saved

/** Applies `fn` to the saved shelf (or this session's, without a store) and
 *  shows the result; `write: false` only loads. */
function change($: EngineInterface, fn: Change, write = true): Promise<void> {
  const run = chain.then(async () => {
    // Fresh values: a read() answers as of the dispatch's start, and another
    // dispatch may have changed the shelf since; an update that keeps the
    // value resolves with what stands now.
    const local: Saved = { items: (await update($, ideas, c => c)).map(plain), nextId: await update($, nextId, n => n) }
    let base = local
    let readOk = false
    let readErr: unknown
    // The store as this read found it: what a failed write leaves `unread` at.
    let seen: Saved = local
    const pending = unread
    try {
      const saved = parseSaved(await $.store.get(storeKey))
      readOk = true
      const fresh: Saved = saved ?? { items: [], nextId: local.nextId }
      seen = fresh
      base = pending ? rebase(fresh, pending.items, local.items) : fresh
      base = { items: base.items, nextId: Math.max(base.nextId, local.nextId) }
      unread = null
    } catch (err) {
      // No store, or not readable now: this session's shelf is all there is.
      readErr = err
    }
    const result = fn(base.items, base.nextId)
    result.items = result.items.slice(-MAX_IDEAS)
    if (!readOk) {
      if (write) {
        // Never written over the store unseen: kept here until the next read.
        unread = unread ?? local
        logOnce($, `idea-shelf could not read the saved shelf (${String(readErr).slice(0, 200)}). Changes stay in this session and are saved once it can be read.`)
      }
    } else if (write || pending) {
      try {
        await writeWithRoom($, result)
      } catch (err) {
        // Kept here; the next good read applies it to the saved shelf.
        unread = seen
        logOnce($, `idea-shelf could not save the shelf (${String(err).slice(0, 200)}). Ideas stay for this session only.`)
      }
    }
    // Shown: the result, keeping this session's "sent" marks on ideas it still has.
    await update($, ideas, current =>
      result.items.map(i => {
        const mine = current.find(c => c.id === i.id)
        return mine?.sent !== undefined && mine.text === i.text ? { ...i, sent: mine.sent } : i
      }),
    )
    await update($, nextId, n => Math.max(n, result.nextId))
  })
  chain = run.catch(() => undefined)
  return run
}

async function sessionId($: EngineInterface): Promise<string> {
  try {
    return await $.session.id()
  } catch {
    return ''
  }
}

/** True when the session state holds no shelf loaded for this session id
 *  (a fresh start, or a /clear that emptied the state). */
async function needsLoad($: EngineInterface): Promise<boolean> {
  try {
    return (await read($, loadedFor)) !== (await sessionId($))
  } catch {
    return false
  }
}

/** Loads the saved shelf whenever the state holds none for this session id:
 *  at start, and after a /clear (new id, state emptied, no session.start).
 *  Except at start, it then looks for side-stack again (own pane or stack)
 *  and re-publishes the `stacked` flag. */
async function ensureLoaded($: EngineInterface, atStart = false): Promise<void> {
  const sid = await sessionId($)
  try {
    // Fresh: the value as it stands now, not as this dispatch began.
    if ((await update($, loadedFor, v => v)) === sid) return
  } catch {
    return
  }
  await change($, (items, n) => ({ items, nextId: n }), false).catch(() => undefined)
  await update($, loadedFor, () => sid).catch(() => undefined)
  if (!atStart) await placePane($)
}

// A render may not write state: it schedules the reload and draws what the
// store holds meanwhile. Several scheduled reloads are harmless: the first
// sets the marker and the rest return at once.
async function shelfForRender($: EngineInterface): Promise<ShelfIdea[] | undefined> {
  if (!(await needsLoad($))) return undefined
  later($, () => void ensureLoaded($).catch(() => undefined))
  try {
    return parseSaved(await $.store.get(storeKey))?.items ?? []
  } catch {
    return undefined
  }
}

const registerCommand = ($: EngineInterface) =>
  $.command.register({
    name: 'ideas',
    description: 'Open the idea shelf (or: /ideas <text> to park one, /ideas send)',
    argumentHint: '<idea>|send',
  })

// ---- Pane --------------------------------------------------------------------

const openPane = async ($: EngineInterface, focus = false): Promise<void> => {
  const count = (await update($, ideas, c => c)).length
  await $.ui.open({
    id: PANE,
    title: count > 0 ? `Ideas (${count})` : 'Ideas',
    columns: 21,
    ...(focus ? { focus: true as const } : {}),
  })
}

// Brings the own pane up to date: opened (or retitled) while side-stack is
// absent, closed while it is present. Never costs an idea.
const placePane = async ($: EngineInterface): Promise<void> => {
  try {
    if (await isStacked($)) await $.ui.close({ id: PANE })
    else await openPane($)
  } catch {
    // The engine said no (headless, narrow window): the shelf is unchanged.
  }
}

// Something the person must see: inside the stack, bring the Stack pane up
// (side-stack's /stack); if that is refused, the own pane.
// The host refuses a command run from inside a command.run hook (it would
// wait on the turn that hook holds), so the run starts from a timer, as its
// own dispatch. Not awaited: a command from a mod waits until the session is idle.
const bringForward = ($: EngineInterface): void => {
  const run = () => void $.command.run({ command: 'stack' }).catch(() => openPane($, true).catch(() => undefined))
  try {
    $.clock.after(0, run)
  } catch {
    run()
  }
}

// ---- Shelf changes -----------------------------------------------------------

const addIdea = async ($: EngineInterface, raw: string): Promise<void> => {
  const text = clean(raw)
  if (text === '') return
  // Queued at once (no await before), so ideas get ids in the order parked.
  // Every change starts from the saved shelf, so no load is needed first.
  await change($, (items, n) => ({ items: [...items, { id: n, text }], nextId: n + 1 }))
  await placePane($)
}

const editIdea = async ($: EngineInterface, id: number, raw: string): Promise<void> => {
  const text = clean(raw)
  await update($, editing, () => null)
  // A waiting idea is not changed: the message already carries it.
  if ((await read($, ideas)).some(i => i.id === id && i.sent !== undefined)) return
  await change($, (items, n) => ({
    items: text === '' ? items.filter(i => i.id !== id) : items.map(i => (i.id === id ? { ...i, text } : i)),
    nextId: n,
  }))
  await placePane($)
}

const removeIdea = async ($: EngineInterface, id: number): Promise<void> => {
  if ((await read($, ideas)).some(i => i.id === id && i.sent !== undefined)) return
  await update($, editing, v => (v === id ? null : v))
  await change($, (items, n) => ({ items: items.filter(i => i.id !== id), nextId: n }))
  await placePane($)
}

// By id AND text: an idea edited meanwhile (here or in another session), or a
// new idea under a reused id, is not the one that was sent, and stays.
const removeSent = async ($: EngineInterface, gone: Idea[]): Promise<void> => {
  const isGone = (i: Idea) => gone.some(g => g.id === i.id && g.text === i.text)
  await change($, (items, n) => ({ items: items.filter(i => !isGone(i)), nextId: n }))
  await placePane($)
}

// ---- Send --------------------------------------------------------------------
// Send does not empty the shelf first. The ideas stay, marked "sent, waiting
// for Claude", until the message enters the chat: the submit resolves (the
// engine resolves it with the prompt that entered; a mod's prompt enters once
// the session is idle), or the mod sees its own prompt pass, or the turn it
// starts. Each Send remembers its own ideas, so two Sends of the same text
// never take each other's ideas. A drop or an error only removes the marks.
// The ideas are claimed in one atomic update of the shelf, so two Sends at
// once never send the same idea twice, and an idea parked meanwhile stays.

type Sent = { ids: number[]; items: Idea[]; message: string; lines: string[] }
const sends = new Map<number, Sent>()
// Sends made before a /clear: their ideas came back as normal ideas. If the
// message enters after all, they still leave (else they would go twice).
const abandoned = new Map<number, Sent>()
let sendCount = 0

const unsentIdeas = async ($: EngineInterface): Promise<ShelfIdea[]> =>
  (await read($, ideas)).filter(i => i.sent === undefined)

const sendAll = async ($: EngineInterface): Promise<void> => {
  await ensureLoaded($)
  // The saved shelf as it stands now: ideas another session already sent (and
  // that left the store) must not go again.
  await change($, (items, n) => ({ items, nextId: n }), false).catch(() => undefined)
  const no = ++sendCount
  let list: Idea[] = []
  await update($, ideas, current => {
    list = current.filter(i => i.sent === undefined).map(plain)
    return list.length === 0 ? current : current.map(i => (i.sent === undefined ? { ...i, sent: no } : i))
  })
  if (list.length === 0) return
  const ids = list.map(i => i.id)
  const lines = list.map((i, n) => `${n + 1}. ${i.text}`)
  const message = [HEADER, ...lines].join('\n')
  sends.set(no, { ids, items: list, message, lines })
  let delivered = false
  try {
    await update($, editing, v => (v !== null && ids.includes(v) ? null : v))
    await placePane($)
    const result = await $.prompt.submit({ text: message })
    delivered = result.drop === undefined
  } catch {
    delivered = false
  }
  const mine = sends.get(no) ?? abandoned.get(no)
  const wasAbandoned = !sends.has(no)
  sends.delete(no)
  abandoned.delete(no)
  // Already gone: it entered and left through the prompt or turn hook.
  if (mine === undefined) return
  if (delivered) {
    await removeSent($, mine.items)
    return
  }
  if (wasAbandoned) return
  await update($, ideas, current => current.map(i => (i.sent === no ? plain(i) : i)))
  $.ui.toast('Ideas not delivered. They are back on the shelf.')
}

// A message entered the chat (the mod's own prompt, or a turn starting): the
// oldest Send whose message it is leaves the shelf; nothing else does.
const ideasEntered = async ($: EngineInterface, text: string): Promise<void> => {
  if (!text.includes(HEADER)) return
  const textLines = new Set(text.split('\n').map(l => l.trim()))
  const pending = [...sends, ...abandoned].sort((a, b) => a[0] - b[0])
  for (const [no, one] of pending) {
    if (!text.includes(one.message) && !one.lines.every(l => textLines.has(l))) continue
    sends.delete(no)
    abandoned.delete(no)
    await removeSent($, one.items)
    return
  }
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
  const fromStore = await shelfForRender($)
  const list = fromStore ?? (await read($, ideas))
  const editId = await read($, editing)
  const isExpanded = await read($, expanded)
  const unsent = list.filter(i => i.sent === undefined).length
  const shown = stacked && !isExpanded ? list.slice(0, STACK_SHOWN) : list

  return (
    <Box key={stacked ? SECTION_KEY : 'shelf'} flexDirection="column" gap={1}>
      {stacked && <Text bold>{list.length > 0 ? `Ideas (${list.length})` : 'Ideas'}</Text>}
      {Input !== undefined ? (
        <Input key={`${k}new`} placeholder="Park an idea" submitLabel="park" onSubmit={(value: string) => addIdea($, value)} />
      ) : (
        <Text dimColor>Type /ideas your idea to park one.</Text>
      )}
      {list.length === 0 && <Text dimColor>No ideas parked.</Text>}
      {shown.map(i => {
        const isWaiting = i.sent !== undefined
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
            {isWaiting ? (
              // Waiting: no Edit or Delete, the message already carries it.
              <Text dimColor>sent, waiting for Claude</Text>
            ) : (
              <Box flexDirection="row" gap={1}>
                {Input !== undefined && (
                  <Button key={`${k}edit-${i.id}`} plain onPress={() => update($, editing, v => (v === i.id ? null : i.id))}>
                    {editId === i.id ? 'Cancel' : 'Edit'}
                  </Button>
                )}
                <Button key={`${k}del-${i.id}`} plain onPress={() => removeIdea($, i.id)}>
                  Delete
                </Button>
              </Box>
            )}
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

// ---- Section order -------------------------------------------------------------

type El = { props?: Record<string, unknown>; children?: unknown[] }

/** A copy of `node` with the Box keyed SLOT_KEY replaced by `section`, or
 *  undefined when there is no such Box (no side-stack order beneath). */
function fillSlot(node: unknown, section: unknown): unknown {
  const el = node as El | null
  if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i] as El | null
    const isSlot = child !== null && typeof child === 'object' && child.props?.key === SLOT_KEY
    const swapped = isSlot ? section : fillSlot(child, section)
    if (swapped !== undefined) {
      const children = [...el.children]
      children[i] = swapped
      return { ...el, children }
    }
  }
  return undefined
}

// ---- Hooks -------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    storeKey = `ideas:${e.cwd}`
    await ensureLoaded($, true)
    await registerCommand($)
    // Plugin load order is unknown: the host may set its flag after this
    // start. Look a moment later, and once more about a second later.
    try {
      $.clock.after(100, () => void placePane($))
      $.clock.after(1100, () => void placePane($))
    } catch {
      // No clock: look now.
      void placePane($)
    }
    return next(e)
  })

  // A /clear ends the session; the process goes on under a new id with no
  // session.start. The waiting marks go (the ideas come back as normal ideas)
  // and the shelf is loaded again on the next look, from the store.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      for (const [no, one] of sends) abandoned.set(no, one)
      sends.clear()
      await update($, ideas, current => current.map(plain)).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'ideas' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg.toLowerCase() === 'send') {
      await ensureLoaded($)
      const count = (await unsentIdeas($)).length
      if (count === 0) return { text: 'No ideas to send.' }
      // Not awaited: a prompt from a mod waits until Claude's turn ends.
      void sendAll($).catch(() => undefined)
      return { text: `Sending ${count} idea${count === 1 ? '' : 's'} to Claude.` }
    }
    if (arg !== '') {
      await addIdea($, arg)
      if (await isStacked($)) bringForward($)
      return { text: 'Idea parked on the shelf.' }
    }
    if (await isStacked($)) {
      bringForward($)
      return { text: 'The idea shelf is in the Stack pane.' }
    }
    await openPane($, true)
    return { text: 'Idea shelf opened.' }
  })

  // The mod's own prompt entering: once the hooks beneath let it in (no drop),
  // its ideas leave.
  on('prompt.submit', async ($, e, next) => {
    await ensureLoaded($).catch(() => undefined)
    const origin = e.origin as { kind: string; name?: string } | undefined
    const isMine = origin?.kind === 'plugin' && (origin.name ?? '').split('@')[0] === $.plugin.name.split('@')[0]
    const result = await next(e)
    if (isMine && result.drop === undefined) await ideasEntered($, e.text ?? '').catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  // The sent ideas' turn starting: they entered.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await ensureLoaded($).catch(() => undefined)
      await ideasEntered($, e.text).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (await isStacked($, false)) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Shown in the Stack pane (/stack)</Text>
    }
    return drawShelf($, e, false)
  })

  // Inside the side-stack pane: this section (only while side-stack is really
  // there), then every other section below.
  on('ui.render', { component: 'Pane', requestId: STACK }, async ($, e, next) => {
    let section = null
    try {
      if (await isStacked($, false)) {
        section = await drawShelf($, e, true)
      }
    } catch {
      // A broken section never takes the others down.
    }
    const below = await next(e)
    if (section === null) return below
    // side-stack asked for this section in a set place: fill it there.
    const filled = fillSlot(below, section)
    if (filled !== undefined) return filled as typeof below
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {section}
        {below}
      </Box>
    )
  })
}

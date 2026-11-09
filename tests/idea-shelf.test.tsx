import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'idea-shelf',
  props: { title: 'Ideas', isFocused: true, bodyColumns: 21, placement: 'dock' } as never,
} as const

const ideasCommand = (args: string) => ({
  command: 'ideas',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

test('parks, edits, deletes and sends ideas; send empties the shelf', async ($, on) => {
  const sent: string[] = []
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    const before = sent.length
    await ui.input({ key: 'new', text: 'add dark mode' })
    await ui.input({ key: 'new', text: 'drop this one' })
    expect(sent.length).toBe(before)
    const ids = (await ui.find({ type: 'Text', text: /add dark mode/ })) !== undefined
    expect(ids).toBe(true)
    const first = surface === 'terminal' ? 1 : 3
    await ui.press({ key: `edit-${first}` })
    await ui.input({ key: `edit-input-${first}`, text: 'add dark mode to settings' })
    await ui.press({ key: `del-${first + 1}` })
    expect(await ui.find({ type: 'Text', text: /drop this one/ })).toBeUndefined()
    await ui.press({ key: 'send' })
    expect(sent.at(-1)).toBe('Ideas I parked on my idea shelf while we worked:\n1. add dark mode to settings')
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /No ideas parked/ })).toBeDefined()
    await ui.unmount()
  }
})

test('ideas that do not reach Claude go back on the shelf', async ($, on) => {
  const toasts: string[] = []
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('prompt.submit', async () => ({ drop: 'blocked by a settings hook' }))
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  await ui.input({ key: 'new', text: 'try a smaller font' })
  await ui.press({ key: 'send' })
  expect(await ui.find({ type: 'Text', text: /try a smaller font/ })).toBeDefined()
  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(toasts.length).toBe(1)
  await ui.unmount()
})

test('/ideas parks an idea, and /ideas send sends the list', async ($, on) => {
  let deliver: (text: string) => void = () => undefined
  const delivered = new Promise<string>(resolve => {
    deliver = resolve
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('prompt.submit', async (_$, e) => {
    deliver(e.text)
    return { text: e.text }
  })
  expect((await $.command.run(ideasCommand('send'))).text).toBe('No ideas to send.')
  expect((await $.command.run(ideasCommand('rename the config file'))).text).toBe('Idea parked on the shelf.')
  expect((await $.command.run(ideasCommand('add a --dry-run flag'))).text).toBe('Idea parked on the shelf.')
  expect((await $.command.run(ideasCommand('send'))).text).toBe('Sending 2 ideas to Claude.')
  // The command does not wait for the send to enter.
  expect(await delivered).toBe('Ideas I parked on my idea shelf while we worked:\n1. rename the config file\n2. add a --dry-run flag')
  expect((await $.command.run(ideasCommand(''))).text).toBe('Idea shelf opened.')
})

test('two sends at once submit the ideas only once', async ($, on) => {
  const sent: string[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    await gate
    return { text: e.text }
  })
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  await ui.input({ key: 'new', text: 'add dark mode' })
  const one = ui.press({ key: 'send' })
  const two = ui.press({ key: 'send' }).catch(() => undefined)
  for (let i = 0; i < 1000 && sent.length === 0; i++) await Promise.resolve()
  release()
  await Promise.all([one, two])
  expect(sent.length).toBe(1)
  await ui.unmount()
})

test('a pane that fails to open during send does not lose the ideas', async ($, on) => {
  let paneBroken = false
  const sent: string[] = []
  on('ui.open', async () => {
    if (paneBroken) throw new Error('pane failed')
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', async () => ({ value: undefined }))
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  await ui.input({ key: 'new', text: 'try a smaller font' })
  paneBroken = true
  await ui.press({ key: 'send' }).catch(() => undefined)
  paneBroken = false
  // Either the ideas reached Claude, or they are still on the shelf.
  const onShelf = (await ui.find({ type: 'Text', text: /try a smaller font/ })) !== undefined
  expect(onShelf || sent.some(t => t.includes('try a smaller font'))).toBe(true)
  await ui.unmount()
})

test('ideas parked at the same time get different ids', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  await Promise.all([
    $.command.run(ideasCommand('first')),
    $.command.run(ideasCommand('second')),
  ])
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'del-1' })).toBeDefined()
  expect(await ui.find({ key: 'del-2' })).toBeDefined()
  await ui.press({ key: 'del-1' })
  expect(await ui.find({ type: 'Text', text: /second/ })).toBeDefined()
  await ui.unmount()
})

// ---- Saved shelf, "sent, waiting", /clear, and the side-stack ----------------

const SURFACES = ['terminal', 'desktop'] as const

const STACK = {
  component: 'Pane',
  requestId: 'side-stack',
  props: { title: 'Stack', isFocused: true, bodyColumns: 46, placement: 'dock' } as never,
} as const

type World = {
  kept: Record<string, unknown>
  opened: string[]
  closed: string[]
  stackRuns: number
  logs: string[]
  stackedFlag: boolean[]
  session: { id: string }
  host: { command: boolean; foreign: boolean }
  // Stands for the host dropping this mod's session state (a /clear).
  stateReset: boolean
  storeBroken: { set: number | 'always' }
  clock: ReturnType<typeof mock.clock>
}

/** A session in /tmp with what sits beneath the plugin: a store the test can
 *  read back (shared by every session, as the real one), a clock, the
 *  side-stack host's flag and /stack command (absent unless turned on). */
async function start($: Engine, on: On, kept: Record<string, unknown> = {}, opts: { below?: boolean } = {}): Promise<World> {
  const w: World = {
    kept,
    opened: [],
    closed: [],
    stackRuns: 0,
    logs: [],
    stackedFlag: [],
    session: { id: 's1' },
    host: { command: false, foreign: false },
    stateReset: false,
    storeBroken: { set: 0 },
    clock: mock.clock(on, { now: 1_000_000 }),
  }
  on('store.get', (_$, e) => ({ value: kept[(e as unknown as { key: string }).key] }) as never)
  on('store.set', (_$, e) => {
    const one = e as unknown as { key: string; value: unknown }
    if (w.storeBroken.set === 'always') throw new Error('store over 4 MiB')
    if (w.storeBroken.set > 0) {
      w.storeBroken.set--
      throw new Error('store over 4 MiB')
    }
    kept[one.key] = JSON.parse(JSON.stringify(one.value))
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => {
    delete kept[(e as unknown as { key: string }).key]
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: Object.keys(kept) }) as never)
  on('session.id', () => ({ value: w.session.id }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({
    value: [
      ...(w.host.command ? [{ name: 'stack', description: 'Open the Stack pane', source: 'plugin', plugin: 'side-stack@side-stack' }] : []),
      ...(w.host.foreign ? [{ name: 'stack', description: 'Something else', source: 'plugin', plugin: 'other-mod@other' }] : []),
    ],
  }) as never)
  on('command.run', { command: 'stack' }, () => {
    w.stackRuns++
    return { text: 'Stack opened.' } as never
  })
  // While stateReset holds, this mod's session values read as never written,
  // as in a new session; its first write ends that.
  on('state.get', async (_$, e, next) => {
    const ref = e as unknown as { plugin: string; key: string }
    if (w.stateReset && ref.plugin === 'idea-shelf') return { value: { value: undefined, version: 0 } } as never
    return next(e)
  })
  on('state.set', async (_$, e, next) => {
    const ref = e as unknown as { plugin: string; key: string; value: unknown }
    if (ref.plugin === 'idea-shelf') w.stateReset = false
    if (ref.plugin === 'idea-shelf' && ref.key === 'stacked') w.stackedFlag.push(ref.value === true)
    return next(e)
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    w.logs.push(String((e as unknown as { text: string }).text))
    return { value: undefined } as never
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.open', async (_$, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async (_$, e) => {
    w.closed.push(e.id)
    return { value: undefined } as never
  })
  if (opts.below !== false) {
    // What side-stack (and any other section) draws beneath this mod.
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>SECTION-BELOW</Text>
    })
  }
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return w
}

// The test runtime's own timer (not in the kit's typings).
const realTimer = (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout

// Lets unawaited work (a Send whose submit never settles) run its course.
const settle = async (): Promise<void> => {
  for (let round = 0; round < 10; round++) {
    await new Promise<void>(resolve => realTimer(() => resolve(), 0))
    for (let i = 0; i < 200; i++) await Promise.resolve()
  }
}

const saved = (w: World) => w.kept['ideas:/tmp'] as { items: { id: number; text: string }[]; nextId: number } | undefined
const texts = (w: World) => saved(w)?.items.map(i => i.text) ?? []

/** Stands for the app: the prompt enters, but the submit's promise never settles. */
function neverSettles(on: On): string[] {
  const entered: string[] = []
  on('prompt.submit', async (_$, e) => {
    entered.push(e.text)
    return new Promise(() => undefined) as never
  })
  return entered
}

test('parked ideas are saved per folder, and Delete saves too (terminal and desktop)', async ($, on) => {
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  const w = await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    await ui.input({ key: 'new', text: `call the supplier ${surface}` })
    await ui.input({ key: 'new', text: `rename the file ${surface}` })
    await settle()
    expect(texts(w).slice(-2)).toEqual([`call the supplier ${surface}`, `rename the file ${surface}`])
    const firstId = saved(w)!.items.at(-2)!.id
    await ui.press({ key: `del-${firstId}` })
    await settle()
    expect(texts(w).includes(`call the supplier ${surface}`)).toBe(false)
    expect(texts(w).includes(`rename the file ${surface}`)).toBe(true)
    await ui.unmount()
  }
})

test('a new session in the same folder gets the ideas back as normal ideas; numbering goes on', async ($, on) => {
  const w = await start($, on, { 'ideas:/tmp': { items: [{ id: 3, text: 'add dark mode' }], nextId: 4 } })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /add dark mode/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeUndefined()
    expect(await ui.find({ key: 'send' })).toBeDefined()
    await ui.unmount()
  }
  await $.command.run(ideasCommand('second idea'))
  expect(saved(w)?.items.at(-1)).toEqual({ id: 4, text: 'second idea' })
})

test('/clear (session ends, new id, no session.start): the shelf stays saved and comes back, waiting marks gone', async ($, on) => {
  const entered = neverSettles(on)
  const w = await start($, on)
  await $.command.run(ideasCommand('call the supplier'))
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  void ui.press({ key: 'send' })
  await settle()
  expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeDefined()
  await ui.unmount()
  // The docs: a /clear is session.end with reason 'clear'; the process goes on
  // under a new session id and no session.start fires.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  w.session.id = 's2'
  await settle()
  expect(texts(w)).toEqual(['call the supplier'])
  for (const surface of SURFACES) {
    const after = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    expect(await after.find({ type: 'Text', text: /call the supplier/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: /waiting for Claude/ })).toBeUndefined()
    expect(await after.find({ key: 'send' })).toBeDefined()
    await after.unmount()
  }
  await $.command.run(ideasCommand('second idea'))
  await settle()
  expect(texts(w)).toEqual(['call the supplier', 'second idea'])
  // If the message from before the /clear enters after all, its idea leaves
  // (else it would reach Claude twice); the new one stays.
  await $.turn.start({ turnId: 't2', text: `The idea-shelf plugin sent a message: ${entered[0]}` })
  await settle()
  expect(texts(w)).toEqual(['second idea'])
})

test('sent ideas stay, marked waiting, until their turn starts; then they leave (terminal and desktop)', async ($, on) => {
  const entered = neverSettles(on)
  const w = await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    await ui.input({ key: 'new', text: `add dark mode ${surface}` })
    void ui.press({ key: 'send' })
    await settle()
    expect(entered.at(-1)?.startsWith('Ideas I parked on my idea shelf while we worked:\n1. ')).toBe(true)
    expect(entered.at(-1)?.endsWith(`. add dark mode ${surface}`)).toBe(true)
    expect(await ui.find({ type: 'Text', text: new RegExp(`add dark mode ${surface}`) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /sent, waiting for Claude/ })).toBeDefined()
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    expect((await $.command.run(ideasCommand('send'))).text).toBe('No ideas to send.')
    expect(texts(w)).toContain(`add dark mode ${surface}`)
    // An idea parked meanwhile is not part of the sent message.
    await ui.input({ key: 'new', text: `later ${surface}` })
    expect(await ui.find({ key: 'send' })).toBeDefined()
    await $.turn.start({ turnId: `t-${surface}`, text: `The idea-shelf plugin sent a message: ${entered.at(-1)}` })
    expect(await ui.find({ type: 'Text', text: new RegExp(`add dark mode ${surface}`) })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(`later ${surface}`) })).toBeDefined()
    await settle()
    expect(texts(w)).not.toContain(`add dark mode ${surface}`)
    expect(texts(w)).toContain(`later ${surface}`)
    await ui.unmount()
  }
})

test('a dropped prompt gives the ideas back, ready to send again, still saved (terminal and desktop)', async ($, on) => {
  on('prompt.submit', async () => ({ drop: 'busy' }) as never)
  const w = await start($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    await ui.input({ key: 'new', text: `call the supplier ${surface}` })
    await ui.press({ key: 'send' })
    expect(await ui.find({ type: 'Text', text: new RegExp(`call the supplier ${surface}`) })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeUndefined()
    expect(await ui.find({ key: 'send' })).toBeDefined()
    await settle()
    expect(texts(w)).toContain(`call the supplier ${surface}`)
    await ui.unmount()
  }
})

// XI1 (review): an idea with a line break stayed "waiting" forever.
test('an idea with line breaks is kept on one line, so it leaves when its message enters', async ($, on) => {
  const entered = neverSettles(on)
  const w = await start($, on)
  await $.command.run(ideasCommand('rename the config\nand   update the docs'))
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /rename the config and update the docs/ })).toBeDefined()
  void ui.press({ key: 'send' })
  await settle()
  expect(entered.at(-1)).toBe('Ideas I parked on my idea shelf while we worked:\n1. rename the config and update the docs')
  await $.turn.start({ turnId: 't2', text: `The idea-shelf plugin sent a message: ${entered.at(-1)}` })
  await settle()
  expect(await ui.find({ type: 'Text', text: /rename the config/ })).toBeUndefined()
  // An empty shelf leaves no key behind in the shared store.
  expect(saved(w)).toBeUndefined()
  await ui.unmount()
})

// XI2 (review): the first message entering also took a second send's idea of
// the same text, and dropping that second send then lost it.
test('two sends of the same text: each message removes only its own idea; a drop gives the other back', async ($, on) => {
  const entered: string[] = []
  let answerSecond: (v: unknown) => void = () => undefined
  on('prompt.submit', async (_$, e) => {
    entered.push(e.text)
    if (entered.length === 1) return new Promise(() => undefined) as never
    return new Promise(r => (answerSecond = r)) as never
  })
  const w = await start($, on)
  await $.command.run(ideasCommand('fix the tests'))
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  void ui.press({ key: 'send' })
  await settle()
  await ui.input({ key: 'new', text: 'fix the tests' })
  void ui.press({ key: 'send' })
  await settle()
  expect(entered.length).toBe(2)
  await $.turn.start({ turnId: 't2', text: entered[0]! })
  await settle()
  expect((await ui.findAll({ type: 'Text', text: /fix the tests/ })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeDefined()
  answerSecond({ drop: 'blocked' })
  await settle()
  expect(await ui.find({ type: 'Text', text: /fix the tests/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(texts(w)).toEqual(['fix the tests'])
  await ui.unmount()
})

// XI3 (review): another session in the same folder had its ideas overwritten.
test('another session in the same folder: its ideas stay when this one saves', async ($, on) => {
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  const w = await start($, on, { 'ideas:/tmp': { items: [{ id: 1, text: 'a' }], nextId: 2 } })
  w.kept['ideas:/tmp'] = { items: [{ id: 1, text: 'a' }, { id: 2, text: 'from other session' }], nextId: 3 }
  await $.command.run(ideasCommand('mine'))
  await settle()
  expect(saved(w)).toEqual({
    items: [
      { id: 1, text: 'a' },
      { id: 2, text: 'from other session' },
      { id: 3, text: 'mine' },
    ],
    nextId: 4,
  })
  // And this session now shows the other session's idea too.
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /from other session/ })).toBeDefined()
  await ui.unmount()
})

// XI4 (review): Delete removed a waiting idea though the message still carried it.
test('a waiting idea has no Edit or Delete (terminal and desktop)', async ($, on) => {
  neverSettles(on)
  await start($, on)
  await $.command.run(ideasCommand('secret plan'))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    if (surface === 'terminal') {
      void ui.press({ key: 'send' })
      await settle()
    }
    expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeDefined()
    expect(await ui.find({ key: 'del-1' })).toBeUndefined()
    expect(await ui.find({ key: 'edit-1' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a full store: empty shelves of other folders are dropped and the save tried again; a lasting failure is logged once', async ($, on) => {
  const w = await start($, on, { 'ideas:/old': { items: [], nextId: 1 }, 'ideas:/busy': { items: [{ id: 1, text: 'x' }], nextId: 2 } })
  w.storeBroken.set = 1
  await $.command.run(ideasCommand('first'))
  await settle()
  expect(texts(w)).toEqual(['first'])
  expect('ideas:/old' in w.kept).toBe(false)
  expect('ideas:/busy' in w.kept).toBe(true)
  w.storeBroken.set = 'always'
  await $.command.run(ideasCommand('second'))
  await $.command.run(ideasCommand('third'))
  await settle()
  expect(w.logs.length).toBe(1)
  // The shelf still holds them for this session.
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /third/ })).toBeDefined()
  await ui.unmount()
})

test('alone: own pane opens after start; nothing drawn in a stack (terminal and desktop)', async ($, on) => {
  const w = await start($, on)
  await w.clock.advance(150)
  await settle()
  expect(w.opened).toContain('idea-shelf')
  await w.clock.advance(1500)
  await settle()
  expect(w.closed).toEqual([])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    expect(await ui.find({ key: 'new' })).toBeDefined()
    await ui.unmount()
    const stack = await $.ui.mount({ plugin: 'idea-shelf', surface, ...STACK })
    expect(await stack.find({ key: 'idea-new' })).toBeUndefined()
    expect(await stack.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await stack.unmount()
  }
  expect(w.stackedFlag.includes(true)).toBe(false)
})

test('a /stack command from another plugin does not count as side-stack', async ($, on) => {
  const w = await start($, on)
  w.host.foreign = true
  await w.clock.advance(1500)
  await settle()
  expect(w.opened).toContain('idea-shelf')
  expect(w.closed).toEqual([])
  const stack = await $.ui.mount({ plugin: 'idea-shelf', surface: 'desktop', ...STACK })
  expect(await stack.find({ key: 'idea-new' })).toBeUndefined()
  await stack.unmount()
})

test('stacked: own pane closed, section headed Ideas with the full send flow, sections below kept (terminal and desktop)', async ($, on) => {
  const entered: string[] = []
  on('prompt.submit', async (_$, e) => {
    entered.push(e.text)
    return { text: e.text }
  })
  // The host loads after this mod: it shows up only after the first look.
  const w = await start($, on)
  await w.clock.advance(150)
  await settle()
  expect(w.opened).toContain('idea-shelf')
  w.host.command = true
  await w.clock.advance(1500)
  await settle()
  expect(w.closed).toContain('idea-shelf')
  expect(w.stackedFlag.at(-1)).toEqual(true)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...STACK })
    expect(await ui.find({ type: 'Text', text: /^Ideas( \(\d+\))?$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await ui.input({ key: 'idea-new', text: `idea on ${surface}` })
    expect(await ui.find({ type: 'Text', text: new RegExp(`idea on ${surface}`) })).toBeDefined()
    const id = saved(w)!.items.at(-1)!.id
    await ui.press({ key: `idea-edit-${id}` })
    await ui.input({ key: `idea-edit-input-${id}`, text: `edited on ${surface}` })
    expect(await ui.find({ type: 'Text', text: new RegExp(`edited on ${surface}`) })).toBeDefined()
    await ui.press({ key: 'idea-send' })
    expect(entered.at(-1)).toBe(`Ideas I parked on my idea shelf while we worked:\n1. edited on ${surface}`)
    expect(await ui.find({ type: 'Text', text: new RegExp(`edited on ${surface}`) })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await ui.unmount()
    // The own pane, if it is still drawn somewhere, shows one line only.
    const own = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    expect(await own.find({ type: 'Text', text: /Shown in the Stack pane \(\/stack\)/ })).toBeDefined()
    expect(await own.find({ key: 'new' })).toBeUndefined()
    await own.unmount()
  }
  // Parking never reopens the own pane while stacked; /ideas brings the Stack pane up.
  const before = w.opened.filter(id => id === 'idea-shelf').length
  await $.command.run(ideasCommand('one more'))
  expect(w.opened.filter(id => id === 'idea-shelf').length).toBe(before)
  expect((await $.command.run(ideasCommand(''))).text).toBe('The idea shelf is in the Stack pane.')
  await w.clock.advance(10)
  await settle()
  expect(w.stackRuns).toBeGreaterThan(0)
  // /stack ran, so the own pane was not opened as a fallback.
  expect(w.opened.filter(id => id === 'idea-shelf').length).toBe(before)
  // The host goes away: the own pane comes back on the next change.
  w.host.command = false
  await $.command.run(ideasCommand('host gone'))
  expect(w.opened.filter(id => id === 'idea-shelf').length).toBe(before + 1)
  expect(w.stackedFlag.at(-1)).toBe(false)
})

test('stacked: the section keeps a row budget, with Show all for the rest (terminal and desktop)', async ($, on) => {
  const w = await start($, on)
  w.host.command = true
  await w.clock.advance(1500)
  await settle()
  // Host there from the first look: the own pane never opens.
  expect(w.opened).not.toContain('idea-shelf')
  for (let n = 1; n <= 9; n++) await $.command.run(ideasCommand(`idea ${n}`))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...STACK })
    expect(await ui.find({ type: 'Text', text: /idea 6/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /idea 7/ })).toBeUndefined()
    await ui.press({ key: 'idea-more' })
    expect(await ui.find({ type: 'Text', text: /idea 9/ })).toBeDefined()
    expect(await ui.find({ key: 'idea-send' })).toBeDefined()
    await ui.press({ key: 'idea-more' })
    await ui.unmount()
  }
})

// v3 (real terminal test): after a real /clear the session state is gone and
// no session.start fires. The list must come back from the store and the
// section must stay in the stack, found by side-stack's /stack command alone.
test('real /clear: session.end, new id, no session.start, then a turn: list back, section in the stack (terminal and desktop)', async ($, on) => {
  const w = await start($, on)
  w.host.command = true
  await w.clock.advance(1500)
  await settle()
  await $.command.run(ideasCommand('call the supplier'))
  await settle()
  let n = 1
  for (const surface of SURFACES) {
    await $.session.end({ reason: 'clear', sessionId: `s${n}`, resume: { id: `s${n}` } } as never)
    n++
    w.session.id = `s${n}`
    w.stateReset = true
    // Drawn before any other event: the render does not write state, so it
    // draws what the store holds and leaves the reload to a timer.
    const first = await $.ui.mount({ plugin: 'idea-shelf', surface, ...STACK })
    expect(await first.find({ type: 'Text', text: /call the supplier/ })).toBeDefined()
    expect(await first.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await first.unmount()
    // Then a turn, as after the person types a prompt.
    await $.turn.start({ turnId: `t${n}`, text: 'carry on' })
    await w.clock.advance(10)
    await settle()
    expect(w.stateReset).toBe(false)
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...STACK })
    expect(await ui.find({ type: 'Text', text: /^Ideas \(1\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /call the supplier/ })).toBeDefined()
    expect(await ui.find({ key: 'idea-send' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await ui.unmount()
    const own = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    expect(await own.find({ type: 'Text', text: /Shown in the Stack pane/ })).toBeDefined()
    await own.unmount()
    expect(w.stackedFlag.at(-1)).toEqual(true)
    expect(texts(w)).toEqual(['call the supplier'])
  }
})

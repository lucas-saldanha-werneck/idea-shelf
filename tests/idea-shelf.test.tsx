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

// ---- Saved shelf, "sent, waiting", and the side-stack -----------------------

const STACK = {
  component: 'Pane',
  requestId: 'side-stack',
  props: { title: 'Stack', isFocused: true, bodyColumns: 46, placement: 'dock' } as never,
} as const

/** A store the test can read back: what a /clear or a reload would load. */
function memoryStore(on: On, kept: Record<string, unknown>): void {
  on('store.get', (_$, e) => ({ value: kept[(e as unknown as { key: string }).key] }) as never)
  on('store.set', (_$, e) => {
    const one = e as unknown as { key: string; value: unknown }
    kept[one.key] = JSON.parse(JSON.stringify(one.value))
    return { value: undefined } as never
  })
}

/** A session starting in /tmp, with what sits beneath the plugin. */
async function start($: Engine, on: On, kept: Record<string, unknown>, opened: string[] = [], closed: string[] = []) {
  const clock = mock.clock(on, { now: 1_000_000 })
  memoryStore(on, kept)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('ui.open', async (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', async (_$, e) => {
    closed.push(e.id)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return clock
}

/** Stands for the side-stack host's flag, which only the host writes. */
function hostFlag(on: On): { present: boolean } {
  const flag = { present: false }
  on('state.get', async (_$, e, next) => {
    const ref = e as unknown as { plugin: string; key: string }
    if (ref.plugin === 'side-stack' && ref.key === 'present') return { value: { value: flag.present, version: 1 } } as never
    return next(e)
  })
  return flag
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 400; i++) await Promise.resolve()
}

test('parked ideas are saved per folder; a new session (/clear, reload) gets them back', async ($, on) => {
  const kept: Record<string, unknown> = {}
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await start($, on, kept)
  await $.command.run(ideasCommand('call the supplier'))
  await $.command.run(ideasCommand('rename the config file'))
  await settle()
  expect(kept['ideas:/tmp']).toEqual({
    items: [
      { id: 1, text: 'call the supplier' },
      { id: 2, text: 'rename the config file' },
    ],
    nextId: 3,
  })
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  await ui.press({ key: 'del-1' })
  await ui.unmount()
  await settle()
  expect(kept['ideas:/tmp']).toEqual({ items: [{ id: 2, text: 'rename the config file' }], nextId: 3 })
})

test('after a /clear the saved ideas come back as normal ideas, and numbering goes on', async ($, on) => {
  // What the store holds after an idea was sent but had not entered yet: the
  // "waiting" mark is never saved, so it comes back ready to send.
  const kept: Record<string, unknown> = { 'ideas:/tmp': { items: [{ id: 3, text: 'add dark mode' }], nextId: 4 } }
  await start($, on, kept)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /add dark mode/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeUndefined()
    expect(await ui.find({ key: 'send' })).toBeDefined()
    await ui.unmount()
  }
  await $.command.run(ideasCommand('second idea'))
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'del-4' })).toBeDefined()
  await ui.unmount()
})

test('sent ideas stay, marked waiting, until their turn starts; then they leave (also the store)', async ($, on) => {
  const kept: Record<string, unknown> = {}
  const entered: string[] = []
  // Stands for the app: the prompt enters, but the submit's promise never settles.
  on('prompt.submit', async (_$, e) => {
    entered.push(e.text)
    return new Promise(() => undefined) as never
  })
  await start($, on, kept)
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'desktop', ...PANE })
  await ui.input({ key: 'new', text: 'add dark mode' })
  void ui.press({ key: 'send' })
  await settle()
  expect(entered.at(-1)).toBe('Ideas I parked on my idea shelf while we worked:\n1. add dark mode')
  expect(await ui.find({ type: 'Text', text: /add dark mode/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sent, waiting for Claude/ })).toBeDefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(await ui.find({ key: 'edit-1' })).toBeUndefined()
  expect((await $.command.run(ideasCommand('send'))).text).toBe('No ideas to send.')
  expect(kept['ideas:/tmp']).toEqual({ items: [{ id: 1, text: 'add dark mode' }], nextId: 2 })
  // An idea parked meanwhile is not part of the sent message.
  await ui.input({ key: 'new', text: 'later idea' })
  expect(await ui.find({ key: 'send' })).toBeDefined()
  await $.turn.start({ turnId: 't2', text: `The idea-shelf plugin sent a message: ${entered.at(-1)}` })
  expect(await ui.find({ type: 'Text', text: /add dark mode/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /later idea/ })).toBeDefined()
  await settle()
  expect(kept['ideas:/tmp']).toEqual({ items: [{ id: 2, text: 'later idea' }], nextId: 3 })
  await ui.unmount()
})

test('a dropped prompt gives the ideas back, ready to send again, and they stay saved', async ($, on) => {
  const kept: Record<string, unknown> = {}
  on('prompt.submit', async () => ({ drop: 'busy' }) as never)
  await start($, on, kept)
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  await ui.input({ key: 'new', text: 'call the supplier' })
  await ui.press({ key: 'send' })
  expect(await ui.find({ type: 'Text', text: /call the supplier/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /waiting for Claude/ })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeDefined()
  await settle()
  expect(kept['ideas:/tmp']).toEqual({ items: [{ id: 1, text: 'call the supplier' }], nextId: 2 })
  await ui.unmount()
})

test('alone: its own pane opens at start and nothing is drawn in a stack', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  // What the host would draw beneath: nothing here, as no host is installed.
  const clock = await start($, on, {}, opened, closed)
  await settle()
  expect(opened).toContain('idea-shelf')
  await clock.advance(1500)
  await settle()
  expect(closed).toEqual([])
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'new' })).toBeDefined()
  await ui.unmount()
})

test('stacked: no own pane, a section headed Ideas in side-stack, sections below kept', async ($, on) => {
  const opened: string[] = []
  const closed: string[] = []
  on('ui.render', { component: 'Pane', requestId: 'side-stack' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>SECTION-BELOW</Text>
  })
  const host = hostFlag(on)
  // The host loads after this mod: its flag shows up only later.
  const clock = await start($, on, {}, opened, closed)
  await settle()
  expect(opened).toContain('idea-shelf')
  host.present = true
  await clock.advance(1500)
  await settle()
  // The one-second second look closed the own pane.
  expect(closed).toContain('idea-shelf')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'idea-shelf', surface, ...STACK })
    expect(await ui.find({ type: 'Text', text: /^Ideas( \(\d+\))?$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await ui.input({ key: 'idea-new', text: `idea on ${surface}` })
    expect(await ui.find({ type: 'Text', text: new RegExp(`idea on ${surface}`) })).toBeDefined()
    expect(await ui.find({ key: 'idea-send' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SECTION-BELOW/ })).toBeDefined()
    await ui.unmount()
  }
  // Parking or deleting never reopens the own pane while stacked.
  const before = opened.filter(id => id === 'idea-shelf').length
  await $.command.run(ideasCommand('one more'))
  expect(opened.filter(id => id === 'idea-shelf').length).toBe(before)
  expect((await $.command.run(ideasCommand(''))).text).toBe('The idea shelf is in the Stack pane.')
})

test('stacked: the section keeps a row budget, with Show all for the rest', async ($, on) => {
  const host = hostFlag(on)
  host.present = true
  on('ui.render', { component: 'Pane', requestId: 'side-stack' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const opened: string[] = []
  await start($, on, {}, opened)
  await settle()
  // Host there from the start: the own pane never opens.
  expect(opened).not.toContain('idea-shelf')
  for (let n = 1; n <= 9; n++) await $.command.run(ideasCommand(`idea ${n}`))
  const ui = await $.ui.mount({ plugin: 'idea-shelf', surface: 'terminal', ...STACK })
  expect(await ui.find({ type: 'Text', text: /idea 6/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /idea 7/ })).toBeUndefined()
  await ui.press({ key: 'idea-more' })
  expect(await ui.find({ type: 'Text', text: /idea 9/ })).toBeDefined()
  expect(await ui.find({ key: 'idea-send' })).toBeDefined()
  await ui.unmount()
})

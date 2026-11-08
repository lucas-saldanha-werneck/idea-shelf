import { expect, test } from 'claude-code/testing'

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

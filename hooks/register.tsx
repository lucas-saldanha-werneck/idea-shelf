import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Idea } from '../types'

// A side shelf: the person parks ideas while Claude works (no model turn),
// edits or deletes them, then sends the whole list to Claude with one press.

const PANE = 'idea-shelf'
const ideas = atom({ plugin: 'idea-shelf', key: 'ideas' } as const, [])
const nextId = atom({ plugin: 'idea-shelf', key: 'nextId' } as const, 1)
const editing = atom({ plugin: 'idea-shelf', key: 'editing' } as const, null)

const openPane = async ($: EngineInterface, focus = false): Promise<void> => {
  const count = (await read($, ideas)).length
  await $.ui.open({
    id: PANE,
    title: count > 0 ? `Ideas (${count})` : 'Ideas',
    columns: 21,
    ...(focus ? { focus: true as const } : {}),
  })
}

// Redraws the pane; a pane that fails to open never costs an idea.
const redraw = async ($: EngineInterface): Promise<void> => {
  try {
    await openPane($)
  } catch {
    // Nothing to do: the shelf itself is unchanged.
  }
}

const clean = (raw: string): string => raw.trim().slice(0, 1000)

const addIdea = async ($: EngineInterface, raw: string): Promise<void> => {
  const text = clean(raw)
  if (text === '') return
  // update() writes atomically and resolves what it wrote, so two ideas at once get two ids.
  const id = (await update($, nextId, n => n + 1)) - 1
  await update($, ideas, list => [...list, { id, text }].slice(-200))
  await openPane($)
}

const editIdea = async ($: EngineInterface, id: number, raw: string): Promise<void> => {
  const text = clean(raw)
  await update($, ideas, list => (text === '' ? list.filter(i => i.id !== id) : list.map(i => (i.id === id ? { ...i, text } : i))))
  await update($, editing, () => null)
  await openPane($)
}

const removeIdea = async ($: EngineInterface, id: number): Promise<void> => {
  await update($, ideas, list => list.filter(i => i.id !== id))
  await update($, editing, v => (v === id ? null : v))
  await openPane($)
}

// Send empties the shelf: the list now lives in the chat. If the prompt does
// not enter (a hook dropped it, or it failed), the ideas go back on the shelf.
// The list is taken off the shelf in one atomic update, so two sends at once
// never send the same idea twice, and an idea parked meanwhile stays.
const sendAll = async ($: EngineInterface): Promise<void> => {
  let list: Idea[] = []
  await update($, ideas, current => {
    list = current
    return []
  })
  if (list.length === 0) return
  let delivered = false
  try {
    await update($, editing, () => null)
    await redraw($)
    const lines = list.map((i, n) => `${n + 1}. ${i.text}`)
    let result: Awaited<ReturnType<typeof $.prompt.submit>> | undefined
    try {
      result = await $.prompt.submit({ text: ['Ideas I parked on my idea shelf while we worked:', ...lines].join('\n') })
    } catch {
      result = undefined
    }
    delivered = result !== undefined && result.drop === undefined
  } finally {
    if (!delivered) await update($, ideas, rest => [...list, ...rest].slice(-200))
    await redraw($)
  }
  if (!delivered) $.ui.toast('Ideas not delivered. They are back on the shelf.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ideas',
      description: 'Open the idea shelf (or: /ideas <text> to park one, /ideas send)',
      argumentHint: '<idea>|send',
    })
    void openPane($)
    return next(e)
  })

  on('command.run', { command: 'ideas' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg.toLowerCase() === 'send') {
      const count = (await read($, ideas)).length
      if (count === 0) return { text: 'No ideas to send.' }
      // Not awaited: a prompt from a mod waits until Claude's turn ends.
      void sendAll($).catch(() => undefined)
      return { text: `Sending ${count} idea${count === 1 ? '' : 's'} to Claude.` }
    }
    if (arg !== '') {
      await addIdea($, arg)
      return { text: 'Idea parked on the shelf.' }
    }
    await openPane($, true)
    return { text: 'Idea shelf opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The mobile app draws no text field yet: /ideas <text> parks one there.
    const Input = 'Input' in table ? table.Input : undefined
    const list = await read($, ideas)
    const editId = await read($, editing)

    return (
      <Box flexDirection="column" gap={1}>
        {Input !== undefined ? (
          <Input key="new" placeholder="Park an idea" submitLabel="park" onSubmit={(value: string) => addIdea($, value)} />
        ) : (
          <Text dimColor>Type /ideas your idea to park one.</Text>
        )}
        {list.length === 0 && <Text dimColor>No ideas parked.</Text>}
        {list.map(i => (
          <Box key={`idea-${i.id}`} flexDirection="column">
            {editId === i.id && Input !== undefined ? (
              <Input
                key={`edit-input-${i.id}`}
                value={i.text}
                submitLabel="save"
                autoFocus
                onSubmit={(value: string) => editIdea($, i.id, value)}
              />
            ) : (
              <Text wrap="wrap">• {i.text}</Text>
            )}
            <Box flexDirection="row" gap={1}>
              {Input !== undefined && (
                <Button key={`edit-${i.id}`} plain onPress={() => update($, editing, v => (v === i.id ? null : i.id))}>
                  {editId === i.id ? 'Cancel' : 'Edit'}
                </Button>
              )}
              <Button key={`del-${i.id}`} plain onPress={() => removeIdea($, i.id)}>
                Delete
              </Button>
            </Box>
          </Box>
        ))}
        {list.length > 0 && (
          <Button key="send" variant="primary" onPress={() => sendAll($)}>
            {`Send ${list.length}`}
          </Button>
        )}
      </Box>
    )
  })
}

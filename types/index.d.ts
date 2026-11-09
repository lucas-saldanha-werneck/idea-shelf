export type Idea = { id: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    'idea-shelf': {
      ideas: Idea[]
      nextId: number
      editing: number | null
      // Ids sent with Send that have not entered the chat yet. Session only:
      // after a /clear they come back as normal ideas.
      queued: number[]
      // Stacked section: show every idea instead of the first few.
      expanded: boolean
    }
    // Read only: the side-stack host sets it at session start.
    'side-stack': { present: boolean }
  }
}

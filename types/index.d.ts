export type Idea = { id: number; text: string }

/** An idea as this session holds it: `sent` is the number of the Send that
 *  carries it while that message has not entered the chat. Never saved. */
export type ShelfIdea = Idea & { sent?: number }

declare module 'claude-code' {
  interface PluginState {
    'idea-shelf': {
      ideas: ShelfIdea[]
      nextId: number
      editing: number | null
      // Stacked section: show every idea instead of the first few.
      expanded: boolean
      // True while the shelf draws inside the side-stack pane (read by side-stack).
      stacked: boolean
      // The session id the shelf was loaded for; gone with the state on /clear.
      loadedFor: string | null
    }
  }
}

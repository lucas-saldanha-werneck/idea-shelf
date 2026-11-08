export type Idea = { id: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    'idea-shelf': { ideas: Idea[]; nextId: number; editing: number | null }
  }
}

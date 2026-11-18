# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-11-18
- Each idea has one row of actions: Send (that idea), Edit, Delete (red). Send all N with two or more ideas.
- In the Stack pane: an `Ideas · N` heading; an empty shelf folds to one line with + Park.
- `/ideas` and parking ask side-stack for its pane silently (the `showStack` counter, side-stack 0.5.1+), not when the pane is open or the person reads from Remote Control; `/stack` stays the fallback for an older side-stack.
- "waiting" in place of "sent, waiting for Claude"; no blank rows inside the section; `/ideas` answers "Stack pane opened."
- The side-stack guest protocol now comes from `hooks/stack-guest.tsx`, a byte-identical copy of side-stack's (CI checks it).
- Rendering split by surface: one look for the terminal, one for the apps (desktop, mobile, VS Code). Both draw the same tree for now.

## [0.3.9] - 2026-11-18
- Draw in the side-stack pane again on Claude Code 2.1.327 and later, which hears only a plugin's own drawings unless the hook names `plugin: '*'`. Older builds keep working (the hook is registered both ways and the section is drawn once).

## [0.3.8] - 2026-11-13
- README Examples section.

## [0.3.7] - 2026-11-12
- One store key per idea, so two sessions never lose a change.

## [0.3.6] - 2026-11-12
- A failed write keeps the changes and replays them; Send re-reads the saved shelf before building the list.
- A sent idea leaves only when its id and text match, so an edited one stays.

## [0.3.5] - 2026-11-11
- Never writes over the saved shelf after a failed read.

## [0.3.4] - 2026-11-11
- Points to the catalog repo's new name, `lucas-tools`.

## [0.3.3] - 2026-11-11
- Catalog renamed to `lucas-tools`.

## [0.3.2] - 2026-11-09
- Docs: one-line description, catalog install, README headings.

## [0.3.1] - 2026-11-09
- A real `/clear` keeps the loaded-for marker in session state.

## [0.3.0] - 2026-11-09
- Each Send remembers its own ideas; a multi-line idea no longer gets stuck waiting.
- The store re-reads the saved shelf on every change, so another session's ideas stay; a real `/clear` reloads the shelf.
- side-stack: presence by its `/stack` command alone; section order (protocol v4).

## [0.2.0] - 2026-11-09
- Saved shelf, sent-and-waiting ideas, side-stack section.
- CI runs the tests on Linux, macOS and Windows.

## [0.1.1] - 2026-11-08
- Send claims the shelf atomically; ids never collide.

## [0.1.0] - 2026-11-08
- First release: a side shelf for ideas, sent to Claude in one press.

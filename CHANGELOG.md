# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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

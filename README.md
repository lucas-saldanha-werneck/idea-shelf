# idea-shelf

A Claude Code mod that gives you a side pane for ideas that come up while Claude works. You park an
idea there without starting a new turn, so Claude keeps going on the current task. When you are
ready, one press sends the whole list.

This sketch shows roughly how the pane looks in a terminal with two ideas parked. It is not a
screenshot:

```
Ideas (2)
[ Park an idea          ] park
• add dark mode to settings
  Edit  Delete
• rename the config file
  Edit  Delete
[ Send 2 ]
```

## What Claude sees

Nothing, until you press Send. Parking, editing and deleting ideas never reach the model. Send
submits one message, which Claude Code marks as sent by the idea-shelf plugin:

```
Ideas I parked on my idea shelf while we worked:
1. add dark mode to settings
2. rename the config file
```

If Claude is in the middle of a turn, the message waits until the turn ends.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin marketplace add lucas-saldanha-werneck/idea-shelf
/plugin install idea-shelf@idea-shelf
```

Or from a shell, in one step:

```
claude plugin install idea-shelf --marketplace lucas-saldanha-werneck/idea-shelf
```

`/plugin` does not run in the desktop app. Install from a terminal with the user scope, and the mod
also loads in the desktop app's local Code sessions.

## Use

- The pane opens when a session starts. In a terminal, Claude Code only places a pane you did not
  ask for when the window is at least 144 columns wide (110 if you have opened it before). Below
  that it waits. `/ideas` opens it at any width.
- Type an idea in the field and press Enter (or the park button). Claude is not interrupted.
- Edit opens the idea in a text field. Save it empty to delete it. Delete removes it.
- Send N hands the list to Claude. The ideas do not leave the shelf right away: each one shows
  "sent, waiting for Claude" until the message actually enters the chat (Claude's current turn has
  to end first). Then they leave. If the message does not get through (for example, a hook blocks
  it), the waiting mark goes away, the ideas are ready to send again, and a toast says so.
- While an idea is waiting it cannot be edited (so the message and the shelf stay the same), but
  it can be deleted. Ideas you park meanwhile are not part of that message; Send sends them next.

### Saved per folder

The shelf is saved per working folder in the mod's store (`$.store`, key `ideas:<folder>`). It
comes back after `/clear`, after reloading the app, and in a new session in the same folder. Only
Delete, or a sent message entering the chat, takes an idea off. If you `/clear` while sent ideas
are still waiting, they come back as normal ideas, ready to send again.

Commands:

| Command | What it does |
| --- | --- |
| `/ideas` | Opens the pane and focuses it. Inside side-stack it runs `/stack` instead. |
| `/ideas <text>` | Parks one idea. |
| `/ideas send` | Sends the ideas that are not already waiting and says how many ("Sending 2 ideas to Claude."), or says "No ideas to send." It does not wait for the message to enter. |

There are no settings and nothing else to install.

## Works alone or inside side-stack

The desktop app and the terminal show each mod's pane as a separate tab, one at a time. If you also
use [side-stack](https://github.com/lucas-saldanha-werneck/side-stack), several mods share one pane
called "Stack" and are drawn one under the other.

- **Alone** (side-stack not installed): idea-shelf opens its own "Ideas" pane, as before.
- **With side-stack**: idea-shelf does not open its own pane (it closes it if it had already
  opened before side-stack loaded). It draws a section headed "Ideas" inside the Stack pane, and
  always draws the other mods' sections below it. To leave room for them, the section shows the
  first 6 ideas and a "Show all" button for the rest.

idea-shelf finds side-stack by reading side-stack's `present` flag (read only) at session start, and
once more about a second later, because the order in which mods load is not fixed. The order of the
sections inside the Stack pane follows that load order too, and idea-shelf does not try to change
it.

## How it works

The mod is one hooks module (`hooks/register.tsx`). At session start it loads the saved shelf for
the folder, registers the `/ideas` command and opens its pane (or not, inside side-stack). Ideas are
kept in the mod's session state and saved to `$.store` after every change. Send claims the ideas
that are not already waiting in one atomic update (so two presses never send an idea twice), marks
them waiting, builds the numbered list and submits it with `$.prompt.submit`. They leave the shelf
when the submit resolves, or when the mod sees its own prompt or the turn that prompt starts (matched
by the numbered lines under the header, because in the app the submit's promise may not settle). A
dropped or failed prompt removes only the waiting mark.

## Uninstall

```
/plugin uninstall idea-shelf@idea-shelf
/plugin marketplace remove idea-shelf
```

From a shell, the same commands work with `claude plugin` in place of `/plugin`.

## Limits and what was not tested

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- Ideas are saved in Claude Code's per-plugin store, not in a file you can edit.
- The waiting mark is not saved: an app reload while ideas are waiting brings them back as normal
  ideas, so if the message had already entered, you may see them again and delete them by hand.
- The side-stack mode is covered by the tests, with a stand-in for side-stack's flag and pane. The
  way mods share the pane was tried by hand with two throwaway mods in Claude Code 2.1.319;
  idea-shelf itself has not been tried by hand inside side-stack yet.
- The shelf keeps the last 200 ideas. An idea is cut at 1000 characters.
- The tests draw the pane on the `terminal` and `desktop` surfaces. Nobody has tried it by hand in
  the desktop app.
- Not tested on the mobile app. Where the app draws no text fields, the pane shows
  "Type /ideas your idea to park one." and only the Delete and Send buttons.
- Tests: `claude plugin test .` and `claude plugin validate .`.

## Credits

The idea comes from the "Idea Shelf" mod in the AI LABS video [Claude Mods Are Insane... You Need To Try These Right Now](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=532) (08:52, 9 Oct 2026). This code was written separately with Claude Code.

## License

MIT. See `LICENSE`.

Built with Claude Code

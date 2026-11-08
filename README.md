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
- Send N hands the list to Claude and empties the shelf. If the message does not get through (for
  example, a hook blocks it), the ideas go back on the shelf and a toast says so.

Commands:

| Command | What it does |
| --- | --- |
| `/ideas` | Opens the pane and focuses it. |
| `/ideas <text>` | Parks one idea. |
| `/ideas send` | Sends the list to Claude, or says "No ideas to send." |

There are no settings and nothing else to install.

## How it works

The mod is one hooks module (`hooks/register.tsx`). At session start it registers the `/ideas`
command and opens the pane. Ideas are kept in the mod's session state. Send builds the numbered list
and submits it with `$.prompt.submit`. If that prompt is dropped or fails, the ideas are put back.

## Uninstall

```
/plugin uninstall idea-shelf@idea-shelf
/plugin marketplace remove idea-shelf
```

From a shell, the same commands work with `claude plugin` in place of `/plugin`.

## Limits and what was not tested

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- Ideas last for the current session only. They are not saved to disk.
- The shelf keeps the last 200 ideas. An idea is cut at 1000 characters.
- The tests draw the pane on the `terminal` and `desktop` surfaces. Nobody has tried it by hand in
  the desktop app.
- Not tested on the mobile app. Where the app draws no text fields, the pane shows
  "Type /ideas your idea to park one." and only the Delete and Send buttons.
- Tests: `claude plugin test .` and `claude plugin validate .`.

## License

MIT. See `LICENSE`.

Built with Claude Code

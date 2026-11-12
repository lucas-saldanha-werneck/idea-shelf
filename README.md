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
/plugin marketplace add lucas-saldanha-werneck/lucas-tools
/plugin install idea-shelf@lucas-tools
```

From a shell, the same commands work with `claude plugin` in place of `/plugin`.

`/plugin` does not run in the desktop app. Install from a terminal with the user scope, and the mod
also loads in the desktop app's local Code sessions.

## Use

- The pane opens when a session starts. In a terminal, Claude Code only places a pane you did not
  ask for when the window is at least 144 columns wide (110 if you have opened it before). Below
  that it waits. `/ideas` opens it at any width.
- Type an idea in the field and press Enter (or the park button). Claude is not interrupted. Line
  breaks and runs of spaces in an idea become one space, so each idea is one line of the message.
- Edit opens the idea in a text field. Save it empty to delete it. Delete removes it.
- Send N hands the list to Claude. The ideas do not leave the shelf right away: each one shows
  "sent, waiting for Claude" until the message actually enters the chat. A message from a mod enters
  only once Claude's current turn has ended, so this can take a while. Then they leave. If the
  message does not get through (for example, a hook blocks it), the waiting mark goes away, the
  ideas are ready to send again, and a toast says so.
- A waiting idea has no Edit or Delete button, because the message already carries it. Ideas you
  park meanwhile are not part of that message; Send sends them next.
- Each Send remembers its own ideas. If two Sends carry the same text, the first message entering
  removes only the first Send's idea. An idea leaves only if it still has the number and the text
  it was sent with: an idea edited meanwhile (here or in another session) stays.
- Send reads the saved shelf first, so ideas another session in the same folder already sent (and
  that left the shelf) are not sent again. Ideas the other session sent that are still waiting are
  still on the saved shelf (waiting marks are not saved), so pressing Send in both sessions before
  the first message enters can still send them twice.

### Saved per folder

The shelf is saved per working folder in the mod's store (`$.store`), one key per idea
(`shelf:<id>:<folder>`; a folder path too long for a store key is replaced by a short hash). It comes
back in a new session in the same folder and after reloading the app. Only Delete, or a sent message
entering the chat, takes an idea off.

- **`/clear`.** The Claude Code docs say a `/clear` ends the session and the process goes on under a
  new session id, with no new session start, and session state does not carry over. idea-shelf
  notices the new id on the next prompt, turn, `/ideas` or redraw and loads the shelf from the store
  again. A redraw may not write state, so it draws what the store holds and leaves the reload to a
  timer. It never writes an empty shelf over the saved one. If you `/clear` while sent
  ideas are still waiting, they come back as normal ideas, ready to send again. If that earlier
  message does enter after all, its ideas still leave, so they never reach Claude twice. This was
  tested the way the docs describe a `/clear`, not by hand.
- **Two sessions in the same folder** share one saved shelf. Every change re-reads the saved shelf,
  applies itself to that, and then writes only the ideas it added or edited and deletes only the
  ones it removed. Claude Code writes each store key under a lock on the store file, re-reading the
  file first, and ids are unique across sessions, so two sessions saving at the same moment keep both
  changes: one session never erases the other's ideas. The other session's ideas show up the next
  time this one changes something. Two sessions editing the same idea at once keep the last edit.
- Up to 0.3.6 the whole shelf was one key, `ideas:<folder>`. The first look at that folder moves it to
  a key per idea, then removes the old key.
- An empty shelf removes its key, so folders you no longer use leave nothing behind. If the store is
  full (Claude Code allows 4 MiB per plugin), empty shelves of other folders are dropped and the save
  is tried again. If it still fails, one line in the transcript says so and the changes stay in this
  session; the next change that can save applies them (adds, edits and deletes) to the saved shelf,
  the same way as for a shelf that could not be read (below).
- If the saved shelf cannot be read, nothing is written (that would go over ideas this session never
  saw). The changes stay in this session, and the next change that can read the store applies them to
  the saved shelf: new ideas get new numbers, and edits and deletes apply to ideas still as this
  session last saw them.

Commands:

| Command | What it does |
| --- | --- |
| `/ideas` | Opens the pane and focuses it. Inside side-stack it runs side-stack's `/stack` instead. |
| `/ideas <text>` | Parks one idea (inside side-stack it also runs `/stack`, so you see it). |
| `/ideas send` | Sends the ideas that are not already waiting and says how many ("Sending 2 ideas to Claude."), or says "No ideas to send." It does not wait for the message to enter. |

There are no settings and nothing else to install.

## Works alone or inside side-stack

The desktop app and the terminal show each mod's pane as a separate tab, one at a time. If you also
use [side-stack](https://github.com/lucas-saldanha-werneck/side-stack), several mods share one pane
called "Stack" and are drawn one under the other. The mods that can share it are assumptions-pane,
idea-shelf, plan-checklist and clean-view.

- **Alone** (side-stack not installed): idea-shelf opens its own "Ideas" pane, as before.
- **With side-stack**: idea-shelf does not open its own pane (it closes it if it had already
  opened before side-stack loaded). It draws a section headed "Ideas" inside the Stack pane, and
  always draws the other mods' sections below it. To leave room for them, the section shows the
  first 6 ideas and a "Show all" button for the rest. If the own pane is still drawn somewhere, it
  shows one line, "Shown in the Stack pane (/stack)", so the list never shows twice.

side-stack counts as present when its `/stack` command is live, and nothing else is required.
side-stack's own session flag is not used, because a `/clear` starts a new session and session state
does not carry over. idea-shelf checks 100 ms and about 1.1 s after the session starts, because the
order in which mods load is not fixed. It checks again on every change, on every `/ideas`, and after
reloading the shelf for a new session id. If side-stack goes away, the own pane comes back on the
next change. While idea-shelf draws inside the stack it sets its own flag `idea-shelf.stacked` to
true, which side-stack reads to hide its install hint.

**Section order.** side-stack decides the order of the sections: install order by default, or the
order you set with side-stack's `/stack order`. idea-shelf draws its section in a box keyed
`side-stack:idea-shelf`, so side-stack can move it. When side-stack wants the section somewhere
idea-shelf cannot reach by drawing on top, it leaves an empty box keyed `side-stack:slot:idea-shelf`,
and idea-shelf puts its section there. With no such box (an older side-stack), the section goes on
top of the others, as in 0.2.

## How it works

The mod is one hooks module (`hooks/register.tsx`). At session start it loads the saved shelf for
the folder, registers the `/ideas` command and opens its pane (or not, inside side-stack). Ideas are
kept in the mod's session state. Each change re-reads the saved shelf, applies itself, and writes
only the difference to `$.store` (a key per idea). Send claims the ideas that are not already waiting in one atomic update of the
shelf (so two presses never send an idea twice), marks them with that Send's number, builds the
numbered list and submits it with `$.prompt.submit`. The engine resolves that call with the prompt
once it has entered. The ideas leave when it resolves, or when the mod sees its own prompt pass the
hooks beneath without a drop, or when the turn that prompt starts begins. That last check matters
because in the app the submit's promise may never settle. A turn is matched to the oldest Send whose
message it carries. A dropped or failed prompt removes only that Send's marks.

## Uninstall

```
/plugin uninstall idea-shelf@lucas-tools
```

From a shell, the same commands work with `claude plugin` in place of `/plugin`.

## Limits

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- Ideas are saved in Claude Code's per-plugin store, not in a file you can edit.
- The waiting mark is not saved: an app reload while ideas are waiting brings them back as normal
  ideas, so if the message had already entered, you may see them again and delete them by hand.
- A real `/clear` was tried in a terminal session (Claude Code 2.1.319, with side-stack and the
  other mods loaded): the ideas stayed in the Stack section after `/clear`, after a second `/clear`,
  and after a prompt and its turn. The engine gives the session a new id, empties the session state
  and keeps the mod's module variables. Events can reach the mod between the session ending and the
  state being emptied, so idea-shelf keeps its "loaded for this session" marker in the session state
  itself. 0.3.0 kept it in a module variable and drew an empty shelf after a real `/clear`. The tests
  model both orders.
- Two sessions saving at the same moment keep both changes because each idea is its own store key and
  Claude Code writes a key under a lock on the store file (seen in the 2.1.322 engine code, and in a
  test with two real `claude -p` processes writing 60 times each: one shared key read and written
  back lost 27 of 120 writes, one key per write lost none). One gap remains: an idea one session
  edits while another deletes it may come back with the edit.
- While a session still runs 0.3.6 or older, it keeps writing the old single key, so an idea you
  deleted in a newer session can come back. Restart every session after updating.
- The side-stack mode is covered by the tests, with a stand-in for side-stack's flag and pane. The
  way mods share the pane was tried by hand with two throwaway mods in Claude Code 2.1.319;
  idea-shelf itself has not been tried by hand inside side-stack yet.
- The shelf keeps the last 200 ideas. An idea is cut at 1000 characters.
- The tests draw every view (own pane, stacked section, buttons, the Send flow) on both the
  `terminal` and `desktop` surfaces, and they use only elements both have (Box, Text, Button,
  Input). One difference: the terminal only places a pane you did not ask for when the window is wide
  enough (see Use). The docs state that rule in terminal columns only, and how the desktop app places
  such a pane was not checked. Nobody has tried it by hand in the desktop app.
- Not tested on the mobile app. Where the app draws no text fields, the pane shows
  "Type /ideas your idea to park one." and only the Delete and Send buttons.
- Tests: `claude plugin test .` and `claude plugin validate .`.

## Credits

The idea comes from the "Idea Shelf" mod in the AI LABS video [Claude Mods Are Insane... You Need To Try These Right Now](https://www.youtube.com/watch?v=ERNqRK6sMJY) (9 Oct 2026), [Idea Shelf at 08:52](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=532). This code was written separately with Claude Code.

## License

MIT. See `LICENSE`.

Built with Claude Code

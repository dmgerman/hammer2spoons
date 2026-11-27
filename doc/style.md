# Naming and writing

This is part of the instructions in `CLAUDE.md`, which points here.

## Naming

Two conventions, and they do not mix. Ported Hammerspoon 1 code is renamed to match these
rather than keeping its Lua spelling.

| What | Style | Examples |
|------|-------|----------|
| Functions and variables | `camelCase` | `keyToWindowAttach`, `mouseScreenCenterNext`, `closedWindowsForget` |
| Spoon `config` keys | `camelCase` | `attachModifiers`, `screenshotDir`, `historySize` |
| Module-level constants | `UPPER_SNAKE` | `CANCEL`, `MUSIC_BUNDLE_ID`, `DELTA_PRESETS` |
| Command names | `hyphenated`, Emacs Lisp style | `window-attach-to-key`, `mouse-screen-center-next` |
| Spoon directories | `hs_<name>-gt` | `hs_window-gt` |

No underscores in function names, with one exception. A Spoon that exports a function in a form
that reads its omitted arguments through `hs_interactive-gt` keeps the function as written under
the name `_<name>`, and exports the reading form as `<name>`. In `hs_window-gt`, `_leftHalf`
never prompts, while `module.exports.leftHalf` does. The leading underscore marks the form the
Spoon calls internally, so that the two cannot be confused in its code. Readmes document only
`<name>`. The user decided this on 2026-11-15.

### Subject first, action last

This governs every identifier, not just commands. The subject leads and the action follows:
`windowPrevious`, not `previousWindow`; `applicationWindowSelect`, not
`selectApplicationWindow`. Related names then sort together wherever they are listed — in the
chooser, in an editor's symbol list, in a file.

| Wrong                      | Right                      |
|----------------------------|----------------------------|
| `previousWindow()`         | `windowPrevious()`         |
| `selectApplicationWindow()`| `applicationWindowSelect()`|
| `attachKeyToWindow()`      | `keyToWindowAttach()`      |
| `forgetClosedWindows()`    | `closedWindowsForget()`    |
| `toggleOnScreen()`         | `onScreenToggle()`         |
| `newTab()`                 | `tabNew()`                 |

A preposition stays with the subject it belongs to rather than being moved to the end:
`keyToWindowAttach`, not `keyWindowToAttach` or `windowKeyAttach`. The whole subject phrase
comes first and the action closes the name.

### A command is named after the function it calls

Because both follow the same order, a command name is just its function's name in hyphenated
words, prefixed with the subject when the function name does not already carry it — the
Spoon's own name usually supplies it.

| Function          | Command                    |
|-------------------|----------------------------|
| `peek()`          | `menubar-peek`             |
| `peekHide()`      | `menubar-peek-hide`        |
| `windowPrevious()`| `window-previous`          |
| `historyShow()`   | `clipboard-show`           |

Dropping a word the Spoon's name already supplies is fine: `historyShow()` in
`hs_clipboard-gt` is `clipboard-show`, not `clipboard-history-show`.

**What may not change is the action.** A command may not claim to do something its function
does not, and a name may not claim behaviour the code does not have. Both of these were
wrong, for the same reason:

| Wrong                 | Was bound to    | Actually did                  |
|-----------------------|-----------------|-------------------------------|
| `menubar-peek`        | `peekToggle()`  | toggled, while the name said show |
| `menubar-peek-toggle` | `peekToggle()`  | hid itself after 4s, so not a toggle at all |

Rename the function and the command together when either changes.

## Writing

Comments, docstrings, readmes, issue drafts and conversation are all held to this.

**No metaphor or figurative framing.** Describe what the code or the system actually does.

**Plain is not the same as abstract.** The failure to watch for is removing a metaphor and
leaving vagueness behind. An abstraction reads as evasive in a way the metaphor did not, so
the text gets worse rather than better:

| Figurative                     | Abstract, and worse                                     | Right                                    |
|--------------------------------|---------------------------------------------------------|------------------------------------------|
| only one click gets through     | `can be clicked in one way that reaches JavaScript`     | `only a left click reaches the Spoon`    |
| the chunk that most wants showing | `the chunk whose display is most warranted`           | `the chunk that most needs to be shown`  |
| every audio application hiccups | `audio clients experience discontinuity`                | `every application using audio is interrupted briefly` |

**One thing per sentence.** Convoluted text is usually a single sentence in which every
clause qualifies the one before it, often ending in a counterfactual inside a counterfactual
(`there would be no menu to show if it were`). Split it. When there is more than one reason
for something, number them:

> A left click to start dictating, with a right click for everything else, would be better.
> It cannot be built in Hammerspoon 2, for three reasons:
>
> 1. A right click on a menu bar item never reaches the Spoon.
> 2. A left click cannot say which button it was.
> 3. Attaching a menu replaces the click action instead of adding to it.

**Lead with the fact, then the qualification.** Not the other way round, and not both woven
together.

**Write full sentences, not notes.** Brevity is not the goal; a human is going to read this.
Give each sentence its subject and verb rather than compressing it into a label and a colon,
and spell out what was done rather than leaving the reader to reconstruct it:

| Too compressed | Right |
|----------------|-------|
| `Clicked by hand: two left clicks, then one right click. Three clicks produced two callbacks:` | `I then clicked that menu bar item by hand three times: two left clicks, followed by one right click. Those three clicks produced only two callbacks, and both recorded exactly the same thing:` |
| `Not a defect, but it rules out keeping the callback and adding a menu.` | `This is simply how NSStatusItem works, so I am not reporting it as a defect. It does, however, rule out the obvious alternative, which would have been to keep the click callback and attach a menu alongside it.` |

This matters most in issue drafts and readmes, where the reader has none of the context that
made the short version legible to whoever wrote it.

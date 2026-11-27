# Publishing Spoons

This is part of the instructions in `CLAUDE.md`, which points here.

Users install these Spoons with `hs.spoons.install()` or `hs.spoons.use()`, straight from this
repository. `ai/hs2-spoon-install.org` explains how Hammerspoon 2 does that. The rules below
follow from it.

### Nothing local to one machine

A published Spoon contains nothing local to the machine it was written on. That excludes paths,
user names, host names, device names, accounts, personal domains and identifiers (such as a
launchd label), personal data, and any dependency on files or Spoons that are not published.
Anything a user has to supply comes from the Spoon's configuration.

If something local cannot be removed from a Spoon, the Spoon is not published.

### Where a Spoon lives

Each Spoon is a directory `Spoons/<name>.spoon2/`. `hs.spoons.install()` finds a Spoon only in
a directory whose name ends in `.spoon2`, and takes the Spoon's name from that directory. The
directory is installed as `Spoons/<name>` in the user's configuration, without the extension.

`<name>` must be the same as the `name` in the Spoon's `spoon.json`. Nothing checks this, so
check it by hand.

### What a Spoon contains

| File            | Holds                                                               |
|-----------------|---------------------------------------------------------------------|
| `spoon.json`    | `name`, `author`, `version` and `description`, none of them empty   |
| `init.js`       | The Spoon, which sets `module.exports` to an object                 |
| `readme.org`    | The documentation for users, in Org mode                            |
| `images/`       | The screenshots the readme shows                                    |

A Spoon may also hold the files it reads while it runs, such as elisp files, a server it
starts, or sounds. It holds nothing else. A Spoon may not contain a symbolic link, because
`hs.spoons.install()` refuses one.

An installed Spoon has only its own directory. It cannot `require()` a file outside it, such as
a shared `lib/` directory. Code it needs is either inside it or in another published Spoon that
it loads.

### When one Spoon uses another

Hammerspoon 2 has no dependencies between Spoons, so each Spoon handles them itself.
`ai/spoon-dependencies.org` lists them and explains the reasons.

1. An optional dependency makes a Spoon better when the other Spoon is loaded. The Spoon reads
   `hs.spoons["<name>"]` when it needs it, and works without it. It never loads or installs the
   other Spoon; that is the user's choice.
2. A required dependency is one the Spoon cannot work without. The Spoon checks for it in
   `start()`. When it is missing, `start()` throws an `Error` that names the missing Spoon and
   gives the address of its documentation:
   `https://github.com/dmgerman/hammer2spoons/tree/main/Spoons/<name>.spoon2`. The Spoon never
   offers to install it.

`hs.spoons.load()` throws `ENOTINSTALLED` for a Spoon that is not installed. It does not return
`null`.

Every readme lists the Spoons it uses, says whether each is optional or required, and says to
load them first.

Most Spoons that do things for the user will provide a menu of those things, and so require
`hs_menu-gt`. Such a Spoon exports its menu as `menu` and opens it with `menuShow()`, its options
call the Spoon's functions with `fn:`, and its `bindHotkeys()` accepts `menuShow`, so that a user
can open the menu through the `hotkeys` option of `hs.spoons.use()`. `hs_window-gt` and
`hs_appleMusic-gt` were the first.

A Spoon that asks the user for input, such as a window, a screen, a number or a line of text,
requires `hs_interactive-gt` and obtains the input through its readers, such as
`readers.window.prompted`. It does not build its own `hs.chooser` or dialog. Input is then
handled in one place, and every prompt is visible to `promptIsOpen()`, on which other Spoons
such as `hs_menu-gt` rely. `hs_window-gt` was the first. Defining named commands for a Spoon's
functions remains the user's choice: a Spoon does not define commands itself, and its readme may
suggest command definitions.

### What users download

Installing any one Spoon downloads the whole repository as a zip file, and then copies only that
Spoon. Two rules keep the download small:

1. Files that only developers need are marked `export-ignore` in `.gitattributes`. That keeps
   them in the repository and out of the zip. Tests, makefiles, and the planning files at the
   top level (`ai/`, `.beads/` and the agent files) are marked this way. `export-ignore` only
   shortens the download: the files stay public on GitHub.
2. Images are stored at the size they are shown at. A screenshot or an image the Spoon displays
   should be tens of kilobytes, not megabytes.

Generated files, such as `__pycache__`, are never committed.

### Screenshots

A readme shows a screenshot wherever the Spoon has something to see. Screenshots are taken one
Spoon at a time, in that Spoon's own bead.

1. Capture with Hammerspoon 2, through `hs2`. `HSWindow.snapshot()` captures a window,
   `HSScreen.snapshot()` followed by `croppedCopy()` captures an overlay such as an alert, and
   `imageFromCanvas()` captures a Spoon's canvas. Something that closes when the focus moves,
   such as an open menu, is captured by the user with `screencapture -i`. All of these need the
   Screen Recording permission.
2. Crop each image to the part that shows the feature, not the whole screen.
3. Shrink it to at most 1200 pixels wide and 256 colours, as PNG, without dithering:
   `magick in.png -resize '1200x>' +dither -colors 256 -strip out.png`. An image should be
   under 200 KB. Without `+dither`, ImageMagick approximates the dropped colours with a dot
   pattern, which shows on gradients such as a translucent chooser; 256 colours without it
   looks the same as the full image, at about a third of the size.
4. Store it as `Spoons/<name>.spoon2/images/<what-it-shows>.png`. Images stay in the download,
   so that an installed Spoon's readme shows them too.
5. Give every image in a readme alt text that says what it shows, as an Org export snippet:
   `@@html:<img src="./images/<what-it-shows>.png" alt="What it shows">@@`. GitHub renders Org
   with org-ruby, which ignores `#+ATTR_HTML` and gives an image linked as `[[./images/x.png]]`
   its path as alt text; it passes an `@@html:` snippet through as HTML. Emacs then shows the
   snippet as text instead of the image.

Before capturing, set up neutral content: sample text, generic window titles, and no real file
names, messages, accounts or clipboard contents.

**The user approves the contents of every screenshot before it is committed.** Show each image
to the user, and commit it only once the user has said it may be published.

The user can help take a screenshot when that is needed, for example when the Spoon has to be
used by hand to show something, or when a capture from `hs2` does not show it properly. Ask
rather than settle for a screenshot that does not show the feature.

### Versions

`hs.spoons.update()` reinstalls a Spoon only when the `version` in its `spoon.json` has changed.
Every change to a Spoon therefore raises its version, or users who update will not receive it.

A release of the collection is a tag of the repository, `v<major>.<minor>.<patch>`, made by the
user. Each release has a section in `CHANGELOG.org` that lists every Spoon's version and what
changed in it since the previous release. Changes made between releases are listed under an
`Unreleased` section at the top, as each one is committed.

Every `spoon.json` declares `minimumHSVersion`, the oldest Hammerspoon 2 release the Spoon may be
loaded on. `hs.spoons.load()` refuses the Spoon, with the error `EVERSION`, on an older
Hammerspoon 2. Since 2026-11-27 every Spoon declares `1.0.0-beta.4`.

`minimumHSVersion` is raised only when a Spoon starts to rely on something that the release it
names does not have, such as a new function or a change of behaviour. A new Hammerspoon 2 release
alone does not raise it, so that users of an older release keep receiving updates. It is raised
for that Spoon only, to the first release that has what the Spoon relies on.

Every time the Hammerspoon 2 checkout (`~/git.w/Hammerspoon2`) is rebased on upstream, the pulled
changes are read for anything a Spoon could rely on, and for a new release
(`git describe --tags --abbrev=0 origin/main`). A change that a Spoon then uses is not used until
a release includes it, or the Spoon's readme says that it needs a build from `main` for the time
being.

When `minimumHSVersion` is raised:

1. The Requirements section of the Spoon's readme names the same release, and so does the
   top-level readme when it names a release that every Spoon needs.
2. The refusal is checked with a build that reports the release before it:
   `make build-debug MARKETING_VERSION=<previous release>` in the Hammerspoon 2 checkout. The Spoon
   must then be refused. The configuration stops at its first `hs.spoons.load()`, so the user is
   told first, and the normal build is restored straight after.
3. Raising `minimumHSVersion` is a change to the Spoon, so it raises the Spoon's `version`.

// hs_interactive-gt — named commands, interactive argument readers, and key bindings by name.
//
// A command is a function a user can invoke directly. A function becomes a command by
// being defined here with a name, a docstring and, when it takes arguments, an
// `interactive` specification stating how each is to be read. The specification applies
// only when a person invokes the command: this layer reads the values, from the current
// state or through a chooser or dialog, so no command contains input handling of its own.
// Called from other code, a command receives its arguments directly and nothing is read.
//
// Keys are bound to command *names*, not to functions, so binding order does not matter,
// a command can be redefined without rebinding, and every binding can be listed and
// reported.
//
//     const interactive = hs.spoons.load("hs_interactive-gt")
//
//     interactive.define({
//         name: "window-move-left-half",
//         doc:  "Move a window to the left half of its screen.",
//         interactive: [
//             {
//                 name: "window",
//                 reader: interactive.readers.window.auto
//             }
//         ],
//         fn: (win) => { /* ... */ }
//     })
//
//     interactive.keySet(["cmd", "ctrl", "alt"], "left", "window-move-left-half")
//
// A parameter names the reader variant it uses — `.implicit`, `.prompted` or `.auto` — so
// whether a command prompts is the command's decision, not this layer's. Implicit values
// are read from a snapshot taken when the command is invoked, before any chooser or dialog
// takes focus, so `.auto` returns the window that was focused at that point.

// MARK: - Sentinels

// Returned by a reader when the user dismissed its prompt: the whole command is
// abandoned. Distinct from null, which some readers return as a real value.
const CANCEL = Symbol("cancel")

// Returned by a reader when the user chose to leave the parameter unset: the argument
// is dropped so the command's own default applies.
const SKIP = Symbol("skip")

// This application, so that a prompt can bring it forward and put back what was in front
// afterwards. See ask().
const OWN_BUNDLE_ID = "net.tenshu.Hammerspoon-2"

// MARK: - State

const registry = new Map()          // name -> command spec
const keymap = new Map()            // chordId() -> {mods, key, command, hotkey}

// How the chooser and commands() order commands: "mru" or "alphabetic".
let order = "mru"

// Use order, as a counter: only the relative order matters, and a counter cannot go
// backwards when the system clock does.
const lastUsed = new Map()          // name -> use number
let useCount = 0


// MARK: - Prompt observers
//
// A prompt takes the keyboard, so whatever else is bound to it has to stand down for as
// long as one is up. The on-screen menu binds a hotkey per button, arrow keys among them,
// and a hotkey outranks the chooser's own key handling: without this the arrows would move
// windows while a chooser waits for one to be chosen.
//
// Counted rather than a flag, since a command that reads two parameters shows one chooser
// after another. Observers hear about the first opening and the last closing.
const promptObservers = new Set()
let promptDepth = 0
// Seconds after the last prompt closes before promptChangeOn()'s subscribers are told, and the
// timer that tells them. See promptClosed().
const PROMPT_CLOSED_DELAY = 0.1
let promptClosedTimer = null

/**
 * Be told when a prompt appears and when the last one goes away.
 *
 * @param {function} fn Called with true when a prompt opens, false when none is left.
 * @returns {function} Call it to stop being told.
 */
function promptChangeOn(fn) {
    promptObservers.add(fn)
    return () => promptObservers.delete(fn)
}

/** Whether a prompt is on screen. */
function promptIsOpen() {
    return promptDepth > 0
}

/**
 * Report that a prompt has opened. Exported so that a Spoon with a chooser of its own, such as
 * hs_selectWindow-gt, is reported by promptIsOpen() like this Spoon's prompts. Every call must
 * be followed by one call of promptClosed(), on every path that closes the prompt.
 */
function promptOpened() {
    promptDepth += 1
    if (promptDepth !== 1) return
    // A prompt that opens within PROMPT_CLOSED_DELAY of the last one closing continues the same
    // sequence of prompts: the subscribers were never told it closed.
    if (promptClosedTimer) {
        promptClosedTimer.stop()
        promptClosedTimer = null
        return
    }
    notifyPrompt(true)
}

/** Report that a prompt reported with promptOpened() has closed. */
function promptClosed() {
    if (promptDepth === 0) return
    promptDepth -= 1
    if (promptDepth !== 0) return
    // The subscribers are told after PROMPT_CLOSED_DELAY, unless another prompt opens first.
    // A command that reads two arguments closes one chooser and opens the next, and its
    // subscribers would otherwise be told "closed" and "open" between them (found by the tests
    // on 2026-11-23). promptIsOpen() is exact meanwhile; only the notice waits.
    promptClosedTimer = hs.timer.doAfter(PROMPT_CLOSED_DELAY, () => {
        promptClosedTimer = null
        if (promptDepth === 0) notifyPrompt(false)
    })
}

function notifyPrompt(open) {
    for (const observer of promptObservers) {
        try {
            observer(open)
        } catch (e) {
            console.error(`[hs_interactive-gt] a prompt observer failed: ${e.message}`)
        }
    }
}

// MARK: - Describing values
//
// Every bridged Hammerspoon type carries `typeName` and a `toString()` of the form
// "<HSScreen: LC49G95T>", so unknown types still render sensibly. Entries here exist
// only where the type's own description reads poorly in a parameter list.

const describers = {
    HSWindow: (w) => `${w.title || "(untitled)"} — ${w.application ? w.application.name : "?"}`,
    HSScreen: (s) => `${s.name} (${s.frame.w}×${s.frame.h})`,
    HSApplication: (a) => a.name
}

/**
 * Render a value for display in a prompt or a command listing.
 *
 * @param {*} value Any value, including bridged Hammerspoon objects.
 * @returns {string} A short human-readable description.
 */
function describe(value) {
    if (value === null) return "null"
    if (value === undefined) return "—"
    if (Array.isArray(value)) return value.map(describe).join(", ")
    if (typeof value === "string") return JSON.stringify(value)
    if (typeof value !== "object") return String(value)

    const typeName = value.typeName
    if (typeName && describers[typeName]) return describers[typeName](value)
    if (typeName) return String(value).replace(/^<[^:]+:\s*/, "").replace(/>$/, "")

    try {
        return JSON.stringify(value)
    } catch (e) {
        return String(value)
    }
}

// MARK: - Prompting
//
// The mapping from a button index to an action is made in this one function.
// hs.ui.textPrompt reports an index into the array given to .buttons(), so labels and
// indices are in the same order.

/**
 * Show a text prompt with OK / Skip / Cancel and report which was chosen.
 *
 * @param {object} options `message`, `context`, `defaultText`, `optional`.
 * @returns {{action: string, text: string}} action is "ok", "skip" or "cancel".
 */
function ask(options) {
    const labels = options.optional ? ["OK", "Skip", "Cancel"] : ["OK", "Cancel"]
    let result = { action: "cancel", text: "" }

    // Hammerspoon 2 is brought forward first, and the application that was in front is put
    // back after the prompt closes.
    //
    // hs.ui.textPrompt shows an NSAlert with runModal(). On 2026-11-24, with this call
    // removed, a dialog opened behind other windows and Hammerspoon 2 did not come to the
    // front. A window cannot take the keyboard while its application is in the background.
    // hs.chooser does not need this, because ChooserPanel is an NSPanel with
    // .nonactivatingPanel, which accepts keys while its application is in the background.
    //
    // launchOrFocus for Hammerspoon 2 itself: the prompt window does not exist yet, so there
    // is no main window for setFrontmost to bring forward. When the prompt closes, Hammerspoon
    // 2 stays in front. setFrontmost(false) then brings back only the previous application's
    // front window, and leaves its other windows where they are.
    const previous = hs.application.frontmost()
    const restoreTo = previous && previous.bundleID !== OWN_BUNDLE_ID ? previous : null
    hs.application.launchOrFocus(OWN_BUNDLE_ID)

    promptOpened()
    try {
        hs.ui.textPrompt(options.message)
            .informativeText(options.context || "")
            .defaultText(options.defaultText === undefined ? "" : String(options.defaultText))
            .buttons(labels)
            .onButton((index, text) => {
                result = { action: (labels[index] || "Cancel").toLowerCase(), text: text }
            })
            .show()
    } finally {
        // show() is modal, so the prompt is gone by the time it returns.
        promptClosed()
        if (restoreTo) restoreTo.setFrontmost(false)
    }

    return result
}

/**
 * Show a chooser and resolve to the chosen row's `value`, or to CANCEL / SKIP.
 *
 * @param {object} options `placeholder`, `context`, `choices`, `optional`.
 * @returns {Promise<*>} The selected value.
 */
function pick(options) {
    return new Promise((resolve) => {
        const rows = []
        if (options.optional) rows.push({ text: "(skip — use the default)", skip: true })
        for (const choice of options.choices) rows.push(choice)

        const chooser = hs.chooser.create()
        chooser.placeholder = options.placeholder || "Choose"
        chooser.searchSubText = true
        chooser.setChoices(rows)
        chooser.onSelect = (item) => {
            promptClosed()
            if (!item) resolve(CANCEL)
            else if (item.skip) resolve(SKIP)
            else resolve(item.value)
        }
        promptOpened()
        chooser.show()
    })
}

// A chooser sits horizontally centred on the main screen, a quarter of the way down, and
// is half the screen's width. The frame is computed inside Hammerspoon 2, by
// ChooserPanel.initialFrame in hs.chooser/Views/ChooserWindow.swift, and HSChooser exposes
// neither the frame nor the window, so these two repeat the arithmetic rather than read
// it. They place the alert, never the chooser, and so are copies that can fall out of step:
//
//   CHOOSER_WIDTH_FRACTION  the default of the JS-settable `chooser.width`, applied by
//                           HSChooser as width × the main screen's full width. pick()
//                           leaves it alone; anything that does set chooser.width has to
//                           set this to match.
//   CHOOSER_TOP_FRACTION    hardcoded in initialFrame, neither settable nor readable, so
//                           an upstream change to it moves the chooser and leaves the
//                           alert behind.
const CHOOSER_WIDTH_FRACTION = 0.5
const CHOOSER_TOP_FRACTION = 0.25

/**
 * Show a short message where a chooser's top left corner is, or would be.
 *
 * hs.ui.alert positions the centre of its bubble, in points down and right of the main
 * screen's top left corner, so the message straddles the corner rather than starting at
 * it, and is lifted clear of the search field.
 *
 * @param {string} message The text to show.
 */
function alertAtChooser(message) {
    const alert = hs.ui.alert(message).duration(2)
    const screen = hs.screen.main()
    if (screen) {
        const frame = screen.frame
        const width = CHOOSER_WIDTH_FRACTION * screen.fullFrame.w
        alert.position({
            x: (frame.w - width) / 2,
            y: CHOOSER_TOP_FRACTION * frame.h - 30
        })
    }
    alert.show()
}

// MARK: - Snapshot
//
// The focused window, frontmost application and current screen at the moment the command
// was invoked. Taken before any prompt appears: a chooser or dialog takes keyboard focus,
// after which hs.window.focusedWindow() returns Hammerspoon's own window.

/**
 * Capture the current window, application and screen.
 *
 * @returns {object} `{window, application, screen}`, any of which may be null.
 */
function snapshot() {
    const window = hs.window.focusedWindow()
    return {
        window: window,
        application: hs.application.frontmost(),
        // A window in another space has no screen; the main screen stands in for it, as it
        // does when there is no window.
        screen: (window && window.screen) || hs.screen.main()
    }
}

// MARK: - Readers
//
// A reader provides up to three ways to obtain a value, and the command selects one:
// `implicit` reads it from the snapshot, `prompted` always prompts, and `auto` prompts
// only when the snapshot value is null. Pass the variant itself: `readers.window.auto`.
//
// Every variant is called as (context, parameter, snapshot).

/**
 * The snapshot's window, when a command may act on it: a standard window, or any window when the
 * parameter has includeNonStandard, as window.prompted offers. Null otherwise.
 *
 * With the desktop clicked, hs.window.focusedWindow() returns Finder's desktop, an element of
 * role AXScrollArea and subrole AXDesktop that is not a standard window, rather than null
 * (measured on 2026-11-24). A command such as hs_window-gt's maximize then acted on it and did
 * nothing, with no chooser and no alert.
 */
function snapshotWindow(parameter, snap) {
    const window = snap ? snap.window : null
    if (!window) return null
    if (parameter && parameter.includeNonStandard) return window
    try {
        return window.isStandard ? window : null
    } catch (e) {
        return null
    }
}

const readers = {
    window: {
        implicit: (context, parameter, snap) => snapshotWindow(parameter, snap),

        /**
         * The focused window, or a chooser when there is none. An application that
         * reports no window at all — Emacs does this once its accessibility interface
         * stops answering — is named in an alert at the chooser's corner, so that the
         * chooser appearing in place of the expected window is not read as the command
         * failing.
         */
        auto: (context, parameter, snap) => {
            const window = snapshotWindow(parameter, snap)
            if (window) return window
            if (snap.application) {
                alertAtChooser(`${snap.application.name} reports no visible window`)
            }
            return readers.window.prompted(context, parameter, snap)
        },

        /**
         * Choose a window. The parameter may narrow what is offered:
         *
         *   includeCurrent      false leaves out the window the command started on, for a
         *                       command that acts on this window and a second one.
         *   includeNonStandard  true also offers windows that are not standard, such as
         *                       dialogs, panels and palettes. Only standard windows by default.
         */
        prompted: (context, parameter, snap) => {
            const current = snap ? snap.window : null
            const wantCurrent = parameter.includeCurrent !== false
            const wantNonStandard = parameter.includeNonStandard === true

            // From hs_windowfilter-gt when it is loaded: it tracks every window already,
            // whereas hs.window.orderedWindows() walks every running process and waits on
            // the slowest. The order is lost, which matters only for reading the list.
            const tracker = hs.spoons["hs_windowfilter-gt"]
            const listed = tracker
                ? tracker.default.records()
                    .filter((record) => wantNonStandard || record.state.standard)
                    .map((record) => record.window)
                : hs.window.orderedWindows().filter((w) => wantNonStandard || w.isStandard)
            const windows = listed.filter(
                (w) => wantCurrent || !current || w.id !== current.id)

            if (!windows.length) {
                hs.ui.alert("No other window to choose").duration(2).show()
                return CANCEL
            }

            return pick({
                placeholder: parameter.placeholder || "Window",
                context: context,
                optional: parameter.optional,
                // The application name is in `text` as well as `subText`: a window is often
                // easier to name by its application than by its title, and typing matches
                // `text` whatever the chooser's searchSubText setting happens to be.
                choices: windows.map((w) => {
                    const app = w.application ? w.application.name : "?"
                    return {
                        text: `${app} — ${w.title || "(untitled)"}`,
                        subText: `${app}${w.screen ? " · " + w.screen.name : ""}`,
                        value: w
                    }
                })
            })
        }
    },

    application: {
        implicit: (context, parameter, snap) => snap.application,
        auto: (context, parameter, snap) => snap.application || readers.application.prompted(context, parameter, snap),
        prompted: (context, parameter) => pick({
            placeholder: parameter.placeholder || "Application",
            context: context,
            optional: parameter.optional,
            choices: hs.application.runningApplications().map((a) => ({
                text: a.name,
                subText: a.bundleID || "",
                value: a
            }))
        })
    },

    screen: {
        implicit: (context, parameter, snap) => snap.screen,
        auto: (context, parameter, snap) => snap.screen || readers.screen.prompted(context, parameter, snap),

        /**
         * Choose a screen. The parameter may narrow what is offered:
         *
         *   includeCurrent     false leaves out the screen the command started on, for a
         *                      command whose whole purpose is to move somewhere else.
         *   includeFullscreen  false leaves out screens showing a fullscreen window.
         */
        prompted: (context, parameter, snap) => {
            const current = snap ? snap.screen : null
            const wantCurrent = parameter.includeCurrent !== false
            const wantFullscreen = parameter.includeFullscreen !== false

            // Hammerspoon 1 asked hs.spaces for the space type. Hammerspoon 2 has no
            // spaces module, so a screen counts as fullscreen when a window on it is.
            const fullscreen = new Set()
            if (!wantFullscreen) {
                const tracker = hs.spoons["hs_windowfilter-gt"]
                if (tracker) {
                    // The tracker holds each window's fullscreen flag and screen already.
                    for (const { state } of tracker.default.records()) {
                        if (state.fullscreen && state.screenID !== null) fullscreen.add(state.screenID)
                    }
                } else {
                    for (const window of hs.window.allWindows()) {
                        if (window.isFullscreen && window.screen) fullscreen.add(window.screen.id)
                    }
                }
            }

            const screens = hs.screen.all().filter((s) => {
                if (!wantCurrent && current && s.id === current.id) return false
                if (!wantFullscreen && fullscreen.has(s.id)) return false
                return true
            })

            if (!screens.length) {
                hs.ui.alert("No other screen to move to").duration(2).show()
                return CANCEL
            }

            return pick({
                placeholder: parameter.placeholder || "Screen",
                context: context,
                optional: parameter.optional,
                choices: screens.map((s) => ({
                    text: s.name,
                    subText: `${s.frame.w}×${s.frame.h}`,
                    value: s
                }))
            })
        }
    },

    number: {
        /**
         * A reader for a number within a range, offering the value it has now.
         *
         * `number.prompted` is this reader with no bounds. With bounds, a value outside
         * them is reported as soon as it is typed, so a command taking a percentage need not
         * check it. And `current` offers the setting's value when the prompt opens, where
         * `default` is a fixed value written when the command is defined.
         *
         * @param {object} options `min`, `max`, and `current`, a function returning the
         *        value to offer. `current` may be omitted, and may return null.
         * @returns {function} A reader, to be given as a parameter's `reader`.
         *
         * @example
         * interactive.define({
         *     name: "system-volume-set",
         *     interactive: [{
         *         name: "volume (0-100)",
         *         reader: interactive.readers.number.ranged({
         *             min: 0, max: 100, current: () => audio.systemVolume()
         *         })
         *     }],
         *     fn: (percent) => audio.systemVolumeSet(percent)
         * })
         */
        ranged: (options) => {
            const min = options && options.min !== undefined ? options.min : -Infinity
            const max = options && options.max !== undefined ? options.max : Infinity
            const current = options ? options.current : null

            return (context, parameter) => {
                let offered = parameter.default
                if (typeof current === "function") {
                    try {
                        const now = current()
                        if (now !== null && now !== undefined) offered = now
                    } catch (e) {
                        // The fixed default stands.
                    }
                }

                const answer = ask({
                    message: parameter.name,
                    context: context,
                    defaultText: offered,
                    optional: parameter.optional
                })
                if (answer.action === "cancel") return CANCEL
                if (answer.action === "skip") return SKIP

                const value = Number(answer.text)
                if (!Number.isFinite(value)) {
                    hs.ui.alert(`${parameter.name}: "${answer.text}" is not a number`).duration(2).show()
                    return CANCEL
                }
                if (value < min || value > max) {
                    hs.ui.alert(`${parameter.name}: ${value} is outside ${min} to ${max}`)
                        .duration(2).show()
                    return CANCEL
                }
                return value
            }
        }
    },

    string: {
        prompted: (context, parameter) => {
            const answer = ask({
                message: parameter.name,
                context: context,
                defaultText: parameter.default,
                optional: parameter.optional
            })
            if (answer.action === "cancel") return CANCEL
            if (answer.action === "skip") return SKIP
            return answer.text
        }
    },

    choice: {
        /**
         * Choose one of a list. The parameter supplies the list:
         *
         *   choices      the rows, `{text, subText, value}`, or a function of the snapshot
         *                that returns them
         *   placeholder  shown in the empty search field; "Choose" without it
         *   empty        the alert shown when there is nothing to choose
         */
        prompted: (context, parameter, snap) => {
            const choices = typeof parameter.choices === "function"
                ? parameter.choices(snap)
                : (parameter.choices || [])
            if (!choices.length) {
                hs.ui.alert(parameter.empty || "Nothing to choose").duration(2).show()
                return CANCEL
            }
            return pick({
                placeholder: parameter.placeholder || "Choose",
                context: context,
                optional: parameter.optional,
                choices: choices
            })
        }
    }
}

// A number with no bounds is a range with none, offering the parameter's own default.
readers.number.prompted = readers.number.ranged({})

/**
 * Run a reader outside a command, for a Spoon that asks the user for one value.
 *
 * @param {function} reader A reader variant, such as `readers.window.prompted`.
 * @param {object} [parameter] The reader's options, such as `{placeholder, includeCurrent}`.
 * @param {object} [snap] What the reader treats as current, `{window, application, screen}`.
 *        Taken now when omitted.
 * @returns {Promise<*>} The value read, or null when the reader was cancelled or skipped.
 */
function readerRun(reader, parameter, snap) {
    if (typeof reader !== "function") {
        throw new Error("hs_interactive-gt: readerRun() needs a reader variant, e.g. readers.window.prompted")
    }
    return Promise.resolve(reader(null, parameter || {}, snap || snapshot())).then((value) =>
        value === CANCEL || value === SKIP || value === undefined ? null : value)
}

/**
 * Create a function that reads its missing arguments from the user, for a Spoon that exports
 * functions whose arguments may be omitted. No command is defined.
 *
 * Each argument given as undefined is read with its parameter's reader, in order, from one
 * snapshot taken when the function is called. An argument given as anything else, null
 * included, is passed through unchanged. The created function returns what `fn` returns, or
 * a promise of it when a reader prompted, so that a call that prompts nobody stays
 * synchronous. When a reader is cancelled, `fn` is not called and the result is null.
 *
 * @param {function} fn The function to call once the arguments are read.
 * @param {object[]} parameters One entry per argument of `fn`, in order, in the form of a
 *        command's `interactive` entries: `{name, reader, default, optional}` and the reader's
 *        own options. An entry without a reader passes its argument through unchanged.
 * @returns {function}
 */
function interactiveFunctionCreate(fn, parameters) {
    if (typeof fn !== "function") {
        throw new Error("hs_interactive-gt: interactiveFunctionCreate() needs a function")
    }
    const entries = (parameters || []).map((parameter) => {
        const reader = readerFor(parameter)
        return { parameter: parameter, reader: reader }
    })

    return function (...given) {
        const values = given.slice()
        let snap = null

        // Reads from `index` on. Returns fn's result, or a promise of it once a reader has
        // returned a promise, or CANCEL.
        const readFrom = (index) => {
            for (let i = index; i < entries.length; i++) {
                const { parameter, reader } = entries[i]
                if (values[i] !== undefined || !reader) continue
                if (!snap) snap = snapshot()
                const value = reader(null, parameter, snap)
                if (value && typeof value.then === "function") {
                    return value.then((read) => {
                        if (read === CANCEL || read === undefined) return CANCEL
                        values[i] = read === SKIP ? parameter.default : read
                        return readFrom(i + 1)
                    })
                }
                if (value === CANCEL || value === undefined) return CANCEL
                values[i] = value === SKIP ? parameter.default : value
            }
            return fn(...values)
        }

        const result = readFrom(0)
        if (result && typeof result.then === "function") {
            return result.then((value) => (value === CANCEL ? null : value))
        }
        return result === CANCEL ? null : result
    }
}

// MARK: - The registry

/**
 * Declare a command.
 *
 * @param {object} spec `name`, `fn`, and optionally `doc`, `interactive` and `runDelay`.
 *        Each `interactive` entry is `{name, reader, default, optional}`, where `reader`
 *        is one reader variant — `readers.window.auto`, `readers.number.prompted` — or
 *        any function `(context, parameter, snapshot)`. A bare function is also accepted
 *        in place of the whole entry.
 *
 *        `runDelay` is a delay in seconds, and applies only when the command is
 *        run from the command chooser. Zero, the default, runs it from that chooser's own
 *        callback, which is while the chooser is still closing. A command that opens a
 *        chooser of its own wants a small delay instead: created during the overlap, the
 *        new chooser does not take the key window cleanly, and the next thing to draw takes
 *        it away, which looks like the chooser vanishing by itself. Reached from a key,
 *        with no other chooser closing, the same command is unaffected. 0.05 is enough.
 * @returns {object} The stored command.
 */
function define(spec) {
    if (!spec || typeof spec.name !== "string" || !spec.name) {
        throw new Error("hs_interactive-gt: define() needs a name")
    }
    if (typeof spec.fn !== "function") {
        throw new Error(`hs_interactive-gt: define(${spec.name}) needs an fn`)
    }

    const command = {
        name: spec.name,
        doc: spec.doc || "",
        fn: spec.fn,
        // The Spoon whose commands use() was defining, for commandsOfSpoon(), or null.
        spoon: definingSpoon,
        runDelay: Number(spec.runDelay) || 0,
        parameters: (spec.interactive || []).map((entry, index) => {
            // A bare function is the argument's reader, as the readme says. It used to be wrapped
            // as { prompted: entry }, an object, which readerFor() refuses, so such a command
            // never ran (found by the tests on 2026-11-23).
            if (typeof entry === "function") return { name: `arg${index + 1}`, reader: entry }
            // Every field of the entry is kept, so that a reader's options, such as choices or
            // includeCurrent, reach the reader, as the readme says. Only these four were kept
            // before, so a defined command lost its reader's options (found by the tests on
            // 2026-11-23).
            return Object.assign({}, entry, {
                name: entry.name || `arg${index + 1}`,
                reader: entry.reader || {},
                default: entry.default,
                optional: entry.optional === true
            })
        })
    }

    // A repeated definition replaces the previous one, so a config can be reloaded.
    registry.set(command.name, command)
    return command
}

/**
 * Set how commands are ordered in the chooser and in `commands()`.
 *
 * @param {string} newOrder `"mru"` — most recently used first, commands never used
 *        sorted by name after them — or `"alphabetic"`.
 */
function orderSet(newOrder) {
    if (newOrder !== "mru" && newOrder !== "alphabetic") {
        throw new Error(`hs_interactive-gt: order must be "mru" or "alphabetic", not "${newOrder}"`)
    }
    order = newOrder
    return module.exports
}

/** The current ordering, `"mru"` or `"alphabetic"`. */
function orderGet() {
    return order
}

// Records that a command was run by name, so "mru" has something to sort by. Commands
// run from a key are not recorded: they are already one keypress away.
function noteUse(name) {
    useCount += 1
    lastUsed.set(name, useCount)
}

/**
 * All commands, in the configured order.
 *
 * @param {string} [how] `"mru"` or `"alphabetic"`, overriding the configured order.
 * @returns {object[]} The commands.
 */
function commands(how) {
    const byName = (a, b) => a.name.localeCompare(b.name)
    const list = [...registry.values()]

    if ((how || order) === "alphabetic") return list.sort(byName)

    return list.sort((a, b) => {
        const usedA = lastUsed.get(a.name)
        const usedB = lastUsed.get(b.name)
        if (usedA && usedB) return usedB - usedA      // higher use number is more recent
        if (usedA) return -1
        if (usedB) return 1
        return byName(a, b)                           // never used: by name
    })
}

/** Look up one command, or undefined. */
function get(name) {
    return registry.get(name)
}

/**
 * Call a command directly with explicit arguments. No prompting.
 *
 * @param {string} name The command name.
 * @param {...*} args Arguments passed straight to the command's `fn`.
 */
function call(name, ...args) {
    const command = registry.get(name)
    if (!command) throw new Error(`hs_interactive-gt: no such command: ${name}`)
    noteUse(name)
    return command.fn(...args)
}

// A parameter's reader is one variant, such as readers.window.auto, so which of them
// runs is the command's decision and never this layer's.
function readerFor(parameter) {
    const reader = parameter.reader
    if (typeof reader === "function") return reader
    if (!reader) return null
    throw new Error(
        `hs_interactive-gt: parameter "${parameter.name}" was given a reader object; ` +
        `choose a variant, e.g. readers.window.auto, .implicit or .prompted`
    )
}

// The parameter table shown in each prompt: what has been collected so far, where each
// value came from, and which parameter is being asked for now.
function contextFor(command, values, sources, current) {
    const lines = [`${command.name} · argument ${current + 1} of ${command.parameters.length}`]
    if (command.doc) lines.push(command.doc)
    lines.push("")

    command.parameters.forEach((parameter, index) => {
        const marker = index === current ? "▸" : " "
        const value = index === current ? "?"
            : (index in values ? describe(values[index]) : describe(parameter.default))
        const source = sources[index] ? `  (${sources[index]})` : ""
        lines.push(`${marker} ${parameter.name} = ${value}${source}`)
    })

    return lines.join("\n")
}

/**
 * Invoke a command, obtaining any missing arguments through its readers.
 *
 * Readers run in declaration order against a snapshot of what was current when the
 * command was invoked, so a reader that runs after a prompt still sees the window you
 * started from. A cancelled prompt abandons the whole command.
 *
 * @param {string} name The command name.
 * @param {object} [options] `args` already supplied, `snapshot` if one was taken before
 *        this call — as `execute()` does before opening its chooser — and `via`, which
 *        is `"key"` when a hotkey triggered this, with `key`, the `{mods, key}` pressed.
 *        Only invocations by name count towards the recently-used order.
 * @returns {Promise<*>} Whatever the command returned, or undefined if cancelled.
 */
async function callInteractively(name, options) {
    const command = registry.get(name)
    if (!command) {
        console.error(`[hs_interactive-gt] no such command: ${name}`)
        return
    }

    const given = (options && options.args) || []
    const snap = (options && options.snapshot) || snapshot()
    const values = []
    const sources = []

    for (let index = 0; index < command.parameters.length; index++) {
        const parameter = command.parameters[index]

        if (index < given.length && given[index] !== undefined) {
            values[index] = given[index]
            sources[index] = "given"
            continue
        }

        let read
        try {
            read = readerFor(parameter)
        } catch (e) {
            console.error(`[hs_interactive-gt] ${command.name}: ${e.message}`)
            return
        }
        if (!read) {
            values[index] = parameter.default
            sources[index] = "default"
            continue
        }

        const context = contextFor(command, values, sources, index)
        const value = await read(context, parameter, snap)

        if (value === CANCEL) {
            console.log(`[hs_interactive-gt] ${command.name}: cancelled`)
            return
        }
        if (value === SKIP) {
            values[index] = parameter.default
            sources[index] = "skipped"
            continue
        }
        if (value === null || value === undefined) {
            values[index] = parameter.default
            sources[index] = "default"
            continue
        }
        values[index] = value
        sources[index] = "entered"
    }

    // Trailing holes are dropped so the function's own defaults apply.
    const args = []
    for (let i = 0; i < command.parameters.length; i++) args[i] = values[i]
    while (args.length > 0 && args[args.length - 1] === undefined) args.pop()

    // Noted only once every argument is in hand — a command abandoned at a prompt has not
    // been used — and only when invoked by name. A key press does not promote a command,
    // the way Emacs records extended-command-history for M-x but not for a binding.
    if (!options || options.via !== "key") noteUse(command.name)

    // keyRunning() reports the key while the function runs, so that a function can bind
    // the key that started it again, as hs_selectWindow-gt does to move through its chooser.
    keyRunningBinding = options && options.via === "key" && options.key ? options.key : null
    try {
        return command.fn(...args)
    } catch (e) {
        console.error(`[hs_interactive-gt] ${command.name} threw: ${e.message}`)
    } finally {
        keyRunningBinding = null
    }
}

// The key whose command is running, for keyRunning().
let keyRunningBinding = null

// The Spoon whose commands use() is defining, which define() records on each command.
let definingSpoon = null

/**
 * The commands defined for a Spoon by the `commands` option of use(), with the keys bound to
 * each, so that the Spoon can show them, as hs_selectWindow-gt's menu does.
 *
 * @param {string} name The Spoon's name, as given to use().
 * @returns {Array} `{name, doc, keys}` objects, in the order they were defined; `keys` holds the
 *          labels keyLabel() gives, such as "⌥B".
 */
function commandsOfSpoon(name) {
    return [...registry.values()]
        .filter((command) => command.spoon === name)
        .map((command) => ({ name: command.name, doc: command.doc, keys: keyLabels(command.name) }))
}

/**
 * The key that started the command now running, as `{mods, key}`, or null when no command runs
 * or it was not started by a key. A command's function reads it while it runs, before it
 * returns or first waits: it is cleared when the function returns, which for an async function
 * is at its first await.
 *
 * @returns {?object} `{mods, key}`, with the modifiers in the order keySet() keeps them.
 */
function keyRunning() {
    return keyRunningBinding ? { mods: keyRunningBinding.mods.slice(), key: keyRunningBinding.key } : null
}

/** Show the command chooser — the M-x equivalent. */
function execute() {
    // Taken before the chooser appears and handed to the command that gets chosen, so
    // "the focused window" still means the window you were in, not this chooser.
    const snap = snapshot()

    const chooser = hs.chooser.create()
    chooser.placeholder = "M-x"
    chooser.searchSubText = true
    // The chord goes in `text`, after the name: a row's right-hand column is the chooser's
    // own ⌘-digit hint and cannot be written to, and `subText` belongs to the docstring.
    chooser.setChoices(commands().map((command) => {
        const chords = keyLabels(command.name)
        const row = {
            text: chords.length ? `${command.name}   ${chords.join("  ")}` : command.name,
            // `text` carries the chord too, so the name is kept here for onSelect.
            command: command.name
        }
        // An empty subText still draws its line, leaving the name off centre in the row.
        if (command.doc) row.subText = command.doc
        return row
    }))
    chooser.onSelect = (item) => {
        if (!item) {
            promptClosed()
            return
        }

        // The count is not dropped until the command has finished, so that a command which
        // prompts in turn keeps it above zero and observers see one prompt throughout.
        const run = () => {
            try {
                callInteractively(item.command, { snapshot: snap })
            } finally {
                promptClosed()
            }
        }

        // From here, or from a timer once this chooser has closed, as the command asked.
        // See the runDelay option on define().
        const chosen = registry.get(item.command)
        const after = chosen ? chosen.runDelay : 0

        if (after > 0) {
            hs.timer.doAfter(after, run)
        } else {
            run()
        }
    }
    promptOpened()
    chooser.show()
}

// MARK: - Keys
//
// A key is bound to a command name in the form hs.hotkey.bind() takes: an array of modifier
// names, then the key. keySet(["cmd", "ctrl", "alt"], "v", "clipboard-show") runs
// clipboard-show on ⌃⌥⌘V.

// Modifier names as hs.hotkey accepts them, mapped to one spelling each, so that the same
// chord is the same binding however its modifiers are written or ordered.
const MODIFIER_NAMES = {
    cmd: "cmd", command: "cmd", "⌘": "cmd",
    ctrl: "ctrl", control: "ctrl", "⌃": "ctrl",
    alt: "alt", option: "alt", "⌥": "alt",
    shift: "shift", "⇧": "shift"
}

/**
 * The modifiers in one spelling each, sorted, so that a chord has one identity.
 *
 * @param {string[]} mods Modifier names as hs.hotkey accepts them.
 * @returns {string[]} The same modifiers, as "alt", "cmd", "ctrl" or "shift", sorted.
 * @throws If a modifier is not one hs.hotkey accepts.
 */
function modifiersNormalized(mods) {
    if (!Array.isArray(mods)) throw new Error("hs_interactive-gt: modifiers must be an array, such as [\"cmd\", \"alt\"]")
    return mods.map((mod) => {
        const name = MODIFIER_NAMES[String(mod).toLowerCase()] || MODIFIER_NAMES[mod]
        if (!name) throw new Error(`hs_interactive-gt: unknown modifier "${mod}"`)
        return name
    }).sort()
}

/** The keymap's key for a chord: its modifiers and its key, in one spelling. */
function chordId(mods, key) {
    return `${modifiersNormalized(mods).join("+")} ${String(key).toLowerCase()}`
}

/**
 * Bind a key to a command name, replacing any binding already on that chord.
 *
 * @param {string[]} mods Modifier names, as hs.hotkey.bind() takes them: ["cmd", "ctrl", "alt"].
 * @param {string} key The key, as hs.hotkey.bind() takes it: "v", "left", "f5".
 * @param {string} name The command to run. It need not be defined yet.
 * @returns {object|null} The binding record, or null if the key could not be bound.
 */
function keySet(mods, key, name) {
    const normalized = modifiersNormalized(mods)
    const keyName = String(key)
    if (!(keyName.toLowerCase() in hs.hotkey.getKeyCodeMap()) && keyName.length !== 1) {
        throw new Error(`hs_interactive-gt: unknown key "${keyName}"`)
    }

    const id = chordId(normalized, keyName)
    keyUnset(normalized, keyName)

    const hotkey = hs.hotkey.bind(normalized, keyName, () => {
        callInteractively(name, { via: "key", key: { mods: normalized, key: keyName } })
    }, null)
    if (!hotkey) {
        console.error(`[hs_interactive-gt] could not bind ${keyLabel({ mods: normalized, key: keyName })} — already taken by another application?`)
        return null
    }

    // The map keeps the hotkey so that stop() and keyUnset() can destroy it.
    const binding = { mods: normalized, key: keyName, command: name, hotkey }
    keymap.set(id, binding)
    return binding
}

/**
 * Bind several keys at once.
 *
 * @param {Array} list `[mods, key, name]` triples, each as keySet() takes them.
 */
function keysSet(list) {
    for (const [mods, key, name] of list) keySet(mods, key, name)
    return module.exports
}

/** Remove the binding on a chord. Returns whether there was one. */
function keyUnset(mods, key) {
    const id = chordId(mods, key)
    const binding = keymap.get(id)
    if (!binding) return false
    binding.hotkey.destroy()
    keymap.delete(id)
    return true
}

/**
 * Read a chord typed as words, such as "cmd ctrl alt v", for the commands-key-describe
 * command, which asks for one in a text prompt.
 *
 * @param {string} text Modifier names and the key, separated by spaces or "-", the key last.
 * @returns {{mods: string[], key: string}}
 */
function chordFromText(text) {
    const parts = String(text).trim().split(/[\s-]+/).filter(Boolean)
    if (!parts.length) throw new Error("hs_interactive-gt: no chord given")
    const key = parts.pop()
    return { mods: parts, key }
}

// MARK: - Showing a chord
//
// On screen a chord is shown as the symbols macOS uses on its key caps and in its menus, so a
// binding is displayed as "⌃⌥⌘←" rather than as the words it was written in.

// In the order macOS writes them, which is not the order a chord is usually typed in.
const MODIFIER_SYMBOLS = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" }
const MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"]

// Only keys whose name is longer than the symbol everyone knows them by. Anything else —
// "f5", "home", "tab" — reads better spelled out than abbreviated.
const KEY_SYMBOLS = {
    left: "←", right: "→", up: "↑", down: "↓",
    return: "⏎", enter: "⌤", escape: "⎋", esc: "⎋",
    delete: "⌫", forwarddelete: "⌦", space: "␣"
}

/**
 * Render a binding as the symbols macOS shows for it.
 *
 * @param {object} binding A keymap record, with `mods` and `key`.
 * @returns {string} e.g. "⌃⌥⌘←".
 */
function keyLabel(binding) {
    const symbols = modifiersNormalized(binding.mods).map((mod) => MODIFIER_SYMBOLS[mod])
    symbols.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))

    const key = String(binding.key)
    const named = KEY_SYMBOLS[key.toLowerCase()]
    return symbols.join("") + (named || (key.length === 1 ? key.toUpperCase() : key))
}

/**
 * Every binding of a command, as the symbols macOS shows for it.
 *
 * @param {string} name The command name.
 * @returns {string[]} One label per chord bound to it, empty if it has none.
 */
function keyLabels(name) {
    return keysOfCommand(name).map(keyLabel)
}

/** Every chord bound to a command name, as `{mods, key}`. */
function keysOfCommand(name) {
    return [...keymap.values()]
        .filter((b) => b.command === name)
        .map((b) => ({ mods: b.mods, key: b.key }))
}

/** What a chord runs, as `{mods, key, command, doc}`, or null. */
function keyDescribe(mods, key) {
    const binding = keymap.get(chordId(mods, key))
    if (!binding) return null
    const command = registry.get(binding.command)
    return { mods: binding.mods, key: binding.key, command: binding.command,
             doc: command ? command.doc : "(not defined)" }
}

/** All bindings, as `{mods, key, command}`, sorted by how they are shown. */
function bindings() {
    return [...keymap.values()]
        .map((b) => ({ mods: b.mods, key: b.key, command: b.command }))
        .sort((a, b) => keyLabel(a).localeCompare(keyLabel(b)))
}

// MARK: - Loading Spoons
//
// One `use()` call per Spoon, in the order they should load, following the form of Emacs's
// use-package. Each call loads one Spoon and applies its settings, commands and keys;
// there is no separate table for a loader to read. A call that fails logs the error and
// the calls after it still run.

const useRecords = []       // {name, state, ms, error}

function record(name, state, ms, error) {
    useRecords.push({ name, state, ms, error: error || null })
    return state
}

/**
 * Load and configure a Spoon.
 *
 * @param {string} name The Spoon's name, as hs.spoons.load() takes it.
 * @param {object} [spec] Any of:
 *        `disabled` — skip it, keeping the form;
 *        `when` — a predicate; the Spoon loads only if it returns true;
 *        `before` — run before loading;
 *        `config` — merged onto the Spoon's own `config` object;
 *        `after` — `(spoon)`, for wiring one Spoon to another;
 *        `commands` — `(commands, spoon)`, to define named commands;
 *        `keys` — a list of `[mods, key, command]` triples, bound through `keysSet`;
 *        `start` — pass false to skip the Spoon's `start()`.
 * @returns {object|null} The Spoon, or null if it was skipped or failed.
 */
function use(name, spec) {
    const options = spec || {}
    const started = Date.now()

    if (options.disabled) {
        record(name, "disabled", 0)
        return null
    }
    if (options.when && !options.when()) {
        record(name, "skipped", Date.now() - started)
        return null
    }

    try {
        if (options.before) options.before()

        const spoon = hs.spoons.load(name)

        if (options.config && spoon.config) Object.assign(spoon.config, options.config)
        if (options.after) options.after(spoon)
        if (options.commands) {
            // define() stamps each command defined now with this Spoon's name.
            definingSpoon = name
            try {
                options.commands(module.exports, spoon)
            } finally {
                definingSpoon = null
            }
        }
        if (options.keys) keysSet(options.keys)
        if (options.start !== false && typeof spoon.start === "function") spoon.start()

        record(name, "loaded", Date.now() - started)
        return spoon
    } catch (e) {
        record(name, "failed", Date.now() - started, e.message)
        console.error(`[hs_interactive-gt] use(${name}) failed: ${e.message}`)
        return null
    }
}

/**
 * Load a plain JavaScript file the same way, for configuration that is not a Spoon.
 *
 * @param {string} path Passed to `require()`. A path beginning with ./ or ../ is resolved from
 *        the configuration directory, hs.appinfo.configDir.
 * @param {object} [spec] `disabled`, `when` and `after` behave as in `use()`.
 * @returns {*} Whatever the file exported, or null if it was skipped or failed.
 */
use.file = function (path, spec) {
    const options = spec || {}
    const started = Date.now()

    if (options.disabled) {
        record(path, "disabled", 0)
        return null
    }
    if (options.when && !options.when()) {
        record(path, "skipped", Date.now() - started)
        return null
    }

    try {
        // A relative path is resolved from the configuration directory, where init.js is. Given
        // to require() as it is, it would be resolved from this Spoon's own init.js, which is
        // where require() is called, so "./work-only.js" written in init.js was not found
        // (found by the tests on 2026-11-23). The record keeps the path as written.
        const resolved = /^\.\.?\//.test(path) ? `${hs.appinfo.configDir}/${path.replace(/^\.\//, "")}` : path
        const contents = require(resolved)
        if (options.after) options.after(contents)
        record(path, "loaded", Date.now() - started)
        return contents
    } catch (e) {
        record(path, "failed", Date.now() - started, e.message)
        console.error(`[hs_interactive-gt] use.file(${path}) failed: ${e.message}`)
        return null
    }
}

/** What every `use()` form did, as `{name, state, ms, error}` records. */
use.status = function () {
    return useRecords.map((r) => ({ ...r }))
}

/** Log what each `use()` form did, and a one-line summary. Call at the end of init.js. */
use.report = function () {
    const counts = { loaded: 0, disabled: 0, skipped: 0, failed: 0 }
    let total = 0

    for (const r of useRecords) {
        counts[r.state] += 1
        total += r.ms
        const timing = r.state === "loaded" ? `${r.ms} ms` : ""
        console.log(`[use] ${r.name.padEnd(20)} ${r.state.padEnd(9)} ${timing}${r.error ? r.error : ""}`)
    }

    console.log(`[use] ${counts.loaded} loaded, ${counts.disabled} disabled, ` +
                `${counts.skipped} skipped, ${counts.failed} failed, in ${total} ms`)
    return counts
}

// MARK: - Spoon lifecycle

function init() {
    // init() runs on every hs.spoons.load(), so these are re-registered after a reload.
    // The file's top level runs only once, because require() caches it.
    define({
        name: "commands-execute",
        doc: "Choose a command by name and run it (M-x).",
        fn: () => execute()
    })

    define({
        name: "commands-key-describe",
        doc: "Report which command a chord runs. Type the chord as words, such as: cmd ctrl alt v",
        interactive: [{ name: "chord", reader: readers.string.prompted }],
        fn: (text) => {
            const { mods, key } = chordFromText(text)
            const found = keyDescribe(mods, key)
            const label = keyLabel({ mods, key })
            hs.ui.alert(found ? `${label} runs ${found.command}` : `${label} is not bound`)
                .duration(3).show()
        }
    })

    define({
        name: "commands-order-set",
        doc: "Choose how the command chooser orders commands.",
        interactive: [{
            name: "order",
            reader: (context) => pick({
                placeholder: "Order",
                context: context,
                choices: [
                    { text: "mru", subText: "most recently used first", value: "mru" },
                    { text: "alphabetic", subText: "by name", value: "alphabetic" }
                ]
            })
        }],
        fn: (newOrder) => {
            orderSet(newOrder)
            hs.ui.alert(`Commands ordered ${newOrder === "mru" ? "by recent use" : "by name"}`)
                .duration(2).show()
            return newOrder
        }
    })

    define({
        name: "spoons-list",
        doc: "Log what each use() form loaded, skipped or failed to load.",
        fn: () => use.report()
    })

    define({
        name: "commands-bindings-list",
        doc: "Log every key binding and the command it runs.",
        fn: () => {
            for (const b of bindings()) console.log(`[hs_interactive-gt] ${keyLabel(b)}  ${b.command}`)
            return bindings().length
        }
    })
}

/** Destroy every binding this layer owns. Commands stay defined. */
function stop() {
    for (const binding of keymap.values()) binding.hotkey.destroy()
    keymap.clear()

    // Whoever was listening is going away with this layer, and a prompt cannot survive it. A
    // notice still waiting is given now, so that no timer outlives stop().
    const pending = promptClosedTimer !== null
    if (pending) {
        promptClosedTimer.stop()
        promptClosedTimer = null
    }
    if (promptDepth > 0 || pending) {
        promptDepth = 0
        notifyPrompt(false)
    }
    promptObservers.clear()
    return module.exports
}

module.exports = {
    CANCEL,
    SKIP,
    use,
    readers,
    readerRun,
    interactiveFunctionCreate,
    describe,
    define,
    commands,
    orderSet,
    orderGet,
    get,
    call,
    callInteractively,
    execute,
    promptChangeOn,
    promptIsOpen,
    promptOpened,
    promptClosed,
    keySet,
    keysSet,
    keyUnset,
    keysOfCommand,
    keyRunning,
    commandsOfSpoon,
    keyLabel,
    keyLabels,
    keyDescribe,
    bindings,
    init,
    stop
}

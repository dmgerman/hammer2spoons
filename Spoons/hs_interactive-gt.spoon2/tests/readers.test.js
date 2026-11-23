// Tests of the readers, as the readme describes them under "Readers": the variants, the
// built-in readers, narrowing what a chooser lists, a number within a range, the snapshot,
// writing a reader, readerRun() and describe().
//
// Choosers are recorded by wrapping hs.chooser.create, so that a test can see their rows, and
// answered with keys sent only while the copy under test reports a prompt open. Dialogs are
// modal, but timers still run while one is open (measured on 2026-11-23), so a timer set before
// a dialog opens answers it. A dialog cannot be cancelled with Escape: Hammerspoon 2 issue #391.

// Records every chooser created until the test ends: {rows, placeholder}. The chooser is
// returned inside a Proxy that records setChoices() and the placeholder, and passes every call
// and assignment on to the real chooser.
function choosersCapture(t) {
    const original = hs.chooser.create
    // Taken before the replacement, so that the function is put back as it was.
    const own = Object.prototype.hasOwnProperty.call(hs.chooser, "create")
    const choosers = []
    hs.chooser.create = function () {
        const real = original.apply(hs.chooser, arguments)
        const record = { rows: [], placeholder: null }
        choosers.push(record)
        const proxy = new Proxy(real, {
            get(target, property) {
                const value = target[property]
                if (typeof value !== "function") return value
                return (...args) => {
                    if (property === "setChoices") record.rows = args[0]
                    const result = value.apply(target, args)
                    return result === target ? proxy : result
                }
            },
            set(target, property, value) {
                if (property === "placeholder") record.placeholder = value
                target[property] = value
                return true
            }
        })
        return proxy
    }
    t.cleanup(() => { if (own) hs.chooser.create = original; else delete hs.chooser.create })
    return choosers
}

// Records the message of every alert, as the fixture's alertsCapture() does.
function alerts(t) {
    return t.alertsCapture()
}

async function promptOpenWait(t) {
    const started = Date.now()
    while (!t.spoon.promptIsOpen()) {
        if (Date.now() - started > 3000) t.assert.fail("no prompt of the copy opened")
        await t.wait(0.05)
    }
    await t.wait(0.3)
}

// Sends text one character at a time, checking before each that the copy's prompt is still
// open. A chooser does not take the focus from the application behind it, so a key sent after
// it closed would reach that application: on 2026-11-23 a space typed after a chooser had
// closed scrolled a page in the user's browser.
async function promptType(t, text) {
    for (const character of text) {
        if (!t.spoon.promptIsOpen()) t.assert.fail(`the prompt closed while "${text}" was typed`)
        hs.eventtap.keyStrokes(character)
        await t.wait(0.02)
    }
}

// Presses one key, only while the copy's prompt is open.
function promptKey(t, modifiers, key) {
    if (!t.spoon.promptIsOpen()) t.assert.fail(`the prompt closed before ${key} was pressed`)
    hs.eventtap.keyStroke(modifiers, key, null)
}

// Types into the copy's open chooser and presses Return, or presses Escape when text is null.
async function chooserAnswer(t, text) {
    await promptOpenWait(t)
    if (text !== null) {
        await promptType(t, text)
        await t.wait(0.4)
    }
    promptKey(t, [], text === null ? "escape" : "return")
}

// Answers the next dialog of the copy, from a timer, because a dialog blocks until it closes.
// With text, the field's contents are replaced with it; without, the filled-in value is kept.
// Every key is sent only while the copy's prompt is open; the dialog is modal, so nothing else
// runs while the keys are sent.
function dialogAnswer(t, text) {
    const timer = hs.timer.doAfter(0.8, () => {
        const send = (modifiers, key) => { if (t.spoon.promptIsOpen()) hs.eventtap.keyStroke(modifiers, key, null) }
        if (text !== undefined) {
            send(["cmd"], "a")
            for (const character of String(text)) if (t.spoon.promptIsOpen()) hs.eventtap.keyStrokes(character)
        }
        send([], "return")
    })
    t.cleanup(() => timer.stop())
}

// Runs a reader that shows a dialog, then waits for the focus to go back to the application
// that was in front: a dialog brings Hammerspoon 2 forward and gives the focus back when it
// closes, which would close a chooser the next test opens too soon.
async function dialogRun(t, reader, parameter) {
    const value = await t.spoon.readerRun(reader, parameter || {})
    await t.wait(1)
    return value
}

// Opens a standard test window, focuses it, and returns it with a snapshot of it.
async function windowSnapshot(t) {
    const [window] = await t.windowsOpen()
    window.focus()
    await t.wait(0.5)
    return { window, snap: { window, application: window.application, screen: window.screen } }
}

const run = (t, reader, parameter, snap) => t.spoon.readerRun(reader, parameter || {}, snap)

module.exports = [
    // --- window ---
    {
        name: "window.implicit takes the snapshot's window, and gives null when it has none",
        run: async (t) => {
            const { window, snap } = await windowSnapshot(t)
            t.assert.equal((await run(t, t.spoon.readers.window.implicit, {}, snap)).id, window.id, "with a window")
            t.assert.equal(await run(t, t.spoon.readers.window.implicit, {}, { window: null, application: null, screen: null }), null, "without")
        }
    },
    {
        name: "window.auto takes the snapshot's window without showing a chooser",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            t.assert.equal((await run(t, t.spoon.readers.window.auto, {}, snap)).id, window.id)
            t.assert.equal(choosers.length, 0, "choosers shown")
        }
    },
    {
        name: "window.auto without a window names the application in an alert and shows a chooser",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const shown = alerts(t)
            const { window } = await windowSnapshot(t)
            const reading = run(t, t.spoon.readers.window.auto, {}, { window: null, application: window.application, screen: window.screen })
            await chooserAnswer(t, null)
            t.assert.equal(await reading, null, "the value after Escape")
            t.assert.equal(choosers.length, 1, "choosers shown")
            t.assert.ok(shown.includes("osascript reports no visible window"), `alerts: ${shown.join(" | ")}`)
        }
    },
    {
        name: "window.prompted lists standard windows as Application — Title, under the placeholder Window",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            const panel = await t.windowOpenBorderless(`${t.titlePrefix}panel`)
            await t.wait(2)
            const reading = run(t, t.spoon.readers.window.prompted, {}, snap)
            await chooserAnswer(t, null)
            await reading
            const texts = choosers[0].rows.map((r) => r.text)
            t.assert.ok(texts.includes(`osascript — ${window.title}`), "the standard test window is not listed")
            t.assert.ok(!texts.includes(`osascript — ${panel.title}`), "the borderless window is listed")
            t.assert.equal(choosers[0].placeholder, "Window", "the placeholder")
        }
    },
    {
        name: "window.prompted with includeNonStandard also lists windows that are not standard",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { snap } = await windowSnapshot(t)
            const panel = await t.windowOpenBorderless(`${t.titlePrefix}panel`)
            await t.wait(2)
            const reading = run(t, t.spoon.readers.window.prompted, { includeNonStandard: true }, snap)
            await chooserAnswer(t, null)
            await reading
            t.assert.ok(choosers[0].rows.some((r) => r.text === `osascript — ${panel.title}`), "the borderless window is not listed")
        }
    },
    {
        name: "window.prompted with includeCurrent false leaves out the snapshot's window",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            const reading = run(t, t.spoon.readers.window.prompted, { includeCurrent: false, placeholder: "Window to swap with" }, snap)
            await chooserAnswer(t, null)
            await reading
            t.assert.ok(!choosers[0].rows.some((r) => r.value && r.value.id === window.id), "the current window is listed")
            t.assert.equal(choosers[0].placeholder, "Window to swap with", "the placeholder option")
        }
    },
    {
        name: "window.prompted gives the window chosen by typing part of its row",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const snap = { window: first, application: first.application, screen: first.screen }
            await t.wait(1)
            const reading = run(t, t.spoon.readers.window.prompted, {}, snap)
            await chooserAnswer(t, second.title)
            t.assert.equal((await reading).id, second.id)
        }
    },
    // --- application ---
    {
        name: "application.implicit and application.auto take the snapshot's application",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            t.assert.equal((await run(t, t.spoon.readers.application.implicit, {}, snap)).pid, window.application.pid, "implicit")
            t.assert.equal((await run(t, t.spoon.readers.application.auto, {}, snap)).pid, window.application.pid, "auto")
            t.assert.equal(choosers.length, 0, "choosers shown")
        }
    },
    {
        name: "application.prompted lists the running applications and gives the one chosen",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            const reading = run(t, t.spoon.readers.application.prompted, {}, snap)
            await chooserAnswer(t, "osascript")
            const chosen = await reading
            t.assert.equal(chosen.name, "osascript", "the application chosen")
            t.assert.ok(choosers[0].rows.some((r) => r.text === "Finder"), "Finder is not listed")
            t.assert.equal(choosers[0].placeholder, "Application", "the placeholder")
        }
    },
    // --- screen ---
    {
        name: "screen.implicit and screen.auto take the snapshot's screen",
        run: async (t) => {
            const { window, snap } = await windowSnapshot(t)
            t.assert.equal((await run(t, t.spoon.readers.screen.implicit, {}, snap)).id, window.screen.id, "implicit")
            t.assert.equal((await run(t, t.spoon.readers.screen.auto, {}, snap)).id, window.screen.id, "auto")
        }
    },
    {
        name: "screen.prompted lists every screen, and includeCurrent false leaves out the snapshot's",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            let reading = run(t, t.spoon.readers.screen.prompted, {}, snap)
            await chooserAnswer(t, null)
            await reading
            t.assert.equal(choosers[0].rows.map((r) => r.text).sort().join("|"), hs.screen.all().map((s) => s.name).sort().join("|"), "every screen")
            if (hs.screen.all().length === 1) {
                const shown = alerts(t)
                t.assert.equal(await run(t, t.spoon.readers.screen.prompted, { includeCurrent: false }, snap), null, "with nothing left")
                t.assert.ok(shown.includes("No other screen to move to"), `alerts: ${shown.join(" | ")}`)
                return
            }
            reading = run(t, t.spoon.readers.screen.prompted, { includeCurrent: false }, snap)
            await chooserAnswer(t, null)
            await reading
            t.assert.ok(!choosers[1].rows.some((r) => r.value.id === window.screen.id), "the current screen is listed")
            t.assert.equal(choosers[1].rows.length, hs.screen.all().length - 1, "the other screens")
        }
    },
    {
        name: "screen.prompted with includeFullscreen false leaves out a screen showing a fullscreen window",
        timeout: 20,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const { window, snap } = await windowSnapshot(t)
            const screenId = window.screen.id
            window.toggleFullscreen()
            const started = Date.now()
            while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            await t.wait(2)
            const shown = alerts(t)
            const reading = run(t, t.spoon.readers.screen.prompted, { includeFullscreen: false }, snap)
            if (hs.screen.all().length > 1) await chooserAnswer(t, null)
            await reading
            if (hs.screen.all().length === 1) {
                t.assert.ok(shown.includes("No other screen to move to"), `alerts: ${shown.join(" | ")}`)
            } else {
                t.assert.ok(!choosers[0].rows.some((r) => r.value.id === screenId), "the screen showing the fullscreen window is listed")
            }
        }
    },
    // --- number and string ---
    {
        name: "number.prompted fills in the default, and gives it as a number when it is accepted",
        run: async (t) => {
            dialogAnswer(t)
            t.assert.equal(await dialogRun(t, t.spoon.readers.number.prompted, { name: "minutes", default: 25 }), 25)
        }
    },
    {
        name: "number.prompted gives a number typed into the dialog",
        run: async (t) => {
            dialogAnswer(t, "42.5")
            t.assert.equal(await dialogRun(t, t.spoon.readers.number.prompted, { name: "minutes", default: 25 }), 42.5)
        }
    },
    {
        name: "number.prompted reports text that is not a number in an alert, and cancels",
        run: async (t) => {
            const shown = alerts(t)
            dialogAnswer(t, "abc")
            t.assert.equal(await dialogRun(t, t.spoon.readers.number.prompted, { name: "minutes", default: 25 }), null, "the value")
            t.assert.ok(shown.includes('minutes: "abc" is not a number'), `alerts: ${shown.join(" | ")}`)
        }
    },
    {
        name: "number.ranged reports a value outside the range in an alert, and cancels without clamping it",
        run: async (t) => {
            const shown = alerts(t)
            dialogAnswer(t, "150")
            const reader = t.spoon.readers.number.ranged({ min: 0, max: 100 })
            t.assert.equal(await dialogRun(t, reader, { name: "volume (0-100)" }), null, "the value")
            t.assert.ok(shown.includes("volume (0-100): 150 is outside 0 to 100"), `alerts: ${shown.join(" | ")}`)
        }
    },
    {
        name: "number.ranged fills in what current() returns",
        run: async (t) => {
            dialogAnswer(t)
            const reader = t.spoon.readers.number.ranged({ min: 0, max: 100, current: () => 37 })
            t.assert.equal(await dialogRun(t, reader, { name: "volume", default: 50 }), 37)
        }
    },
    {
        name: "number.ranged fills in the default when current() returns null or throws",
        run: async (t) => {
            dialogAnswer(t)
            const empty = t.spoon.readers.number.ranged({ current: () => null })
            t.assert.equal(await dialogRun(t, empty, { name: "volume", default: 50 }), 50, "current() returned null")
            dialogAnswer(t)
            const throwing = t.spoon.readers.number.ranged({ current: () => { throw new Error("no device") } })
            t.assert.equal(await dialogRun(t, throwing, { name: "volume", default: 60 }), 60, "current() threw")
        }
    },
    {
        name: "string.prompted gives the text typed, and fills in the default",
        run: async (t) => {
            dialogAnswer(t, "typed text")
            t.assert.equal(await dialogRun(t, t.spoon.readers.string.prompted, { name: "text" }), "typed text", "typed")
            dialogAnswer(t)
            t.assert.equal(await dialogRun(t, t.spoon.readers.string.prompted, { name: "text", default: "the default" }), "the default", "the default")
        }
    },
    // --- choice ---
    {
        name: "choice.prompted lists the rows given and gives the chosen row's value",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const choices = [{ text: "first zq", value: 1 }, { text: "second zq", subText: "the other", value: 2 }]
            const reading = run(t, t.spoon.readers.choice.prompted, { choices, placeholder: "Pick one" })
            await chooserAnswer(t, "second zq")
            t.assert.equal(await reading, 2, "the value")
            t.assert.equal(choosers[0].rows.length, 2, "the rows")
            t.assert.equal(choosers[0].placeholder, "Pick one", "the placeholder")
        }
    },
    {
        name: "choice.prompted calls a choices function with the snapshot",
        run: async (t) => {
            let received = null
            const snap = { window: null, application: null, screen: hs.screen.primary() }
            const reading = run(t, t.spoon.readers.choice.prompted, {
                choices: (s) => { received = s; return [{ text: "only zq", value: "only" }] }
            }, snap)
            await chooserAnswer(t, "only zq")
            t.assert.equal(await reading, "only", "the value")
            t.assert.equal(received, snap, "the argument of choices")
        }
    },
    {
        name: "choice.prompted with nothing to choose shows the empty alert and cancels",
        run: async (t) => {
            const shown = alerts(t)
            t.assert.equal(await run(t, t.spoon.readers.choice.prompted, { choices: [] }), null, "without empty")
            t.assert.equal(await run(t, t.spoon.readers.choice.prompted, { choices: [], empty: "No album" }), null, "with empty")
            t.assert.equal(shown.join(" | "), "Nothing to choose | No album", "alerts")
        }
    },
    {
        name: "an optional argument's chooser offers a skip row, which gives the default",
        run: async (t) => {
            const choosers = choosersCapture(t)
            let received = null
            t.spoon.define({
                name: "test-reader-optional",
                interactive: [{ name: "a", reader: t.spoon.readers.choice.prompted, optional: true, default: "the default",
                    choices: [{ text: "first zq", value: 1 }] }],
                fn: (a) => { received = a }
            })
            const calling = t.spoon.callInteractively("test-reader-optional")
            await chooserAnswer(t, "skip")
            await calling
            t.assert.ok(choosers[0].rows[0].text.includes("skip"), `the first row: ${choosers[0].rows[0].text}`)
            t.assert.equal(received, "the default", "the argument")
        }
    },
    // --- readerRun, the snapshot and writing a reader ---
    {
        name: "readerRun() throws for something that is not a reader variant",
        run: (t) => {
            let error = null
            try { t.spoon.readerRun(t.spoon.readers.window, {}) } catch (e) { error = e }
            t.assert.ok(error instanceof Error)
        }
    },
    {
        name: "readerRun() without a snapshot takes one when it is called",
        run: async (t) => {
            const { window } = await windowSnapshot(t)
            t.assert.equal((await t.spoon.readerRun(t.spoon.readers.window.implicit)).id, window.id)
        }
    },
    {
        name: "a command chosen in the command chooser reads the window that was focused before it",
        timeout: 15,
        run: async (t) => {
            const { window } = await windowSnapshot(t)
            let received = null
            t.spoon.define({
                name: "test-reader-snapshot-zq",
                interactive: [{ name: "window", reader: t.spoon.readers.window.implicit }],
                fn: (w) => { received = w }
            })
            t.spoon.execute()
            await chooserAnswer(t, "test-reader-snapshot-zq")
            const started = Date.now()
            while (received === null && Date.now() - started < 3000) await t.wait(0.05)
            t.assert.ok(received, "the command did not run")
            t.assert.equal(received.id, window.id, "the window read")
        }
    },
    {
        name: "a reader written on choice.prompted is reported by promptIsOpen() while it is open",
        run: async (t) => {
            const interactive = t.spoon
            const readSpoonName = {
                prompted: (context, parameter, snapshot) => interactive.readers.choice.prompted(context,
                    Object.assign({ placeholder: "Spoon", choices: Object.keys(hs.spoons).map((name) => ({ text: name, value: name })) }, parameter),
                    snapshot)
            }
            const reading = run(t, readSpoonName.prompted, {})
            await promptOpenWait(t)
            t.assert.equal(interactive.promptIsOpen(), true, "promptIsOpen() while open")
            await chooserAnswer(t, "hs_window-gt")
            t.assert.equal(await reading, "hs_window-gt", "the value")
            t.assert.equal(interactive.promptIsOpen(), false, "promptIsOpen() after")
        }
    },
    // --- describe ---
    {
        name: "describe() shows a window, a screen, an application and plain values as the readme says",
        run: async (t) => {
            const { window } = await windowSnapshot(t)
            const d = t.spoon.describe
            t.assert.equal(d(window), `${window.title} — osascript`, "a window")
            const s = window.screen
            t.assert.equal(d(s), `${s.name} (${s.frame.w}×${s.frame.h})`, "a screen")
            t.assert.equal(d(window.application), "osascript", "an application")
            t.assert.equal(d("text"), '"text"', "a string")
            t.assert.equal(d(3), "3", "a number")
            t.assert.equal(d({ a: 1 }), '{"a":1}', "an object")
            const rect = new HSRect(1, 2, 3, 4)
            t.assert.ok(!d(rect).startsWith("<"), `another Hammerspoon object: ${d(rect)}`)
        }
    }
]

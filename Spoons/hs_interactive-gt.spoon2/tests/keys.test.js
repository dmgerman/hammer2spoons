// Tests of the key bindings and of the built-in commands, as the readme describes them under
// "Key bindings" and "Built-in commands".
//
// The keys are bound in the copy under test with ctrl-alt-shift and the digits 7, 8 and 9, which
// the user's configuration does not bind. A key is pressed only after keyDescribe() has
// confirmed the copy bound it, so that the hotkey takes the press and no application receives
// it. Every binding a test makes is removed when it ends.

// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const MODIFIERS = ["ctrl", "alt", "shift"]

function consoleCapture(t) {
    const original = { error: console.error, log: console.log }
    const written = { error: [], log: [] }
    console.error = (...args) => { written.error.push(args.join(" ")); original.error.apply(console, args) }
    console.log = (...args) => { written.log.push(args.join(" ")); original.log.apply(console, args) }
    t.cleanup(() => { console.error = original.error; console.log = original.log })
    return written
}

// Unbinds the test keys when the test ends.
function keysRelease(t) {
    t.cleanup(() => { for (const key of ["f17", "f18", "f19"]) t.spoon.keyUnset(MODIFIERS, key) })
}

// Presses a test key, after checking that the copy has bound it.
async function keyPress(t, key) {
    if (!t.spoon.keyDescribe(MODIFIERS, key)) t.assert.fail(`not pressing ${key}: the copy has not bound it`)
    hs.eventtap.keyStroke(withFn(MODIFIERS, key), key, null)
    await t.wait(0.4)
}

async function promptOpenWait(t) {
    const started = Date.now()
    while (!t.spoon.promptIsOpen()) {
        if (Date.now() - started > 3000) t.assert.fail("no prompt of the copy opened")
        await t.wait(0.05)
    }
    await t.wait(0.3)
}

// Types into the copy's open chooser one character at a time, checking it before each key.
async function chooserAnswer(t, text) {
    await promptOpenWait(t)
    for (const character of text) {
        if (!t.spoon.promptIsOpen()) t.assert.fail(`the chooser closed while "${text}" was typed`)
        hs.eventtap.keyStrokes(character)
        await t.wait(0.02)
    }
    await t.wait(0.4)
    if (!t.spoon.promptIsOpen()) t.assert.fail("the chooser closed before Return")
    hs.eventtap.keyStroke([], text === "" ? "escape" : "return", null)
}

// Answers the copy's next dialog from a timer, replacing its text, one character at a time.
function dialogAnswer(t, text) {
    const timer = hs.timer.doAfter(0.8, () => {
        const open = () => t.spoon.promptIsOpen()
        if (!open()) return
        hs.eventtap.keyStroke(["cmd"], "a", null)
        for (const character of text) if (open()) hs.eventtap.keyStrokes(character)
        if (open()) hs.eventtap.keyStroke([], "return", null)
    })
    t.cleanup(() => timer.stop())
}

module.exports = [
    {
        name: "keyRunning() gives the key that started the running command, and null when it was run by name or after it returned",
        run: async (t) => {
            keysRelease(t)
            const seen = []
            t.spoon.define({ name: "test-keys-running", fn: () => { seen.push(t.spoon.keyRunning()) } })
            t.spoon.keySet(MODIFIERS, "f18", "test-keys-running")
            await keyPress(t, "f18")
            t.assert.equal(seen.length, 1, "the command ran from its key")
            const key = seen[0]
            t.assert.ok(key && key.key === "f18" && [...key.mods].sort().join(",") === "alt,ctrl,shift", `keyRunning() while it ran: ${JSON.stringify(key)}`)
            t.assert.equal(t.spoon.keyRunning(), null, "keyRunning() after it returned")
            await t.spoon.callInteractively("test-keys-running")
            t.assert.equal(seen[1], null, "keyRunning() when run by name")
        }
    },
    {
        name: "a key bound before its command is defined runs the command once it is defined",
        run: async (t) => {
            keysRelease(t)
            let ran = 0
            t.spoon.keySet(MODIFIERS, "f19", "test-keys-later")
            t.spoon.define({ name: "test-keys-later", fn: () => { ran++ } })
            await keyPress(t, "f19")
            t.assert.equal(ran, 1)
        }
    },
    {
        name: "a command redefined runs in its new form from its key, which is not bound again",
        run: async (t) => {
            keysRelease(t)
            let which = null
            t.spoon.define({ name: "test-keys-redefined", fn: () => { which = "first" } })
            t.spoon.keySet(MODIFIERS, "f19", "test-keys-redefined")
            t.spoon.define({ name: "test-keys-redefined", fn: () => { which = "second" } })
            await keyPress(t, "f19")
            t.assert.equal(which, "second")
        }
    },
    {
        name: "keysSet() binds each key of its list, adds to earlier calls, and replaces a key it names",
        run: (t) => {
            keysRelease(t)
            t.assert.equal(t.spoon.keysSet([[MODIFIERS, "f17", "test-keys-a"], [MODIFIERS, "f18", "test-keys-b"]]), t.spoon, "returned")
            t.spoon.keysSet([[MODIFIERS, "f19", "test-keys-c"], [MODIFIERS, "f17", "test-keys-c"]])
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "f17").command, "test-keys-c", "f17, replaced")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "f18").command, "test-keys-b", "f18, kept")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "f19").command, "test-keys-c", "f19, added")
        }
    },
    {
        name: "the modifiers' aliases and symbols bind the same key",
        run: (t) => {
            keysRelease(t)
            t.spoon.keySet(["control", "option", "shift"], "f17", "test-keys-aliases")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "f17").command, "test-keys-aliases", "control and option")
            t.spoon.keySet(["⌃", "⌥", "⇧"], "f18", "test-keys-symbols")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "f18").command, "test-keys-symbols", "the symbols")
            t.assert.equal(t.spoon.keyUnset(["⌃", "option", "shift"], "f17"), true, "keyUnset with mixed names")
        }
    },
    {
        name: "an unknown modifier or key throws an Error that names it",
        run: (t) => {
            keysRelease(t)
            let modifier = null, key = null, character = null
            try { t.spoon.keySet(["hyperish"], "f19", "test-keys-x") } catch (e) { modifier = e }
            try { t.spoon.keySet(MODIFIERS, "notakey", "test-keys-x") } catch (e) { key = e }
            try { t.spoon.keySet(MODIFIERS, "§§", "test-keys-x") } catch (e) { character = e }
            t.assert.ok(modifier instanceof Error && modifier.message.includes("hyperish"), `the modifier: ${modifier && modifier.message}`)
            t.assert.ok(key instanceof Error && key.message.includes("notakey"), `the key: ${key && key.message}`)
            t.assert.ok(character instanceof Error && character.message.includes("§§"), `two characters: ${character && character.message}`)
        }
    },
    {
        name: "a key pressed when no command of its name is defined logs an error",
        run: async (t) => {
            keysRelease(t)
            const written = consoleCapture(t)
            t.spoon.keySet(MODIFIERS, "f19", "test-keys-never-defined")
            await keyPress(t, "f19")
            t.assert.ok(written.error.some((e) => e.includes("test-keys-never-defined")), `errors: ${written.error.join(" | ") || "none"}`)
        }
    },
    {
        name: "keySet() returns the binding, and keyUnset() removes it and says whether there was one",
        run: async (t) => {
            keysRelease(t)
            let ran = 0
            t.spoon.define({ name: "test-keys-unset", fn: () => { ran++ } })
            const binding = t.spoon.keySet(MODIFIERS, "f19", "test-keys-unset")
            t.assert.equal(binding.command, "test-keys-unset", "the binding's command")
            t.assert.equal(t.spoon.keyUnset(MODIFIERS, "f19"), true, "the first keyUnset")
            t.assert.equal(t.spoon.keyUnset(MODIFIERS, "f19"), false, "a second keyUnset")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "f19"), null, "keyDescribe after keyUnset")
            t.assert.equal(ran, 0, "the command ran")
        }
    },
    {
        name: "keysOfCommand(), keyLabels(), keyLabel(), keyDescribe() and bindings() report the keys",
        run: (t) => {
            keysRelease(t)
            t.spoon.define({ name: "test-keys-report", doc: "a test command", fn: () => {} })
            t.spoon.keysSet([[MODIFIERS, "f18", "test-keys-report"], [["shift", "alt", "ctrl"], "f19", "test-keys-report"]])
            const keys = t.spoon.keysOfCommand("test-keys-report").map((k) => k.key).sort()
            t.assert.equal(keys.join(","), "f18,f19", "keysOfCommand")
            t.assert.equal(t.spoon.keyLabels("test-keys-report").sort().join(","), "⌃⌥⇧f18,⌃⌥⇧f19", "keyLabels")
            t.assert.equal(t.spoon.keyLabel({ mods: ["cmd", "ctrl", "alt"], key: "left" }), "⌃⌥⌘←", "keyLabel")
            const described = t.spoon.keyDescribe(MODIFIERS, "f18")
            t.assert.equal(described.command, "test-keys-report", "keyDescribe's command")
            t.assert.equal(described.doc, "a test command", "keyDescribe's doc")
            t.assert.ok(t.spoon.bindings().some((b) => b.key === "f19" && b.command === "test-keys-report"), "bindings()")
        }
    },
    {
        name: "the five built-in commands are defined",
        run: (t) => {
            for (const name of ["commands-execute", "commands-order-set", "commands-key-describe", "commands-bindings-list", "spoons-list"]) {
                t.assert.ok(t.spoon.get(name), `${name} is not defined`)
            }
        }
    },
    {
        name: "commands-execute shows the command chooser",
        run: async (t) => {
            const calling = t.spoon.callInteractively("commands-execute")
            await promptOpenWait(t)
            t.assert.equal(t.spoon.promptIsOpen(), true, "the chooser is open")
            // A second Escape is sent when the chooser is still open after the first: on the
            // machine these tests were written on, ~/Library/KeyBindings/DefaultKeyBinding.dict
            // binds Escape as a prefix key, and after the keyRunning() test the first Escape did
            // not close this chooser (hammer2spoons-ei6.74). The fixture's promptCancel() cannot
            // be used, because it asks the user's hs_interactive-gt, which does not see the copy's
            // chooser. The chooser is not modal, so the test can wait between the two.
            for (let attempt = 0; attempt < 2 && t.spoon.promptIsOpen(); attempt++) {
                hs.eventtap.keyStroke([], "escape", null)
                await t.wait(0.5)
            }
            await calling
            await t.wait(0.4)
            t.assert.equal(t.spoon.promptIsOpen(), false, "the chooser is still open")
        }
    },
    {
        name: "commands-order-set sets the order chosen in its chooser",
        run: async (t) => {
            const before = t.spoon.orderGet()
            t.cleanup(() => t.spoon.orderSet(before))
            const shown = t.alertsCapture()
            const calling = t.spoon.callInteractively("commands-order-set")
            await chooserAnswer(t, "alphabetic")
            await calling
            t.assert.equal(t.spoon.orderGet(), "alphabetic", "the order")
            t.assert.ok(shown.some((a) => a.includes("by name")), `alerts: ${shown.join(" | ")}`)
        }
    },
    {
        name: "commands-key-describe shows the command bound to a key typed as words",
        run: async (t) => {
            keysRelease(t)
            t.spoon.define({ name: "test-keys-described", fn: () => {} })
            t.spoon.keySet(MODIFIERS, "f19", "test-keys-described")
            const shown = t.alertsCapture()
            dialogAnswer(t, "ctrl alt shift f19")
            await t.spoon.callInteractively("commands-key-describe")
            await t.wait(1)
            t.assert.ok(shown.includes("⌃⌥⇧f19 runs test-keys-described"), `alerts: ${shown.join(" | ")}`)
            dialogAnswer(t, "ctrl alt shift f18")
            await t.spoon.callInteractively("commands-key-describe")
            await t.wait(1)
            t.assert.ok(shown.includes("⌃⌥⇧f18 is not bound"), `alerts: ${shown.join(" | ")}`)
        }
    },
    {
        name: "commands-bindings-list logs every binding and returns their number",
        run: (t) => {
            keysRelease(t)
            t.spoon.keySet(MODIFIERS, "f19", "test-keys-listed")
            const written = consoleCapture(t)
            const count = t.spoon.call("commands-bindings-list")
            t.assert.equal(count, t.spoon.bindings().length, "the number returned")
            t.assert.ok(written.log.some((l) => l.includes("⌃⌥⇧f19") && l.includes("test-keys-listed")), `log: ${written.log.join(" | ")}`)
        }
    },
    {
        name: "spoons-list logs the outcome of every use() call",
        run: (t) => {
            const written = consoleCapture(t)
            const counts = t.spoon.call("spoons-list")
            t.assert.ok(counts && typeof counts.loaded === "number", "no counts were returned")
            t.assert.ok(written.log.some((l) => /\d+ loaded, \d+ disabled/.test(l)), `log: ${written.log.join(" | ")}`)
        }
    },
    {
        name: "stop() removes every binding, and the commands stay defined",
        run: (t) => {
            t.spoon.define({ name: "test-keys-stop", fn: () => {} })
            t.spoon.keySet(MODIFIERS, "f19", "test-keys-stop")
            t.spoon.stop()
            t.assert.equal(t.spoon.bindings().length, 0, "bindings after stop()")
            t.assert.ok(t.spoon.get("test-keys-stop"), "the command is no longer defined")
        }
    }
]

// Tests of the key bindings and of the built-in commands, as the readme describes them under
// "Key bindings" and "Built-in commands".
//
// The keys are bound in the copy under test with ctrl-alt-shift and the digits 7, 8 and 9, which
// the user's configuration does not bind. A key is pressed only after keyDescribe() has
// confirmed the copy bound it, so that the hotkey takes the press and no application receives
// it. Every binding a test makes is removed when it ends.

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
    t.cleanup(() => { for (const key of ["7", "8", "9"]) t.spoon.keyUnset(MODIFIERS, key) })
}

// Presses a test key, after checking that the copy has bound it.
async function keyPress(t, key) {
    if (!t.spoon.keyDescribe(MODIFIERS, key)) t.assert.fail(`not pressing ${key}: the copy has not bound it`)
    hs.eventtap.keyStroke(MODIFIERS, key, null)
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
            t.spoon.keySet(MODIFIERS, "8", "test-keys-running")
            await keyPress(t, "8")
            t.assert.equal(seen.length, 1, "the command ran from its key")
            const key = seen[0]
            t.assert.ok(key && key.key === "8" && [...key.mods].sort().join(",") === "alt,ctrl,shift", `keyRunning() while it ran: ${JSON.stringify(key)}`)
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
            t.spoon.keySet(MODIFIERS, "9", "test-keys-later")
            t.spoon.define({ name: "test-keys-later", fn: () => { ran++ } })
            await keyPress(t, "9")
            t.assert.equal(ran, 1)
        }
    },
    {
        name: "a command redefined runs in its new form from its key, which is not bound again",
        run: async (t) => {
            keysRelease(t)
            let which = null
            t.spoon.define({ name: "test-keys-redefined", fn: () => { which = "first" } })
            t.spoon.keySet(MODIFIERS, "9", "test-keys-redefined")
            t.spoon.define({ name: "test-keys-redefined", fn: () => { which = "second" } })
            await keyPress(t, "9")
            t.assert.equal(which, "second")
        }
    },
    {
        name: "keysSet() binds each key of its list, adds to earlier calls, and replaces a key it names",
        run: (t) => {
            keysRelease(t)
            t.assert.equal(t.spoon.keysSet([[MODIFIERS, "7", "test-keys-a"], [MODIFIERS, "8", "test-keys-b"]]), t.spoon, "returned")
            t.spoon.keysSet([[MODIFIERS, "9", "test-keys-c"], [MODIFIERS, "7", "test-keys-c"]])
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "7").command, "test-keys-c", "7, replaced")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "8").command, "test-keys-b", "8, kept")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "9").command, "test-keys-c", "9, added")
        }
    },
    {
        name: "the modifiers' aliases and symbols bind the same key",
        run: (t) => {
            keysRelease(t)
            t.spoon.keySet(["control", "option", "shift"], "7", "test-keys-aliases")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "7").command, "test-keys-aliases", "control and option")
            t.spoon.keySet(["⌃", "⌥", "⇧"], "8", "test-keys-symbols")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "8").command, "test-keys-symbols", "the symbols")
            t.assert.equal(t.spoon.keyUnset(["⌃", "option", "shift"], "7"), true, "keyUnset with mixed names")
        }
    },
    {
        name: "an unknown modifier or key throws an Error that names it",
        run: (t) => {
            keysRelease(t)
            let modifier = null, key = null, character = null
            try { t.spoon.keySet(["hyperish"], "9", "test-keys-x") } catch (e) { modifier = e }
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
            t.spoon.keySet(MODIFIERS, "9", "test-keys-never-defined")
            await keyPress(t, "9")
            t.assert.ok(written.error.some((e) => e.includes("test-keys-never-defined")), `errors: ${written.error.join(" | ") || "none"}`)
        }
    },
    {
        name: "keySet() returns the binding, and keyUnset() removes it and says whether there was one",
        run: async (t) => {
            keysRelease(t)
            let ran = 0
            t.spoon.define({ name: "test-keys-unset", fn: () => { ran++ } })
            const binding = t.spoon.keySet(MODIFIERS, "9", "test-keys-unset")
            t.assert.equal(binding.command, "test-keys-unset", "the binding's command")
            t.assert.equal(t.spoon.keyUnset(MODIFIERS, "9"), true, "the first keyUnset")
            t.assert.equal(t.spoon.keyUnset(MODIFIERS, "9"), false, "a second keyUnset")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "9"), null, "keyDescribe after keyUnset")
            t.assert.equal(ran, 0, "the command ran")
        }
    },
    {
        name: "keysOfCommand(), keyLabels(), keyLabel(), keyDescribe() and bindings() report the keys",
        run: (t) => {
            keysRelease(t)
            t.spoon.define({ name: "test-keys-report", doc: "a test command", fn: () => {} })
            t.spoon.keysSet([[MODIFIERS, "8", "test-keys-report"], [["shift", "alt", "ctrl"], "9", "test-keys-report"]])
            const keys = t.spoon.keysOfCommand("test-keys-report").map((k) => k.key).sort()
            t.assert.equal(keys.join(","), "8,9", "keysOfCommand")
            t.assert.equal(t.spoon.keyLabels("test-keys-report").sort().join(","), "⌃⌥⇧8,⌃⌥⇧9", "keyLabels")
            t.assert.equal(t.spoon.keyLabel({ mods: ["cmd", "ctrl", "alt"], key: "left" }), "⌃⌥⌘←", "keyLabel")
            const described = t.spoon.keyDescribe(MODIFIERS, "8")
            t.assert.equal(described.command, "test-keys-report", "keyDescribe's command")
            t.assert.equal(described.doc, "a test command", "keyDescribe's doc")
            t.assert.ok(t.spoon.bindings().some((b) => b.key === "9" && b.command === "test-keys-report"), "bindings()")
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
            hs.eventtap.keyStroke([], "escape", null)
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
            t.spoon.keySet(MODIFIERS, "9", "test-keys-described")
            const shown = t.alertsCapture()
            dialogAnswer(t, "ctrl alt shift 9")
            await t.spoon.callInteractively("commands-key-describe")
            await t.wait(1)
            t.assert.ok(shown.includes("⌃⌥⇧9 runs test-keys-described"), `alerts: ${shown.join(" | ")}`)
            dialogAnswer(t, "ctrl alt shift 8")
            await t.spoon.callInteractively("commands-key-describe")
            await t.wait(1)
            t.assert.ok(shown.includes("⌃⌥⇧8 is not bound"), `alerts: ${shown.join(" | ")}`)
        }
    },
    {
        name: "commands-bindings-list logs every binding and returns their number",
        run: (t) => {
            keysRelease(t)
            t.spoon.keySet(MODIFIERS, "9", "test-keys-listed")
            const written = consoleCapture(t)
            const count = t.spoon.call("commands-bindings-list")
            t.assert.equal(count, t.spoon.bindings().length, "the number returned")
            t.assert.ok(written.log.some((l) => l.includes("⌃⌥⇧9") && l.includes("test-keys-listed")), `log: ${written.log.join(" | ")}`)
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
            t.spoon.keySet(MODIFIERS, "9", "test-keys-stop")
            t.spoon.stop()
            t.assert.equal(t.spoon.bindings().length, 0, "bindings after stop()")
            t.assert.ok(t.spoon.get("test-keys-stop"), "the command is no longer defined")
        }
    }
]

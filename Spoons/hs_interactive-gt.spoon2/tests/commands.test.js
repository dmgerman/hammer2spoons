// Tests of defining, naming and calling commands, and of the command order, as the readme
// describes them under "Defining commands", "Calling commands" and "Command order". The
// commands are defined in the copy under test, whose registry is its own.

// Records console.error and console.log until the test ends.
// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

function consoleCapture(t) {
    const original = { error: console.error, log: console.log }
    const written = { error: [], log: [] }
    console.error = (...args) => { written.error.push(args.join(" ")); original.error.apply(console, args) }
    console.log = (...args) => { written.log.push(args.join(" ")); original.log.apply(console, args) }
    t.cleanup(() => { console.error = original.error; console.log = original.log })
    return written
}

// A name no other test uses.
let defined = 0
function nameNew(prefix = "test-command") {
    return `${prefix}-${++defined}`
}

// A command that records each call's arguments.
function commandRecorded(t, spec) {
    const calls = []
    const name = (spec && spec.name) || nameNew()
    const command = t.spoon.define(Object.assign({ name, fn: (...args) => { calls.push(args); return `ran ${name}` } }, spec || {}))
    return { name, command, calls }
}

// Waits until the copy's own prompt state says a prompt is open.
async function promptOpenWait(t) {
    const started = Date.now()
    while (!t.spoon.promptIsOpen()) {
        if (Date.now() - started > 3000) t.assert.fail("no prompt opened")
        await t.wait(0.05)
    }
    await t.wait(0.3)
}

// Sends keys to the copy's chooser, only while the copy reports it open, so that they never
// reach one of the user's windows.
// One character at a time, checking before each: a chooser does not take the focus from the
// application behind it, so a key sent after it closed would reach that application.
async function chooserType(t, text) {
    for (const character of text) {
        if (!t.spoon.promptIsOpen()) t.assert.fail(`not typing "${text}": no chooser of the copy is open`)
        hs.eventtap.keyStrokes(character)
        await t.wait(0.02)
    }
}
function chooserKey(t, key) {
    if (!t.spoon.promptIsOpen()) t.assert.fail(`not sending ${key}: no chooser of the copy is open`)
    hs.eventtap.keyStroke(withFn([], key), key, null)
}

module.exports = [
    {
        name: "define() stores a command and returns it, and get() gives it back",
        run: (t) => {
            const name = nameNew()
            const fn = () => 1
            const command = t.spoon.define({ name, doc: "a test command", fn })
            t.assert.equal(command.name, name, "the returned command's name")
            t.assert.equal(command.doc, "a test command", "its doc")
            t.assert.equal(t.spoon.get(name), command, "get() returned")
        }
    },
    {
        name: "get() returns undefined for a name no command has",
        run: (t) => t.assert.equal(t.spoon.get("no-such-command"), undefined)
    },
    {
        name: "define() throws an Error when the name or fn is missing",
        run: (t) => {
            let noName = null, noFn = null
            try { t.spoon.define({ fn: () => 1 }) } catch (e) { noName = e }
            try { t.spoon.define({ name: nameNew() }) } catch (e) { noFn = e }
            t.assert.ok(noName instanceof Error, "no Error without a name")
            t.assert.ok(noFn instanceof Error, "no Error without an fn")
        }
    },
    {
        name: "defining a command with an existing name replaces it",
        run: (t) => {
            const name = nameNew()
            t.spoon.define({ name, fn: () => "first" })
            t.spoon.define({ name, fn: () => "second" })
            t.assert.equal(t.spoon.call(name), "second")
        }
    },
    {
        name: "a command's name can be any string",
        run: (t) => {
            const name = "Any string, with spaces and ünïcödé ✓"
            t.spoon.define({ name, fn: () => "ran" })
            t.assert.equal(t.spoon.call(name), "ran")
        }
    },
    {
        name: "call() runs a command with the arguments given, and returns what fn returns",
        run: (t) => {
            const { name, calls } = commandRecorded(t)
            t.assert.equal(t.spoon.call(name, 1, "two"), `ran ${name}`, "the result")
            t.assert.equal(JSON.stringify(calls), '[[1,"two"]]', "the arguments")
        }
    },
    {
        name: "call() throws an Error for a name no command has",
        run: (t) => {
            let error = null
            try { t.spoon.call("no-such-command") } catch (e) { error = e }
            t.assert.ok(error instanceof Error)
        }
    },
    {
        name: "callInteractively() with every argument given reads nothing and resolves to fn's result",
        run: async (t) => {
            let read = 0
            const { name, calls } = commandRecorded(t, {
                interactive: [{ name: "a", reader: () => { read++; return "read" } }]
            })
            const result = await t.spoon.callInteractively(name, { args: ["given"] })
            t.assert.equal(result, `ran ${name}`, "the result")
            t.assert.equal(read, 0, "the reader was called")
            t.assert.equal(JSON.stringify(calls), '[["given"]]', "the arguments")
        }
    },
    {
        name: "callInteractively() reads each missing argument with its reader, in order",
        run: async (t) => {
            const { name, calls } = commandRecorded(t, {
                interactive: [{ name: "a", reader: () => "first" }, { name: "b", reader: () => "second" }]
            })
            await t.spoon.callInteractively(name, { args: [undefined, undefined] })
            t.assert.equal(JSON.stringify(calls), '[["first","second"]]')
        }
    },
    {
        name: "callInteractively() reads only the arguments not given",
        run: async (t) => {
            const { name, calls } = commandRecorded(t, {
                interactive: [{ name: "a", reader: () => "read a" }, { name: "b", reader: () => "read b" }]
            })
            await t.spoon.callInteractively(name, { args: ["given a"] })
            t.assert.equal(JSON.stringify(calls), '[["given a","read b"]]')
        }
    },
    {
        name: "an argument's default is used when its reader finds none or is skipped",
        run: async (t) => {
            const { name, calls } = commandRecorded(t, {
                interactive: [
                    { name: "none", reader: () => null, default: "default one" },
                    { name: "skipped", reader: () => t.spoon.SKIP, default: "default two" }
                ]
            })
            await t.spoon.callInteractively(name)
            t.assert.equal(JSON.stringify(calls), '[["default one","default two"]]')
        }
    },
    {
        name: "an entry without a name is named argN",
        run: async (t) => {
            const contexts = []
            const { name } = commandRecorded(t, {
                interactive: [{ reader: (context, parameter) => { contexts.push(parameter.name); return 1 } }]
            })
            await t.spoon.callInteractively(name)
            t.assert.equal(contexts.join(","), "arg1")
        }
    },
    {
        name: "an entry that is a bare function is used as the reader of an argument named argN",
        run: async (t) => {
            const written = consoleCapture(t)
            const { name, calls } = commandRecorded(t, { interactive: [() => "from a bare function"] })
            await t.spoon.callInteractively(name)
            t.assert.equal(t.spoon.get(name).parameters[0].name, "arg1", "the argument's name")
            t.assert.equal(JSON.stringify(calls), '[["from a bare function"]]',
                `the arguments; errors: ${written.error.join(" | ") || "none"}`)
        }
    },
    {
        name: "a reader object given in place of a variant logs an error naming the argument, and the command does not run",
        run: async (t) => {
            const written = consoleCapture(t)
            const { name, calls } = commandRecorded(t, { interactive: [{ name: "minutes", reader: t.spoon.readers.number }] })
            const result = await t.spoon.callInteractively(name)
            t.assert.equal(result, undefined, "the result")
            t.assert.equal(calls.length, 0, "fn was called")
            t.assert.ok(written.error.some((e) => e.includes("minutes")), `errors: ${written.error.join(" | ") || "none"}`)
        }
    },
    {
        name: "cancelling a reader cancels the command: fn is not called, and the result is undefined",
        run: async (t) => {
            const { name, calls } = commandRecorded(t, {
                interactive: [{ name: "a", reader: () => t.spoon.CANCEL }, { name: "b", reader: () => "b" }]
            })
            const result = await t.spoon.callInteractively(name)
            t.assert.equal(result, undefined, "the result")
            t.assert.equal(calls.length, 0, "fn was called")
        }
    },
    {
        name: "callInteractively() for a name no command has resolves to undefined",
        run: async (t) => {
            consoleCapture(t)
            t.assert.equal(await t.spoon.callInteractively("no-such-command"), undefined)
        }
    },
    {
        name: "orderSet() and orderGet() set and read the order, and any other value throws",
        run: (t) => {
            const before = t.spoon.orderGet()
            t.cleanup(() => t.spoon.orderSet(before))
            t.assert.equal(before, "mru", "the default order")
            t.spoon.orderSet("alphabetic")
            t.assert.equal(t.spoon.orderGet(), "alphabetic", "after orderSet")
            let error = null
            try { t.spoon.orderSet("random") } catch (e) { error = e }
            t.assert.ok(error instanceof Error, "no Error for another value")
        }
    },
    {
        name: "in mru order, commands run by name come first, most recent first, then the others by name",
        run: async (t) => {
            const a = commandRecorded(t, { name: "test-order-a" })
            const b = commandRecorded(t, { name: "test-order-b" })
            const c = commandRecorded(t, { name: "test-order-c" })
            t.spoon.call(b.name)
            await t.spoon.callInteractively(a.name)
            const names = t.spoon.commands("mru").map((command) => command.name)
            t.assert.equal(names[0], a.name, "the first")
            t.assert.equal(names[1], b.name, "the second")
            t.assert.ok(names.indexOf(c.name) > 1, "a command never used came before a used one")
            // Every used command comes before every unused one, so from c on the list holds only
            // commands never used, which must be by name.
            const tail = names.slice(names.indexOf(c.name))
            t.assert.equal(tail.join("|"), [...tail].sort((x, y) => x.localeCompare(y)).join("|"), "the unused commands are not by name")
        }
    },
    {
        name: "commands() follows the configured order, and commands(how) the order given",
        run: (t) => {
            const before = t.spoon.orderGet()
            t.cleanup(() => t.spoon.orderSet(before))
            t.spoon.orderSet("alphabetic")
            const names = t.spoon.commands().map((command) => command.name)
            const sorted = [...names].sort((x, y) => x.localeCompare(y))
            t.assert.equal(names.join("|"), sorted.join("|"), "commands() with the order alphabetic")
            t.spoon.orderSet("mru")
            const alphabetic = t.spoon.commands("alphabetic").map((command) => command.name)
            t.assert.equal(alphabetic.join("|"), sorted.join("|"), "commands(\"alphabetic\") with the order mru")
        }
    },
    {
        name: "a call from a key, or a cancelled call, does not change the order",
        run: async (t) => {
            const used = commandRecorded(t)
            t.spoon.call(used.name)
            const key = commandRecorded(t, { name: "test-order-key" })
            const cancelled = commandRecorded(t, { name: "test-order-cancelled", interactive: [{ name: "a", reader: () => t.spoon.CANCEL }] })
            await t.spoon.callInteractively(key.name, { via: "key" })
            await t.spoon.callInteractively(cancelled.name)
            t.assert.equal(t.spoon.commands("mru")[0].name, used.name, "the most recent command")
        }
    },
    {
        name: "execute() shows the command chooser, and a command chosen in it runs after its runDelay",
        timeout: 15,
        run: async (t) => {
            let ran = null
            const name = "test-execute-target-zq"
            t.spoon.define({ name, doc: "chosen in the command chooser", runDelay: 0.5, fn: () => { ran = Date.now() } })
            t.spoon.execute()
            await promptOpenWait(t)
            await chooserType(t, name)
            await t.wait(0.4)
            const chosen = Date.now()
            chooserKey(t, "return")
            const started = Date.now()
            while (ran === null && Date.now() - started < 3000) await t.wait(0.05)
            t.assert.ok(ran !== null, "the command did not run")
            t.assert.ok(ran - chosen >= 450, `the command ran ${ran - chosen} ms after it was chosen`)
            t.assert.equal(t.spoon.commands("mru")[0].name, name, "the command is not first in mru order")
        }
    },
    {
        name: "the command chooser shows each command's name, keys and description, and typing finds a description",
        timeout: 15,
        run: async (t) => {
            // The chooser is recorded by wrapping hs.chooser.create; every call is passed on.
            const original = hs.chooser.create
            // Taken before the replacement, so that the function is put back as it was.
            const own = Object.prototype.hasOwnProperty.call(hs.chooser, "create")
            const rows = []
            hs.chooser.create = function () {
                const real = original.apply(hs.chooser, arguments)
                const proxy = new Proxy(real, {
                    get(target, property) {
                        const value = target[property]
                        if (typeof value !== "function") return value
                        return (...args) => {
                            if (property === "setChoices") rows.push(...args[0])
                            const result = value.apply(target, args)
                            return result === target ? proxy : result
                        }
                    },
                    set(target, property, value) { target[property] = value; return true }
                })
                return proxy
            }
    t.cleanup(() => { if (own) hs.chooser.create = original; else delete hs.chooser.create })
            const MODIFIERS = ["ctrl", "alt", "shift"]
            let ran = false
            t.spoon.define({ name: "test-execute-row", doc: "a description found only by xylophonic", fn: () => { ran = true } })
            t.spoon.keySet(MODIFIERS, "f19", "test-execute-row")
            t.cleanup(() => t.spoon.keyUnset(MODIFIERS, "f19"))
            t.spoon.execute()
            await promptOpenWait(t)
            const row = rows.find((r) => r.command === "test-execute-row")
            t.assert.ok(row, "the command has no row")
            t.assert.equal(row.text, "test-execute-row   ⌃⌥⇧f19", "the row's text")
            t.assert.equal(row.subText, "a description found only by xylophonic", "the row's description")
            await chooserType(t, "xylophonic")
            await t.wait(0.4)
            chooserKey(t, "return")
            const started = Date.now()
            while (!ran && Date.now() - started < 3000) await t.wait(0.05)
            t.assert.ok(ran, "typing a word of the description did not find the command")
        }
    },
    {
        name: "execute()'s chooser closes on Escape without running anything",
        run: async (t) => {
            t.spoon.execute()
            await promptOpenWait(t)
            chooserKey(t, "escape")
            await t.wait(0.5)
            t.assert.equal(t.spoon.promptIsOpen(), false, "the chooser is still open")
        }
    }
]

// Tests of interactiveFunctionCreate(), as the readme describes it under
// "interactiveFunctionCreate(fn, parameters)".

async function promptOpenWait(t) {
    const started = Date.now()
    while (!t.spoon.promptIsOpen()) {
        if (Date.now() - started > 3000) t.assert.fail("no prompt of the copy opened")
        await t.wait(0.05)
    }
    await t.wait(0.3)
}

// Types into the copy's open chooser one character at a time, checking it before each key, and
// presses Return; or presses Escape when text is null.
async function chooserAnswer(t, text) {
    await promptOpenWait(t)
    if (text !== null) {
        for (const character of text) {
            if (!t.spoon.promptIsOpen()) t.assert.fail(`the chooser closed while "${text}" was typed`)
            hs.eventtap.keyStrokes(character)
            await t.wait(0.02)
        }
        await t.wait(0.4)
    }
    if (!t.spoon.promptIsOpen()) t.assert.fail("the chooser closed before it was answered")
    hs.eventtap.keyStroke([], text === null ? "escape" : "return", null)
}

function isPromise(value) {
    return Boolean(value) && typeof value.then === "function"
}

// A function that records each call's arguments.
function recorded() {
    const calls = []
    return { calls, fn: (...args) => { calls.push(args); return `called with ${args.length}` } }
}

const CHOICE = (t) => ({ name: "pick", reader: t.spoon.readers.choice.prompted, choices: [{ text: "only zq", value: "chosen" }] })

module.exports = [
    {
        name: "interactiveFunctionCreate() throws for something that is not a function",
        run: (t) => {
            let error = null
            try { t.spoon.interactiveFunctionCreate("not a function", []) } catch (e) { error = e }
            t.assert.ok(error instanceof Error)
        }
    },
    {
        name: "a call that prompts nobody returns fn's result at once, not a promise",
        run: (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [{ name: "a", reader: () => "read" }])
            const result = created()
            t.assert.ok(!isPromise(result), "a promise was returned")
            t.assert.equal(result, "called with 1", "the result")
            t.assert.equal(JSON.stringify(calls), '[["read"]]', "the arguments")
        }
    },
    {
        name: "an argument given is not read, and null is passed on unchanged",
        run: (t) => {
            let read = 0
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [
                { name: "a", reader: () => { read++; return "read" } },
                { name: "b", reader: () => { read++; return "read" } }
            ])
            created("given", null)
            t.assert.equal(read, 0, "a reader was called")
            t.assert.equal(JSON.stringify(calls), '[["given",null]]', "the arguments")
        }
    },
    {
        name: "an argument given as undefined is read",
        run: (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [{ name: "a", reader: () => "read" }, { name: "b", reader: () => "read b" }])
            created(undefined, "given")
            t.assert.equal(JSON.stringify(calls), '[["read","given"]]')
        }
    },
    {
        name: "an argument whose entry has no reader is passed on unchanged",
        run: (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [{ name: "other" }, { name: "b", reader: () => "read" }])
            created(undefined)
            t.assert.equal(calls.length, 1, "fn was not called")
            t.assert.equal(calls[0][0], undefined, "the argument without a reader")
            t.assert.equal(calls[0][1], "read", "the argument with a reader")
        }
    },
    {
        name: "a reader that skips gives the entry's default",
        run: (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [{ name: "a", reader: () => t.spoon.SKIP, default: "the default" }])
            created()
            t.assert.equal(JSON.stringify(calls), '[["the default"]]')
        }
    },
    {
        name: "a reader that cancels makes the result null, and fn is not called",
        run: (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [{ name: "a", reader: () => t.spoon.CANCEL }])
            t.assert.equal(created(), null, "the result")
            t.assert.equal(calls.length, 0, "fn was called")
        }
    },
    {
        name: "every reader of one call receives the same snapshot, taken when it is called",
        run: (t) => {
            const snapshots = []
            const reader = (context, parameter, snap) => { snapshots.push(snap); return 1 }
            const created = t.spoon.interactiveFunctionCreate(() => {}, [{ name: "a", reader }, { name: "b", reader }])
            created()
            t.assert.equal(snapshots.length, 2, "readers called")
            t.assert.ok(snapshots[0] && snapshots[0] === snapshots[1], "the two readers received different snapshots")
            t.assert.ok("window" in snapshots[0] && "screen" in snapshots[0], "the snapshot's fields")
        }
    },
    {
        name: "a call that shows a chooser returns a promise of fn's result",
        run: async (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [CHOICE(t)])
            const result = created()
            t.assert.ok(isPromise(result), "no promise was returned")
            await chooserAnswer(t, "only zq")
            t.assert.equal(await result, "called with 1", "the result")
            t.assert.equal(JSON.stringify(calls), '[["chosen"]]', "the arguments")
        }
    },
    {
        name: "a chooser dismissed makes the result null, and fn is not called",
        run: async (t) => {
            const { calls, fn } = recorded()
            const created = t.spoon.interactiveFunctionCreate(fn, [CHOICE(t)])
            const result = created()
            await chooserAnswer(t, null)
            t.assert.equal(await result, null, "the result")
            t.assert.equal(calls.length, 0, "fn was called")
        }
    }
]

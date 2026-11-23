// Tests of promptChangeOn(), promptIsOpen(), promptOpened() and promptClosed(), as the readme
// describes them. They act on the copy under test, whose prompt state is its own.

function consoleErrors(t) {
    const original = console.error
    const errors = []
    console.error = (...args) => { errors.push(args.join(" ")); original.apply(console, args) }
    t.cleanup(() => { console.error = original })
    return errors
}

// Seconds to wait after a prompt closes for the subscribers to be told: the Spoon tells them
// 0.1 s after the last prompt closes.
const NOTICE_WAIT = 0.25

// Subscribes a recorder of the calls, removed when the test ends.
function subscribe(t) {
    const calls = []
    const unsubscribe = t.spoon.promptChangeOn((open) => calls.push(open))
    t.cleanup(unsubscribe)
    return { calls, unsubscribe }
}

async function promptOpenWait(t) {
    const started = Date.now()
    while (!t.spoon.promptIsOpen()) {
        if (Date.now() - started > 3000) t.assert.fail("no prompt of the copy opened")
        await t.wait(0.05)
    }
    await t.wait(0.3)
}

// Types into the copy's open chooser one character at a time, checking it before each key, and
// presses Return.
async function chooserAnswer(t, text) {
    await promptOpenWait(t)
    for (const character of text) {
        if (!t.spoon.promptIsOpen()) t.assert.fail(`the chooser closed while "${text}" was typed`)
        hs.eventtap.keyStrokes(character)
        await t.wait(0.02)
    }
    await t.wait(0.4)
    if (!t.spoon.promptIsOpen()) t.assert.fail("the chooser closed before Return")
    hs.eventtap.keyStroke([], "return", null)
}

module.exports = [
    {
        name: "promptIsOpen() is true between promptOpened() and promptClosed()",
        run: async (t) => {
            t.assert.equal(t.spoon.promptIsOpen(), false, "before")
            t.spoon.promptOpened()
            t.assert.equal(t.spoon.promptIsOpen(), true, "after promptOpened()")
            t.spoon.promptClosed()
            t.assert.equal(t.spoon.promptIsOpen(), false, "after promptClosed()")
            // The notice to subscribers is still pending; a prompt the next test opens within it
            // would count as a continuation of this one.
            await t.wait(NOTICE_WAIT)
        }
    },
    {
        name: "promptChangeOn() calls its function with true when a prompt opens and false 0.1 s after it closes",
        run: async (t) => {
            const { calls } = subscribe(t)
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            t.assert.equal(JSON.stringify(calls), "[true]", "at once")
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]", "after the delay")
        }
    },
    {
        name: "prompts are counted: the function is called when the first opens and when the last closes",
        run: async (t) => {
            const { calls } = subscribe(t)
            t.spoon.promptOpened()
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            t.assert.equal(t.spoon.promptIsOpen(), true, "after the first of two closes")
            t.spoon.promptClosed()
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]")
        }
    },
    {
        name: "a prompt that opens within 0.1 s of the last one closing is not reported as a gap",
        run: async (t) => {
            const { calls } = subscribe(t)
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            t.assert.equal(t.spoon.promptIsOpen(), false, "promptIsOpen() between the two")
            await t.wait(0.03)
            t.spoon.promptOpened()
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true]", "while the second is open")
            t.spoon.promptClosed()
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]", "after the second closed")
        }
    },
    {
        name: "the function promptChangeOn() returns ends the subscription",
        run: async (t) => {
            const { calls, unsubscribe } = subscribe(t)
            unsubscribe()
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            await t.wait(NOTICE_WAIT)
            t.assert.equal(calls.length, 0)
        }
    },
    {
        name: "an extra promptClosed() does nothing",
        run: async (t) => {
            const { calls } = subscribe(t)
            t.spoon.promptClosed()
            t.assert.equal(t.spoon.promptIsOpen(), false, "promptIsOpen()")
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]", "the calls")
        }
    },
    {
        name: "a subscriber that throws does not stop the others, and its error is written to the console",
        run: async (t) => {
            const errors = consoleErrors(t)
            const throwing = t.spoon.promptChangeOn(() => { throw new Error("observer error on purpose") })
            t.cleanup(throwing)
            const { calls } = subscribe(t)
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]", "the other subscriber")
            t.assert.ok(errors.some((e) => e.includes("observer error on purpose")), `errors: ${errors.join(" | ") || "none"}`)
        }
    },
    {
        name: "a chooser opened by a reader is reported to the subscribers",
        run: async (t) => {
            const { calls } = subscribe(t)
            const reading = t.spoon.readerRun(t.spoon.readers.choice.prompted, { choices: [{ text: "only zq", value: 1 }] })
            await chooserAnswer(t, "only zq")
            await reading
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]")
        }
    },
    {
        name: "a command reading two arguments calls the function once when the first opens and once when the last closes",
        timeout: 15,
        run: async (t) => {
            const { calls } = subscribe(t)
            t.spoon.define({
                name: "test-prompts-two",
                interactive: [
                    { name: "a", reader: t.spoon.readers.choice.prompted, choices: [{ text: "first zq", value: 1 }] },
                    { name: "b", reader: t.spoon.readers.choice.prompted, choices: [{ text: "second zq", value: 2 }] }
                ],
                fn: () => {}
            })
            const calling = t.spoon.callInteractively("test-prompts-two")
            await chooserAnswer(t, "first zq")
            await chooserAnswer(t, "second zq")
            await calling
            await t.wait(NOTICE_WAIT)
            t.assert.equal(JSON.stringify(calls), "[true,false]")
        }
    },
    {
        name: "stop() closes the prompt state, telling the subscribers, and removes them",
        run: (t) => {
            const { calls } = subscribe(t)
            t.spoon.promptOpened()
            t.spoon.stop()
            t.assert.equal(t.spoon.promptIsOpen(), false, "promptIsOpen() after stop()")
            t.assert.equal(JSON.stringify(calls), "[true,false]", "the calls")
            t.spoon.promptOpened()
            t.spoon.promptClosed()
            t.assert.equal(calls.length, 2, "a subscriber was called after stop()")
        }
    }
]

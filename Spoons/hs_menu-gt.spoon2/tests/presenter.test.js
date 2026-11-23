// Tests of what a presenter is given and of the session it uses, as the readme describes them
// under "Writing a presenter". The menus are opened on test presenters with sessionOpen(), so no
// menu is shown and no key is bound. No option has an action that reaches outside the test.
//
// The tests of keysSuspend and keysResume tell the user's hs_interactive-gt that a prompt opened
// and closed, through promptOpened() and promptClosed(), because the copy listens to the user's
// hs_interactive-gt. No prompt is shown.

// A presenter that records each call it receives.
function presenterMake(progressive = true) {
    return {
        progressive,
        canHide: true,
        calls: [],
        present(session, buttons) { this.calls.push(["present", buttons.map((b) => b.label)]) },
        setImage(index, image) { this.calls.push(["setImage", index, Boolean(image)]) },
        close() { this.calls.push(["close"]) }
    }
}

function open(t, menu, presenter, name = "Root") {
    const session = t.spoon.sessionOpen(menu, presenter, { name })
    t.cleanup(() => { if (!session.isClosed()) session.close() })
    return session
}

// A presenter that uses the keyboard, recording when it is told to give up its keys and take
// them again.
function keyboardPresenterMake() {
    const presenter = presenterMake()
    presenter.keysSuspend = function () { this.calls.push(["keysSuspend"]) }
    presenter.keysResume = function () { this.calls.push(["keysResume"]) }
    return presenter
}

const callNames = (presenter) => presenter.calls.map((c) => c[0]).filter((n) => n !== "setImage").join(",")

// Tells the user's hs_interactive-gt that a prompt opened, and returns the function that says it
// closed. The test's cleanup says it closed if the test did not.
function promptPretend(t) {
    const interactive = hs.spoons["hs_interactive-gt"]
    interactive.promptOpened()
    let open = true
    const close = () => {
        if (!open) return
        open = false
        interactive.promptClosed()
    }
    t.cleanup(close)
    return close
}

const labels = (session) => session.buttons().map((b) => b.label).join(",")

// A label unique to the run, so that no picture saved earlier is used again.
let made = 0
const label = (t) => `presenter ${t.runId} ${++made}`

const MENU = [
    { label: "Sub", children: [{ label: "Deeper", children: [{ label: "Bottom" }] }] },
    { label: "Plain" }
]

module.exports = [
    // --- the presenter ---
    {
        name: "sessionOpen() presents the menu at once, and a progressive presenter then receives each option's image",
        run: async (t) => {
            const presenter = presenterMake(true)
            open(t, [{ label: label(t) }, { label: label(t) }], presenter)
            t.assert.equal(presenter.calls.length, 1, "calls before any image was drawn")
            t.assert.equal(presenter.calls[0][0], "present", "the first call")
            await t.wait(0.5)
            const images = presenter.calls.filter((c) => c[0] === "setImage")
            t.assert.equal(images.map((c) => c[1]).sort().join(","), "0,1", "the indexes given to setImage()")
            t.assert.ok(images.every((c) => c[2]), "setImage() was given no image")
        }
    },
    {
        name: "present() is called again whenever another menu is displayed",
        run: (t) => {
            const presenter = presenterMake(true)
            const session = open(t, MENU, presenter)
            session.push(session.buttons()[0])
            session.pop()
            const presented = presenter.calls.filter((c) => c[0] === "present").map((c) => c[1].join(","))
            t.assert.equal(presented.join(" | "), "Sub,Plain | Deeper | Sub,Plain")
        }
    },
    {
        name: "each presenter has its own session, so a submenu opened on one does not change the other",
        run: (t) => {
            const first = open(t, MENU, presenterMake())
            const second = open(t, MENU, presenterMake())
            first.push(first.buttons()[0])
            t.assert.equal(labels(first), "Deeper", "the first session")
            t.assert.equal(labels(second), "Sub,Plain", "the second session")
        }
    },
    // --- buttonImage ---
    {
        name: "buttonImage() resolves to an option's own image without drawing it",
        run: async (t) => {
            const ready = await t.spoon.buttonImage({ label: label(t) }, {})
            const image = await t.spoon.buttonImage({ label: "ignored", image: ready }, {})
            t.assert.equal(image, ready)
        }
    },
    {
        name: "buttonImage() passes options.context to imageProvider",
        run: async (t) => {
            let received = null
            const context = { session: null, index: 3, state: "s" }
            await t.spoon.buttonImage({ label: label(t), imageProvider: (c) => { received = c; return "drawn" } }, { context })
            t.assert.equal(received, context)
        }
    },
    {
        name: "buttonImage() resolves to null when imageProvider returns nothing or fails",
        run: async (t) => {
            const errors = []
            const original = console.error
            console.error = (...args) => { errors.push(args.join(" ")); original.apply(console, args) }
            t.cleanup(() => { console.error = original })
            const nothing = await t.spoon.buttonImage({ label: label(t), imageProvider: () => null }, {})
            const failed = await t.spoon.buttonImage({ label: label(t), imageProvider: () => { throw new Error("test failure") } }, {})
            t.assert.equal(nothing, null, "when it returns null")
            t.assert.equal(failed, null, "when it throws")
            t.assert.ok(errors.some((e) => e.includes("test failure")), "the failure was not reported")
        }
    },
    // --- the session ---
    {
        name: "hasAlt() is true for an option with altFn, altCommand or app, and false otherwise",
        run: (t) => {
            const session = open(t, [
                { label: "fn", fn: () => {} },
                { label: "altFn", altFn: () => {} },
                { label: "altCommand", altCommand: "test-command" },
                { label: "app", app: "test.app" },
                { label: "children", children: [] }
            ], presenterMake())
            t.assert.equal([0, 1, 2, 3, 4].map((i) => session.hasAlt(i)).join(","), "false,true,true,true,false")
            t.assert.equal(session.hasAlt(9), false, "an index with no option")
        }
    },
    {
        name: "pop() does nothing at the root, and popToRoot() returns to the root from any depth",
        run: (t) => {
            const session = open(t, MENU, presenterMake())
            session.pop()
            t.assert.equal(labels(session), "Sub,Plain", "after pop() at the root")
            t.assert.ok(!session.canPop(), "canPop() at the root")
            session.push(session.buttons()[0])
            session.push(session.buttons()[0])
            t.assert.equal(labels(session), "Bottom", "two submenus down")
            t.assert.ok(session.canPop(), "canPop() in a submenu")
            session.popToRoot()
            t.assert.equal(labels(session), "Sub,Plain", "after popToRoot()")
        }
    },
    {
        name: "refresh() presents the menu again, calling a menu written as a function again",
        run: (t) => {
            let count = 0
            const presenter = presenterMake()
            const session = open(t, () => { count += 1; return [{ label: `call ${count}` }] }, presenter)
            session.refresh()
            t.assert.equal(count, 2, "calls of the menu function")
            t.assert.equal(labels(session), "call 2", "the options")
            t.assert.equal(presenter.calls.filter((c) => c[0] === "present").length, 2, "present() calls")
        }
    },
    {
        name: "restore() is ignored when the path belongs to another root menu",
        run: (t) => {
            const first = open(t, MENU, presenterMake())
            first.push(first.buttons()[0])
            const path = first.path()
            const other = [{ label: "Sub", children: [{ label: "Other" }] }]
            const second = open(t, other, presenterMake())
            second.restore(path)
            t.assert.equal(labels(second), "Sub", "the options after restore()")
            t.assert.equal(second.path().length, 1, "the depth after restore()")
        }
    },
    {
        name: "letters() and title() describe the menu displayed",
        run: (t) => {
            const session = open(t, MENU, presenterMake(), "Top")
            t.assert.equal(session.letters().join(","), "a,s", "the root's letters")
            t.assert.equal(session.title(), "Top", "the root's title")
            session.push(session.buttons()[0])
            t.assert.equal(session.letters().join(","), "a", "the submenu's letters")
            t.assert.equal(session.title(), "Sub", "the submenu's title")
        }
    },
    // --- keysSuspend and keysResume ---
    {
        name: "a presenter with keysSuspend is told when a prompt opens, and keysResume when it closes",
        run: async (t) => {
            const presenter = keyboardPresenterMake()
            open(t, [{ label: "One" }], presenter)
            const promptClose = promptPretend(t)
            t.assert.equal(callNames(presenter), "present,keysSuspend", "after the prompt opened")
            promptClose()
            // hs_interactive-gt tells its subscribers 0.1 s after the last prompt closes.
            await t.wait(0.3)
            t.assert.equal(callNames(presenter), "present,keysSuspend,keysResume", "after the prompt closed")
        }
    },
    {
        name: "a session opened while a prompt is open calls keysSuspend before its first present",
        run: async (t) => {
            const presenter = keyboardPresenterMake()
            const promptClose = promptPretend(t)
            open(t, [{ label: "One" }], presenter)
            t.assert.equal(callNames(presenter), "keysSuspend,present", "when the session opened")
            promptClose()
            await t.wait(0.3)
            t.assert.equal(callNames(presenter), "keysSuspend,present,keysResume", "after the prompt closed")
        }
    },
    {
        name: "a closed session's presenter, and a presenter without keysSuspend, are not told about prompts",
        run: async (t) => {
            const closed = keyboardPresenterMake()
            open(t, [{ label: "One" }], closed).close()
            const plain = presenterMake()
            open(t, [{ label: "One" }], plain)
            const promptClose = promptPretend(t)
            promptClose()
            await t.wait(0.3)
            t.assert.equal(callNames(closed), "present,close", "the closed session's presenter")
            t.assert.equal(callNames(plain), "present", "the presenter without keysSuspend")
        }
    }
]

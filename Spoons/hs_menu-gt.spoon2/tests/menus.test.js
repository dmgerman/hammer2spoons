// Tests of menus, options and their actions, and of navigate and keepOpen, as the readme
// describes them under "Options", "Menus" and "After the action".
//
// The menus are opened on a test presenter with sessionOpen(), and options are pressed through
// the session, so no menu is shown and no key is sent. The actions that would reach outside the
// test are recorded instead of being carried out, for the length of each test: a command
// (hs_interactive-gt's callInteractively), an application (hs.application.matchingBundleID and
// launchOrFocus) and an address (hs.urlevent.openURL and openURLWithBundle). Because they are
// replaced, a first test checks that each of them exists in Hammerspoon 2: a call to a function
// that did not exist, hs.urlevent.urlOpen, went unnoticed until 2026-11-23.

// A presenter that records what it is given. canHide decides whether keepOpen applies.
function presenterMake(canHide = true) {
    return {
        progressive: true,
        canHide,
        presented: [],
        closed: 0,
        present(session, buttons) { this.presented.push(buttons.map((b) => b.label)) },
        setImage() {},
        close() { this.closed += 1 }
    }
}

// Replaces obj[name] until the test ends. A call the test owns, as `ours` decides from its
// arguments, is recorded and answered with `result`; any other call, which another of the
// user's Spoons may make meanwhile, is passed on to the real function.
function spy(t, obj, name, ours, result) {
    const original = obj[name]
    // Whether the function is the object's own property, so that it is put back as it was: a
    // function Hammerspoon 2 provides is not, and setting it back would leave a copy.
    const own = Object.prototype.hasOwnProperty.call(obj, name)
    const calls = []
    obj[name] = function (...args) {
        if (!ours(...args)) return original.apply(obj, args)
        calls.push(args)
        return typeof result === "function" ? result(...args) : result
    }
    t.cleanup(() => { if (own) obj[name] = original; else delete obj[name] })
    return calls
}

const testBundle = (bundle) => String(bundle).startsWith("test.")
const testAddress = (url) => String(url).startsWith("https://example.com/")
const testCommand = (name) => String(name).startsWith("test-")

// Records the actions that reach outside the test.
function actionsRecord(t) {
    const app = { isActive: false, frontmost: 0, hidden: 0, setFrontmost() { this.frontmost += 1 }, hide() { this.hidden += 1 } }
    const interactive = hs.spoons["hs_interactive-gt"]
    return {
        app,
        commands: spy(t, interactive, "callInteractively", testCommand),
        matching: spy(t, hs.application, "matchingBundleID", testBundle, (bundle) => bundle === "test.running" ? app : null),
        launched: spy(t, hs.application, "launchOrFocus", testBundle),
        urls: spy(t, hs.urlevent, "openURL", testAddress),
        urlsWith: spy(t, hs.urlevent, "openURLWithBundle", testAddress)
    }
}

function open(t, menu, presenter, name) {
    const session = t.spoon.sessionOpen(menu, presenter, { name: name || "Root" })
    t.cleanup(() => { if (!session.isClosed()) session.close() })
    return session
}

const labels = (session) => session.buttons().map((b) => b.label)

module.exports = [
    {
        name: "every function the actions call exists in Hammerspoon 2",
        run: (t) => {
            const missing = []
            const check = (name, value) => { if (typeof value !== "function") missing.push(name) }
            check("hs.urlevent.openURL", hs.urlevent.openURL)
            check("hs.urlevent.openURLWithBundle", hs.urlevent.openURLWithBundle)
            check("hs.application.matchingBundleID", hs.application.matchingBundleID)
            check("hs.application.launchOrFocus", hs.application.launchOrFocus)
            const interactive = hs.spoons["hs_interactive-gt"]
            check("hs_interactive-gt's callInteractively", interactive && interactive.callInteractively)
            t.assert.equal(missing.join(", "), "", "missing")
        }
    },
    {
        name: "a menu written as an array is presented, with its title",
        run: (t) => {
            const presenter = presenterMake()
            const session = open(t, [{ label: "One" }, { label: "Two" }], presenter, "Test menu")
            t.assert.equal(labels(session).join(","), "One,Two", "the options")
            t.assert.equal(presenter.presented.length >= 1, true, "present() was not called")
            t.assert.equal(session.title(), "Test menu", "the title")
        }
    },
    {
        name: "a menu written as a function is called with {session, presenter, depth} when it is opened",
        run: (t) => {
            const presenter = presenterMake()
            let given = null
            const session = open(t, (context) => { given = context; return [{ label: "Computed" }] }, presenter)
            t.assert.equal(labels(session).join(","), "Computed", "the options")
            t.assert.equal(given.session, session, "context.session")
            t.assert.equal(given.presenter, presenter, "context.presenter")
            t.assert.equal(given.depth, 0, "context.depth")
        }
    },
    {
        name: "a menu written as {buttons} is presented, and buttons may be a function",
        run: (t) => {
            const first = open(t, { keepOpen: true, buttons: [{ label: "A" }] }, presenterMake())
            t.assert.equal(labels(first).join(","), "A", "an array of buttons")
            const second = open(t, { buttons: () => [{ label: "B" }] }, presenterMake())
            t.assert.equal(labels(second).join(","), "B", "a function of buttons")
        }
    },
    {
        name: "a short press calls fn with {session, presenter, depth} and the option",
        run: (t) => {
            const presenter = presenterMake()
            const calls = []
            const option = { label: "Hello", fn: (context, button) => calls.push([context, button]) }
            const session = open(t, [option], presenter)
            session.activate(0)
            t.assert.equal(calls.length, 1, "fn calls")
            t.assert.equal(calls[0][0].session, session, "context.session")
            t.assert.equal(calls[0][0].presenter, presenter, "context.presenter")
            t.assert.equal(calls[0][0].depth, 0, "context.depth")
            t.assert.equal(calls[0][1], option, "the option")
        }
    },
    {
        name: "a long press calls altFn, and down then up runs the short action",
        run: async (t) => {
            const ran = []
            const session = open(t, [{ label: "Both", fn: () => ran.push("short"), altFn: () => ran.push("long"), keepOpen: true }], presenterMake())
            session.activate(0, "long")
            t.assert.equal(ran.join(","), "long", "activate long")
            session.down(0)
            session.up(0)
            t.assert.equal(ran.join(","), "long,short", "down and up")
        }
    },
    {
        name: "holding an option runs its second action, and the release does not run the first",
        run: async (t) => {
            const ran = []
            const session = open(t, [{ label: "Hold", fn: () => ran.push("short"), altFn: () => ran.push("long"), keepOpen: true }], presenterMake())
            session.down(0)
            await t.wait(t.spoon.config.holdSeconds + 0.3)
            session.up(0)
            t.assert.equal(ran.join(","), "long")
        }
    },
    {
        name: "a short press runs a command through hs_interactive-gt with the arguments given",
        run: (t) => {
            const actions = actionsRecord(t)
            const session = open(t, [{ label: "25 min", command: "test-countdown-for", args: [25], keepOpen: true }], presenterMake())
            session.activate(0)
            t.assert.equal(JSON.stringify(actions.commands), '[["test-countdown-for",{"args":[25]}]]')
        }
    },
    {
        name: "a long press runs altCommand with altArgs",
        run: (t) => {
            const actions = actionsRecord(t)
            const session = open(t, [{ label: "Mail", command: "test-mail-open", altCommand: "test-mail-compose", altArgs: ["x"], keepOpen: true }], presenterMake())
            session.activate(0, "long")
            t.assert.equal(JSON.stringify(actions.commands), '[["test-mail-compose",{"args":["x"]}]]')
        }
    },
    {
        name: "app brings a running application forward, starts one that is not running, and a hold hides it when frontmost",
        run: (t) => {
            const actions = actionsRecord(t)
            const session = open(t, [
                { label: "Running", app: "test.running", keepOpen: true },
                { label: "Not running", app: "test.not.running", keepOpen: true }
            ], presenterMake())
            session.activate(0)
            t.assert.equal(actions.app.frontmost, 1, "setFrontmost calls")
            session.activate(1)
            t.assert.equal(JSON.stringify(actions.launched), '[["test.not.running"]]', "launchOrFocus")
            actions.app.isActive = true
            session.activate(0, "long")
            t.assert.equal(actions.app.hidden, 1, "hide calls")
        }
    },
    {
        name: "url opens the address, in the browser given by urlBundle when there is one",
        run: (t) => {
            const actions = actionsRecord(t)
            const session = open(t, [
                { label: "Default", url: "https://example.com/a", keepOpen: true },
                { label: "Browser", url: "https://example.com/b", urlBundle: "test.browser", keepOpen: true }
            ], presenterMake())
            session.activate(0)
            session.activate(1)
            t.assert.equal(JSON.stringify(actions.urls), '[["https://example.com/a"]]', "openURL")
            t.assert.equal(JSON.stringify(actions.urlsWith), '[["https://example.com/b","test.browser"]]', "openURLWithBundle")
        }
    },
    {
        name: "a short press runs the first of fn, command, app and url the option has",
        run: (t) => {
            const actions = actionsRecord(t)
            const ran = []
            const session = open(t, [
                { label: "fn first", fn: () => ran.push("fn"), command: "test-c", app: "test.running", url: "https://example.com", keepOpen: true },
                { label: "command next", command: "test-c", app: "test.running", url: "https://example.com", keepOpen: true },
                { label: "app next", app: "test.running", url: "https://example.com", keepOpen: true }
            ], presenterMake())
            session.activate(0)
            session.activate(1)
            session.activate(2)
            t.assert.equal(ran.join(","), "fn", "fn")
            t.assert.equal(actions.commands.length, 1, "commands")
            t.assert.equal(actions.app.frontmost, 1, "applications")
            t.assert.equal(actions.urls.length, 0, "addresses")
        }
    },
    {
        name: "an option with children opens its submenu, titled with its label, and back returns",
        run: (t) => {
            const session = open(t, [{ label: "More", children: [{ label: "Inner" }, { label: "Back", back: true }] }], presenterMake())
            session.activate(0)
            t.assert.equal(labels(session).join(","), "Inner,Back", "the submenu")
            t.assert.equal(session.title(), "More", "the submenu's title")
            t.assert.equal(session.canPop(), true, "canPop() in the submenu")
            session.activate(1)
            t.assert.equal(labels(session).join(","), "More", "after back")
            t.assert.equal(session.canPop(), false, "canPop() at the root")
        }
    },
    {
        name: "children written as a function is called with depth 1",
        run: (t) => {
            let depth = null
            const session = open(t, [{ label: "More", children: (context) => { depth = context.depth; return [{ label: "Inner" }] } }], presenterMake())
            session.activate(0)
            t.assert.equal(depth, 1)
        }
    },
    {
        name: "after an action, navigate parent returns to the parent menu, which is the default",
        run: (t) => {
            const inner = [{ label: "Default", fn: () => {}, keepOpen: true }, { label: "Parent", fn: () => {}, navigate: "parent", keepOpen: true }]
            const session = open(t, [{ label: "More", children: inner }], presenterMake())
            session.activate(0)
            session.activate(0)
            t.assert.equal(labels(session).join(","), "More", "after the option without navigate")
            session.activate(0)
            session.activate(1)
            t.assert.equal(labels(session).join(","), "More", "after navigate parent")
        }
    },
    {
        name: "after an action, navigate stay keeps the menu, and root returns to the root",
        run: (t) => {
            const deepest = [{ label: "Root", fn: () => {}, navigate: "root", keepOpen: true }, { label: "Stay", fn: () => {}, navigate: "stay", keepOpen: true }]
            const session = open(t, [{ label: "One", children: [{ label: "Two", children: deepest }] }], presenterMake())
            session.activate(0)
            session.activate(0)
            session.activate(1)
            t.assert.equal(labels(session).join(","), "Root,Stay", "after stay")
            session.activate(0)
            t.assert.equal(labels(session).join(","), "One", "after root")
        }
    },
    {
        name: "path() and restore() reopen the same submenu",
        run: (t) => {
            const menu = [{ label: "More", children: [{ label: "Inner" }] }]
            const first = open(t, menu, presenterMake())
            first.activate(0)
            const path = first.path()
            const second = open(t, menu, presenterMake())
            second.restore(path)
            t.assert.equal(labels(second).join(","), "Inner")
        }
    },
    {
        name: "on a presenter that can hide, an action closes the menu unless keepOpen is true",
        run: (t) => {
            const presenter = presenterMake(true)
            const session = open(t, [{ label: "Keep", fn: () => {}, keepOpen: true }, { label: "Close", fn: () => {} }], presenter)
            session.activate(0)
            t.assert.equal(session.isClosed(), false, "after keepOpen true")
            session.activate(1)
            t.assert.equal(session.isClosed(), true, "after keepOpen absent")
            t.assert.equal(presenter.closed, 1, "the presenter's close() calls")
        }
    },
    {
        name: "on a presenter that cannot hide, keepOpen has no effect and the menu stays",
        run: (t) => {
            const session = open(t, [{ label: "Close", fn: () => {} }], presenterMake(false))
            session.activate(0)
            t.assert.equal(session.isClosed(), false)
        }
    },
    {
        name: "a menu's keepOpen is the default for its options, and an option's own keepOpen takes precedence",
        run: (t) => {
            const session = open(t, { keepOpen: true, buttons: [{ label: "Default", fn: () => {} }, { label: "Own", fn: () => {}, keepOpen: false }] }, presenterMake(true))
            session.activate(0)
            t.assert.equal(session.isClosed(), false, "after the option without its own keepOpen")
            session.activate(1)
            t.assert.equal(session.isClosed(), true, "after the option with keepOpen false")
        }
    },
    {
        name: "a hold on an option with a submenu runs its action and keeps the menu displayed",
        run: (t) => {
            const ran = []
            const session = open(t, { keepOpen: false, buttons: [{ label: "More", altFn: () => ran.push("long"), children: [{ label: "Inner" }] }] }, presenterMake(true))
            session.activate(0, "long")
            t.assert.equal(ran.join(","), "long", "the second action")
            t.assert.equal(session.isClosed(), false, "the menu closed")
        }
    },
    {
        name: "an option without an action does nothing and keeps the menu",
        run: (t) => {
            const session = open(t, [{ label: "Nothing" }], presenterMake(true))
            session.activate(0)
            t.assert.equal(session.isClosed(), false)
        }
    },
    {
        name: "close() closes the session and calls the presenter's close()",
        run: (t) => {
            const presenter = presenterMake()
            const session = open(t, [{ label: "One" }], presenter)
            session.close()
            t.assert.equal(session.isClosed(), true, "isClosed()")
            t.assert.equal(presenter.closed, 1, "the presenter's close() calls")
        }
    }
]

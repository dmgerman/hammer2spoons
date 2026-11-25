// Tests of the on-screen menu and of presses from the keyboard, as the readme describes them
// under "Presses" and "The on-screen menu".
//
// Each test opens a test window and focuses it before it shows a menu, and sends a key only
// while the copy reports its menu shown and a test window has the focus. A key the copy does not
// take then reaches the test window, not one of the user's. Every option runs a function of the
// test, so no command, application or address is reached.
//
// The tests of prompts tell the user's hs_interactive-gt that a prompt opened and closed, through
// promptOpened() and promptClosed(), because the copy listens to the user's hs_interactive-gt.
// No prompt is shown.

// Opens a test window and gives it the focus.
// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

async function windowFocused(t) {
    const [window] = await t.windowsOpen()
    window.focus()
    await t.wait(0.4)
    return window
}

function testWindowFocused(t) {
    const focused = hs.window.focusedWindow()
    return Boolean(focused) && String(focused.title).startsWith(t.titlePrefix)
}

// Fails instead of sending a key that could reach one of the user's windows.
function keyCheck(t, key) {
    if (!t.spoon.onScreenIsShown()) t.assert.fail(`not pressing ${key}: the menu is not shown`)
    if (!testWindowFocused(t)) t.assert.fail(`not pressing ${key}: a test window does not have the focus`)
}

async function keyPress(t, modifiers, key) {
    keyCheck(t, key)
    hs.eventtap.keyStroke(withFn(modifiers, key), key, null)
    await t.wait(0.3)
}

// Puts a key down, or lets it up, without the other half of the press.
function keyPost(t, key, down) {
    if (down) keyCheck(t, key)
    hs.eventtap.makeKeyEvent(key, down, []).post(null)
}

function show(t, menu, name = "Root") {
    const session = t.spoon.onScreenShow(menu, { name })
    t.cleanup(() => { t.spoon.onScreenHide(); t.spoon.onScreenPositionReset() })
    return session
}

// Counts the calls of each function it makes, by name.
function counter() {
    const calls = {}
    return {
        calls,
        fn: (name) => () => { calls[name] = (calls[name] || 0) + 1 }
    }
}

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

// The centre of a canvas frame. A canvas is placed in screen coordinates, as hs.screen is, with
// y = 0 at the top of the primary screen.
function canvasCentre(frame) {
    return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
}

function centreOn(t, frame, screen, message) {
    const c = canvasCentre(frame)
    const s = screen.fullFrame
    const expected = { x: s.x + s.w / 2, y: s.y + s.h / 2 }
    if (Math.abs(c.x - expected.x) > 1 || Math.abs(c.y - expected.y) > 1) {
        t.assert.fail(`${message}: expected the centre at (${expected.x}, ${expected.y}), got (${c.x}, ${c.y})`)
    }
}

// The canvases of the menu's panel, among those recorded. The Spoon also draws each option in a
// canvas of its own, created at (0, 0) and never shown, while the panel is centred on a screen.
const panels = (canvases) => canvases.filter((c) => c.frame.x !== 0 || c.frame.y !== 0)

// Sets fields of config.screen, or of config when `top` is true, until the test ends.
function settingsSet(t, values, top = false) {
    const target = top ? t.spoon.config : t.spoon.config.screen
    const original = {}
    for (const key of Object.keys(values)) {
        original[key] = target[key]
        target[key] = values[key]
    }
    t.cleanup(() => Object.assign(target, original))
}

// Sets showDelay until the test ends.
function delaySet(t, seconds) {
    settingsSet(t, { showDelay: seconds })
}

function near(t, actual, expected, message) {
    if (typeof actual !== "number" || Math.abs(actual - expected) > 0.01) {
        t.assert.fail(`${message}: expected ${expected}, got ${actual}`)
    }
}

const SUBMENU = (calls) => [
    { label: "Sub", key: "k", children: [{ label: "Inner", key: "j", fn: calls.fn("inner") }] },
    { label: "Plain", key: "l", fn: calls.fn("plain") }
]

module.exports = [
    // --- showing and hiding ---
    {
        name: "onScreenShow() shows a menu and returns its session, and onScreenHide() hides it",
        run: async (t) => {
            await windowFocused(t)
            const session = show(t, [{ label: "One" }])
            t.assert.ok(t.spoon.onScreenIsShown(), "shown after onScreenShow()")
            t.assert.equal(session.buttons()[0].label, "One", "the session's options")
            t.spoon.onScreenHide()
            t.assert.ok(!t.spoon.onScreenIsShown(), "shown after onScreenHide()")
            t.assert.ok(session.isClosed(), "the session was not closed")
        }
    },
    {
        name: "onScreenShow() replaces a menu that is shown",
        run: async (t) => {
            await windowFocused(t)
            const first = show(t, [{ label: "First" }])
            const second = show(t, [{ label: "Second" }])
            t.assert.ok(first.isClosed(), "the first session was not closed")
            t.assert.ok(t.spoon.onScreenIsShown(), "no menu shown")
            t.assert.equal(second.buttons()[0].label, "Second")
        }
    },
    {
        name: "onScreenToggle() hides a menu that is shown, and shows one otherwise",
        run: async (t) => {
            await windowFocused(t)
            const menu = [{ label: "One" }]
            t.cleanup(() => t.spoon.onScreenHide())
            t.spoon.onScreenToggle(menu, { name: "Root" })
            t.assert.ok(t.spoon.onScreenIsShown(), "shown after the first toggle")
            t.spoon.onScreenToggle(menu, { name: "Root" })
            t.assert.ok(!t.spoon.onScreenIsShown(), "shown after the second toggle")
        }
    },
    // --- keys ---
    {
        name: "a letter runs its option's action and closes the menu",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("one") }, { label: "Two", key: "l", fn: calls.fn("two") }])
            await keyPress(t, [], "l")
            t.assert.equal(JSON.stringify(calls.calls), '{"two":1}', "the actions run")
            t.assert.ok(!t.spoon.onScreenIsShown(), "the menu is still shown")
        }
    },
    {
        name: "when two options have the same letter, the first takes the key, and the console reports the other",
        run: async (t) => {
            await windowFocused(t)
            const errors = []
            const original = console.error
            console.error = (...args) => { errors.push(args.join(" ")); original.apply(console, args) }
            t.cleanup(() => { console.error = original })
            const calls = counter()
            show(t, [{ label: "First", key: "j", fn: calls.fn("first") }, { label: "Second", key: "j", fn: calls.fn("second") }])
            await t.wait(0.3)
            t.assert.ok(errors.some((e) => e.includes("could not bind j")), `errors: ${errors.join(" | ") || "none"}`)
            await keyPress(t, [], "j")
            t.assert.equal(JSON.stringify(calls.calls), '{"first":1}', "the actions run")
        }
    },
    {
        name: "a letter opens a submenu, Delete returns to the parent menu, and Escape closes the menu",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            const session = show(t, SUBMENU(calls))
            await keyPress(t, [], "k")
            t.assert.equal(session.buttons()[0].label, "Inner", "after k")
            await keyPress(t, [], "delete")
            t.assert.equal(session.buttons()[0].label, "Sub", "after Delete")
            await keyPress(t, [], "escape")
            t.assert.ok(!t.spoon.onScreenIsShown(), "the menu is shown after Escape")
            t.assert.equal(JSON.stringify(calls.calls), "{}", "the actions run")
        }
    },
    {
        name: "shift with a letter selects the option whose key is the capital letter",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "small", key: "j", fn: calls.fn("small") }, { label: "capital", key: "J", fn: calls.fn("capital") }])
            await keyPress(t, ["shift"], "j")
            t.assert.equal(JSON.stringify(calls.calls), '{"capital":1}')
        }
    },
    {
        name: "ctrl with a letter runs the option's second action at once",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("short"), altFn: calls.fn("long") }])
            await keyPress(t, ["ctrl"], "j")
            t.assert.equal(JSON.stringify(calls.calls), '{"long":1}')
        }
    },
    {
        name: "ctrl-shift with a letter runs the second action of the capital letter's option",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [
                { label: "small", key: "j", fn: calls.fn("small"), altFn: calls.fn("smallLong") },
                { label: "capital", key: "J", fn: calls.fn("capital"), altFn: calls.fn("capitalLong") }
            ])
            await keyPress(t, ["ctrl", "shift"], "j")
            t.assert.equal(JSON.stringify(calls.calls), '{"capitalLong":1}')
        }
    },
    {
        name: "ctrl with the letter of an option without a second action is not taken by the menu",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("one") }])
            await keyPress(t, ["ctrl"], "j")
            t.assert.equal(JSON.stringify(calls.calls), "{}", "the actions run")
            t.assert.ok(t.spoon.onScreenIsShown(), "the menu closed")
        }
    },
    {
        name: "holding a letter for holdSeconds runs the second action while the key is down, and the release does nothing",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("short"), altFn: calls.fn("long") }])
            let down = false
            t.cleanup(() => { if (down) keyPost(t, "j", false) })
            keyPost(t, "j", true)
            down = true
            await t.wait(t.spoon.config.holdSeconds + 0.3)
            t.assert.equal(JSON.stringify(calls.calls), '{"long":1}', "while the key was down")
            keyPost(t, "j", false)
            down = false
            await t.wait(0.3)
            t.assert.equal(JSON.stringify(calls.calls), '{"long":1}', "after the release")
        }
    },
    {
        name: "a letter released before holdSeconds runs the first action",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("short"), altFn: calls.fn("long") }])
            await keyPress(t, [], "j")
            await t.wait(t.spoon.config.holdSeconds)
            t.assert.equal(JSON.stringify(calls.calls), '{"short":1}')
        }
    },
    // --- where it reopens ---
    {
        name: "the same menu reopens at the submenu shown when it was hidden",
        run: async (t) => {
            await windowFocused(t)
            const menu = SUBMENU(counter())
            show(t, menu).activate(0)
            t.spoon.onScreenHide()
            const session = show(t, menu)
            t.assert.equal(session.path().length, 2, "the depth of the menu shown")
            t.assert.equal(session.buttons()[0].label, "Inner")
        }
    },
    {
        name: "onScreenPositionReset() makes the menu reopen at its root",
        run: async (t) => {
            await windowFocused(t)
            const menu = SUBMENU(counter())
            show(t, menu).activate(0)
            t.spoon.onScreenHide()
            t.spoon.onScreenPositionReset()
            const session = show(t, menu)
            t.assert.equal(session.path().length, 1, "the depth of the menu shown")
        }
    },
    {
        name: "a different menu opens at its root",
        run: async (t) => {
            await windowFocused(t)
            show(t, SUBMENU(counter())).activate(0)
            t.spoon.onScreenHide()
            const session = show(t, SUBMENU(counter()))
            t.assert.equal(session.path().length, 1, "the depth of the menu shown")
        }
    },
    // --- prompts ---
    {
        name: "the menu releases its keys while hs_interactive-gt has a prompt open, and binds them again after",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("one") }])
            const promptClose = promptPretend(t)
            await t.wait(0.2)
            await keyPress(t, [], "j")
            t.assert.equal(JSON.stringify(calls.calls), "{}", "actions run while the prompt was open")
            t.assert.ok(t.spoon.onScreenIsShown(), "the menu closed while the prompt was open")
            promptClose()
            await t.wait(0.4)
            await keyPress(t, [], "j")
            t.assert.equal(JSON.stringify(calls.calls), '{"one":1}', "actions run after the prompt closed")
        }
    },
    {
        name: "a menu shown while a prompt is open binds its keys only when the prompt closes",
        run: async (t) => {
            await windowFocused(t)
            const calls = counter()
            const promptClose = promptPretend(t)
            show(t, [{ label: "One", key: "j", fn: calls.fn("one") }])
            await t.wait(0.2)
            await keyPress(t, [], "j")
            t.assert.equal(JSON.stringify(calls.calls), "{}", "actions run while the prompt was open")
            promptClose()
            await t.wait(0.4)
            await keyPress(t, [], "j")
            t.assert.equal(JSON.stringify(calls.calls), '{"one":1}', "actions run after the prompt closed")
        }
    },
    // --- drawing ---
    {
        name: "the menu is drawn after showDelay, in the middle of the screen of the focused window",
        run: async (t) => {
            const window = await windowFocused(t)
            delaySet(t, 0.4)
            const canvases = t.canvasesCapture()
            show(t, [{ label: "One" }, { label: "Two" }])
            await t.wait(0.2)
            t.assert.equal(panels(canvases).length, 0, "panels before showDelay")
            await t.wait(0.5)
            t.assert.equal(panels(canvases).length, 1, "panels after showDelay")
            centreOn(t, panels(canvases)[0].frame, window.screen, "the menu")
        }
    },
    {
        name: "a letter pressed during showDelay runs its action, and the menu is never drawn",
        run: async (t) => {
            await windowFocused(t)
            delaySet(t, 0.5)
            const canvases = t.canvasesCapture()
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("one") }])
            await keyPress(t, [], "j")
            await t.wait(0.6)
            t.assert.equal(JSON.stringify(calls.calls), '{"one":1}', "the actions run")
            t.assert.equal(panels(canvases).length, 0, "panels drawn")
        }
    },
    {
        name: "a submenu opened during showDelay waits showDelay again, and replaces a drawn menu at once",
        run: async (t) => {
            await windowFocused(t)
            delaySet(t, 0.4)
            const canvases = t.canvasesCapture()
            const session = show(t, SUBMENU(counter()))
            await t.wait(0.3)
            session.activate(0)
            await t.wait(0.3)
            t.assert.equal(panels(canvases).length, 0, "panels 0.3 s after the submenu opened")
            await t.wait(0.3)
            t.assert.equal(panels(canvases).length, 1, "panels 0.6 s after the submenu opened")
            session.pop()
            t.assert.equal(session.buttons()[0].label, "Sub", "the menu after pop()")
            t.assert.equal(panels(canvases).length, 1, "panels after pop(): the drawn one is reused")
        }
    },
    // --- the mouse ---
    {
        name: "a click on the menu goes to the window beneath it, and the menu does not act on it",
        run: async (t) => {
            const [beneath, focused] = await t.windowsOpen(2)
            const screen = beneath.screen
            const f = screen.frame
            const centre = { x: f.x + f.w / 2, y: f.y + f.h / 2 }
            // One window under the middle of the screen, where the menu is drawn, and the
            // other in a corner, away from it, with the focus.
            await t.frameSet(beneath, { x: centre.x - 300, y: centre.y - 200, w: 600, h: 400 })
            await t.frameSet(focused, { x: f.x + 20, y: f.y + 20, w: 300, h: 200 })
            // The window beneath is focused first, so that it is in front of the user's windows at
            // the middle of the screen: on 2026-11-25 a Google Chrome window of the user's was in
            // front of it there, and the click went to Chrome. raise() was not enough, because
            // macOS does not put a window of an inactive application above the active one's.
            // Focusing it activates the test windows' application, and the other test window,
            // focused next, belongs to the same application.
            beneath.focus()
            await t.wait(0.4)
            focused.focus()
            await t.wait(0.4)
            // Checked before the menu is drawn, so that the menu itself is not the window found.
            const front = hs.window.windowAtPoint(new HSPoint(centre.x, centre.y))
            if (!front || front.id !== beneath.id) {
                t.assert.fail(`not clicking: ${front ? `${front.application.name} #${front.id}` : "no window"} is in front of the test window at the middle of the screen`)
            }

            settingsSet(t, { showDelay: 0 })
            const calls = counter()
            show(t, [{ label: "One", key: "j", fn: calls.fn("one") }, { label: "Two", key: "l", fn: calls.fn("two") }])
            await t.wait(0.3)

            // Clicks only where a test window is beneath the menu.
            const b = beneath.frame
            const inside = centre.x > b.x && centre.x < b.x + b.w && centre.y > b.y && centre.y < b.y + b.h
            if (!inside) t.assert.fail("not clicking: the test window is not beneath the middle of the screen")
            if (!t.spoon.onScreenIsShown()) t.assert.fail("not clicking: the menu is not shown")
            if (hs.window.focusedWindow().id !== focused.id) t.assert.fail("not clicking: the other test window does not have the focus")
            hs.eventtap.leftClick(centre.x, centre.y)
            await t.wait(0.5)

            t.assert.equal(hs.window.focusedWindow().id, beneath.id, "the window with the focus after the click")
            t.assert.ok(t.spoon.onScreenIsShown(), "the menu closed")
            t.assert.equal(JSON.stringify(calls.calls), "{}", "the actions run")
        }
    },
    // --- the on-screen menu's settings ---
    {
        name: "tile, spacing, padding, letterSize and columnsFor set the size of the panel",
        run: async (t) => {
            await windowFocused(t)
            settingsSet(t, { showDelay: 0, tile: 50, spacing: 10, padding: 20, letterSize: 12, columnsFor: (count) => 2 })
            const canvases = t.canvasesCapture()
            show(t, [{ label: "One" }, { label: "Two" }, { label: "Three" }])
            const [panel] = panels(canvases)
            t.assert.ok(panel, "no panel was drawn")
            // Two columns of 50 with 10 between, and 20 on each side.
            t.assert.equal(panel.frame.w, 2 * 50 + 10 + 2 * 20, "the width")
            // Two rows, each a tile, 2 points, and a letter 4 points taller than letterSize.
            t.assert.equal(panel.frame.h, 2 * (50 + 2 + 12 + 4) + 10 + 2 * 20, "the height")
        }
    },
    {
        name: "background, alpha, letterSize and letterColor are the colours and sizes the panel is drawn with",
        run: async (t) => {
            await windowFocused(t)
            settingsSet(t, { showDelay: 0, background: "#FF000080", letterSize: 21, letterColor: "#00FF00" })
            settingsSet(t, { alpha: 0.5 }, true)
            const canvases = t.canvasesCapture()
            show(t, [{ label: "One" }])
            const [panel] = panels(canvases)
            t.assert.ok(panel, "no panel was drawn")
            const background = panel.canvas.elementAttribute(0, "fillColor")
            near(t, background && background.red, 1, "the panel's red")
            near(t, background && background.alpha, (0x80 / 255) * 0.5, "the panel's alpha, multiplied by config.alpha")
            // The panel, then the option's tile, then its letter.
            near(t, panel.canvas.elementAttribute(2, "textSize"), 21, "the letter's size")
            const letter = panel.canvas.elementAttribute(2, "textColor")
            near(t, letter && letter.green, 1, "the letter's green")
            near(t, letter && letter.alpha, 1, "the letter's alpha, which config.alpha does not change")
        }
    },
    {
        name: "cancelKeys and backKeys replace Escape and Delete",
        run: async (t) => {
            await windowFocused(t)
            settingsSet(t, { cancelKeys: ["q"], backKeys: ["b"] })
            const session = show(t, SUBMENU(counter()))
            await keyPress(t, [], "k")
            await keyPress(t, [], "b")
            t.assert.equal(session.buttons()[0].label, "Sub", "after b")
            await keyPress(t, [], "escape")
            t.assert.ok(t.spoon.onScreenIsShown(), "Escape closed the menu")
            await keyPress(t, [], "q")
            t.assert.ok(!t.spoon.onScreenIsShown(), "the menu is shown after q")
        }
    }
]

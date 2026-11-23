// Every test of hs_windowfilter-gt that needs two screens. With fewer connected, the harness
// reports each of them as skipped without running it. make test-two-screens runs this file
// alone. The tests use the first two screens of hs.screen.all().

const recorders = require("./recorder.js")

const SETTLE = 0.6

function testRules(t, extra) {
    return Object.assign({ allowTitles: (title) => (title || "").startsWith(t.titlePrefix) }, extra || {})
}

// A watched filter of the copy under test, with a recorder, removed when the test ends.
function filterRecorded(t, rules) {
    const filter = t.spoon.create(rules)
    t.cleanup(() => t.spoon.destroy(filter))
    return { filter, recorder: recorders.create(t, filter) }
}

// A frame inside a screen's usable frame, away from its edges.
function inside(screen) {
    const f = screen.frame
    return { x: f.x + 100, y: f.y + 80, w: 450, h: 350 }
}

// Opens a test window on a screen, and waits until a filter that accepts every test window has
// seen it there.
async function windowOn(t, screen) {
    const { recorder } = filterRecorded(t, testRules(t))
    const [window] = await t.windowsOpen()
    await recorder.waitFor("windowCreated", window)
    await t.frameSet(window, inside(screen))
    await recorder.waitFor("windowMoved", window)
    await t.wait(SETTLE)
    return window
}

const tests = [
    {
        name: "allowScreens by name accepts a window once it is moved to that screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const { filter, recorder } = filterRecorded(t, testRules(t, { allowScreens: b.name }))
            t.assert.equal(filter.isWindowAllowed(window), false, "on the first screen")
            await t.frameSet(window, inside(b))
            await recorder.waitFor("windowAllowed", window)
            t.assert.equal(filter.isWindowAllowed(window), true, "on the second screen")
        }
    },
    {
        name: "allowScreens by id accepts a window once it is moved to that screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const { filter, recorder } = filterRecorded(t, testRules(t, { allowScreens: String(b.id) }))
            t.assert.equal(filter.isWindowAllowed(window), false, "on the first screen")
            await t.frameSet(window, inside(b))
            await recorder.waitFor("windowAllowed", window)
            t.assert.equal(filter.isWindowAllowed(window), true, "on the second screen")
        }
    },
    {
        name: "a filter limited to one screen receives windowRejected and windowMoved when its window leaves",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const { recorder } = filterRecorded(t, testRules(t, { allowScreens: a.name }))
            await t.wait(SETTLE)
            await t.frameSet(window, inside(b))
            await recorder.waitFor("windowRejected", window)
            await recorder.waitFor("windowMoved", window)
        }
    },
    {
        name: "a move to another screen emits neither windowOnScreen nor windowNotOnScreen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const { recorder } = filterRecorded(t, testRules(t))
            await t.wait(SETTLE)
            recorder.clear()
            await t.frameSet(window, inside(b))
            await recorder.waitFor("windowMoved", window)
            await t.wait(SETTLE)
            const onScreenEvents = recorder.of(window).map((e) => e.event)
                .filter((e) => e === "windowOnScreen" || e === "windowNotOnScreen")
            t.assert.equal(onScreenEvents.join(", "), "", "on-screen events")
        }
    },
    {
        name: "the state of a window moved to another screen names the new screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const { recorder } = filterRecorded(t, testRules(t))
            await t.wait(SETTLE)
            recorder.clear()
            await t.frameSet(window, inside(b))
            const event = await recorder.waitFor("windowMoved", window)
            t.assert.equal(event.state.screenID, b.id, "screenID")
            t.assert.equal(event.state.screenName, b.name, "screenName")
        }
    }
]

module.exports = { screens: 2, tests }

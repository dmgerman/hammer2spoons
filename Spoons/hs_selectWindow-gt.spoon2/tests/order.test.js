// Tests of the order in which the windows are listed, as the readme describes it under "The order
// of the windows" and "order()".
//
// order() lists the user's windows as well as the test windows. The tests look only at the test
// windows, found by their titles, except where the readme says which window comes first.

// Focuses a window and waits until hs_windowfilter-gt has had time to report it.
async function focus(t, window) {
    window.focus()
    const started = Date.now()
    while (!hs.window.focusedWindow() || hs.window.focusedWindow().id !== window.id) {
        if (Date.now() - started > 3000) t.assert.fail(`"${window.title}" did not take the focus`)
        await t.wait(0.1)
    }
    await t.wait(0.5)
}

// The titles of the test windows in order(), in the order it gives them.
function testOrder(t) {
    return t.spoon.order().filter((entry) => entry.includes(t.titlePrefix)).map((entry) => entry.slice(entry.indexOf(t.titlePrefix)))
}

const titles = (...windows) => windows.map((w) => w.title).join(", ")

module.exports = [
    {
        name: "windows are listed in the order they were last focused, without the focused window",
        run: async (t) => {
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            t.assert.equal(testOrder(t).join(", "), titles(b, a), "after a, b, c")
            await focus(t, a)
            t.assert.equal(testOrder(t).join(", "), titles(c, b), "after a again")
        }
    },
    {
        name: "the first entry of order() is the window focused before the focused one",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const first = t.spoon.order()[0]
            t.assert.ok(first && first.endsWith(a.title), `the first entry is ${JSON.stringify(first)}`)
        }
    },
    {
        name: "each entry is the application's name and the window's title",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const entry = t.spoon.order().find((e) => e.endsWith(a.title))
            t.assert.equal(entry, `${a.application.name}: ${a.title}`)
        }
    },
    {
        name: "a minimized window keeps its place in the order",
        run: async (t) => {
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            b.minimize()
            await t.wait(0.8)
            t.assert.ok(b.isMinimized, "the window was not minimized")
            t.assert.equal(testOrder(t).join(", "), titles(b, a))
        }
    },
    {
        name: "a window of a hidden application keeps its place in the order",
        run: async (t) => {
            // Two processes, so that one application can be hidden while the other has the focus.
            const [a] = await t.windowsOpen(1)
            const [b] = await t.windowsOpen(1)
            await focus(t, a)
            await focus(t, b)
            const [c] = await t.windowsOpen(1)
            await focus(t, c)
            a.application.hide()
            await t.wait(0.8)
            t.assert.ok(a.application.isHidden, "the application was not hidden")
            t.assert.equal(testOrder(t).join(", "), titles(b, a))
        }
    },
    {
        name: "a closed window leaves the order",
        run: async (t) => {
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            await focus(t, b)
            await focus(t, c)
            await t.windowClose(b)
            await t.wait(0.5)
            t.assert.equal(testOrder(t).join(", "), titles(a))
        }
    },
    {
        name: "after start(), the focused window is first, and a window focused since comes before every window that was not",
        run: async (t) => {
            const [a, b, c] = await t.windowsOpen(3)
            await focus(t, a)
            t.spoon.stop()
            t.spoon.start()
            // a had the focus at start(), so it is first, and focusing b puts it second.
            await focus(t, b)
            const first = t.spoon.order()[0]
            t.assert.ok(first && first.endsWith(a.title), `the first entry after focusing b is ${JSON.stringify(first)}`)
            // b has been focused since start(), and c has not, so b comes before c and before
            // every one of the user's windows.
            await focus(t, a)
            const all = t.spoon.order()
            t.assert.ok(all[0] && all[0].endsWith(b.title), `the first entry after focusing a is ${JSON.stringify(all[0])}`)
            t.assert.equal(testOrder(t).join(", "), titles(b, c), "the test windows")
        }
    }
]

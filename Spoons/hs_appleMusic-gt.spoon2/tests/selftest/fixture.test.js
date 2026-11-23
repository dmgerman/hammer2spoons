// Tests of the window fixture, run with make test TESTS="tests/selftest/*.test.js". Two tests
// fail on purpose, with a window open, so that the test after them can check that their
// windows were closed. The first and the last test check that the user's windows did not move.

// The user's windows and their frames when the file started, by window id.
let userFrames = null

function userWindowFrames(prefix) {
    const frames = new Map()
    for (const window of hs.window.allWindows()) {
        if ((window.title || "").startsWith(prefix)) continue
        const f = window.frame
        frames.set(window.id, { title: window.title, frame: { x: f.x, y: f.y, w: f.w, h: f.h } })
    }
    return frames
}

function testWindowsOpen(prefix) {
    return hs.window.allWindows().filter((w) => (w.title || "").startsWith(prefix))
}

module.exports = [
    {
        name: "the user's windows are recorded",
        run: (t) => {
            userFrames = userWindowFrames(t.titlePrefix)
            t.assert.ok(userFrames.size > 0, "no window of the user's was found")
        }
    },
    {
        name: "a window opens, takes a frame and reads it back",
        run: async (t) => {
            const [window] = await t.windowsOpen()
            const screen = t.screenFrame(window)
            const frame = { x: screen.x + 100, y: screen.y + 50, w: 500, h: 300 }
            await t.frameSet(window, frame)
            t.assert.frameEqual(window.frame, frame)
        }
    },
    {
        name: "a fractional frame is read back within the tolerance",
        run: async (t) => {
            const [window] = await t.windowsOpen()
            const screen = t.screenFrame(window)
            const frame = { x: screen.x + 100.5, y: screen.y + 50.25, w: screen.w / 3, h: screen.h / 3 }
            await t.frameSet(window, frame)
            t.assert.frameEqual(window.frame, frame)
        }
    },
    {
        name: "two windows open, with different ids",
        run: async (t) => {
            const windows = await t.windowsOpen(2)
            t.assert.equal(windows.length, 2)
            t.assert.ok(windows[0].id !== windows[1].id, "both windows have the same id")
        }
    },
    {
        name: "a window can be focused",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            for (const window of [first, second]) {
                window.focus()
                await t.wait(0.3)
                const focused = hs.window.focusedWindow()
                t.assert.equal(focused ? focused.id : null, window.id, `focus on "${window.title}"`)
            }
        }
    },
    {
        name: "a test that fails with a window open fails (expected)",
        run: async (t) => {
            await t.windowsOpen()
            t.assert.fail("this test fails on purpose")
        }
    },
    {
        name: "a test that times out with a window open fails (expected)",
        timeout: 2,
        run: async (t) => {
            await t.windowsOpen()
            await t.wait(5)
        }
    },
    {
        name: "a test window's title can be changed",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const title = `${t.titlePrefix}renamed`
            await t.windowTitleSet(second, title)
            t.assert.equal(second.title, title, "the second window's title")
            t.assert.ok(first.title !== title, "the first window's title changed too")
        }
    },
    {
        name: "cleanup functions run after a test that fails (expected)",
        run: (t) => {
            globalThis.__fixtureCleanupRan = false
            t.cleanup(() => { globalThis.__fixtureCleanupRan = true })
            t.assert.fail("this test fails on purpose")
        }
    },
    {
        name: "the cleanup function of the failed test ran",
        run: (t) => {
            const ran = globalThis.__fixtureCleanupRan
            delete globalThis.__fixtureCleanupRan
            t.assert.equal(ran, true, "the cleanup function ran")
        }
    },
    {
        name: "a test that fails with a window minimized and its application hidden fails (expected)",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            first.minimize()
            await t.wait(0.6)
            second.application.hide()
            await t.wait(0.3)
            t.assert.fail("this test fails on purpose")
        }
    },
    {
        name: "the windows of the failed tests were closed",
        run: (t) => {
            const left = testWindowsOpen(t.titlePrefix)
            t.assert.equal(left.length, 0, `test windows still open: ${left.map((w) => w.title).join(", ")}`)
        }
    },
    {
        name: "a test that needs two screens is skipped with one",
        run: (t) => {
            t.screensNeed(2)
            t.assert.ok(hs.screen.all().length >= 2)
        }
    },
    {
        name: "the user's windows did not move",
        run: (t) => {
            t.assert.ok(userFrames, "the first test did not record the user's windows")
            const now = userWindowFrames(t.titlePrefix)
            const moved = []
            for (const [id, before] of userFrames) {
                const after = now.get(id)
                if (!after) continue // closed by the user meanwhile
                const a = after.frame, b = before.frame
                if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) moved.push(before.title)
            }
            t.assert.equal(moved.length, 0, `windows moved: ${moved.join(", ")}`)
        }
    }
]

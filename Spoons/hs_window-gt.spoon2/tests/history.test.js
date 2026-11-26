// Tests of undo, redo and the history of positions kept for each window.

// Opens one test window at a frame well inside its screen, and returns the window, the
// screen's usable frame and that starting frame.
async function windowOpen(t) {
    const [window] = await t.windowsOpen()
    const screen = t.screenFrame(window)
    const start = { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 }
    await t.frameSet(window, start)
    return { window, screen, start }
}

function part(screen, x, y, w, h) {
    return { x: screen.x + x * screen.w, y: screen.y + y * screen.h, w: w * screen.w, h: h * screen.h }
}

function copy(f) {
    return { x: f.x, y: f.y, w: f.w, h: f.h }
}

// Where leftHalf, topRight and bottomRight put a window.
const LEFT = (s) => part(s, 0, 0, 1 / 2, 1)
const TOP_RIGHT = (s) => part(s, 1 / 2, 0, 1 / 2, 1 / 2)
const BOTTOM_RIGHT = (s) => part(s, 1 / 2, 1 / 2, 1 / 2, 1 / 2)

module.exports = [
    {
        name: "undo returns a window to where it was, and redo applies the placement again",
        run: async (t) => {
            const { window, screen, start } = await windowOpen(t)
            t.spoon.leftHalf(window)
            t.assert.equal(t.spoon.undo(window), t.spoon, "undo returned")
            t.assert.frameEqual(window.frame, start, "after undo")
            t.assert.equal(t.spoon.redo(window), t.spoon, "redo returned")
            t.assert.frameEqual(window.frame, LEFT(screen), "after redo")
        }
    },
    {
        name: "several placements are undone in reverse order, and then undo stops with an alert",
        run: async (t) => {
            const { window, screen, start } = await windowOpen(t)
            t.spoon.leftHalf(window)
            t.spoon.topRight(window)
            t.spoon.bottomRight(window)
            t.assert.equal(t.spoon.historyDepth(window), 3, "historyDepth")
            const alerts = t.alertsCapture()
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, TOP_RIGHT(screen), "after the first undo")
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, LEFT(screen), "after the second undo")
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, start, "after the third undo")
            t.assert.equal(alerts.length, 0, "an alert was shown too early")
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, start, "after a fourth undo")
            t.assert.equal(alerts.join(" | "), "No further window history", "alert")
        }
    },
    {
        name: "redo after several undos returns the window to where the series began",
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            t.spoon.leftHalf(window)
            t.spoon.topRight(window)
            t.spoon.undo(window)
            t.spoon.undo(window)
            t.spoon.redo(window)
            t.assert.frameEqual(window.frame, TOP_RIGHT(screen))
        }
    },
    {
        name: "undo does not remove positions from the history",
        run: async (t) => {
            const { window } = await windowOpen(t)
            t.spoon.leftHalf(window)
            t.spoon.topRight(window)
            t.spoon.undo(window)
            t.spoon.undo(window)
            t.assert.equal(t.spoon.historyDepth(window), 2)
        }
    },
    {
        name: "a move by hand followed by undo returns first to where the command had put the window",
        run: async (t) => {
            const { window, screen, start } = await windowOpen(t)
            t.spoon.leftHalf(window)
            const byHand = { x: screen.x + 300, y: screen.y + 200, w: 450, h: 350 }
            await t.frameSet(window, byHand)
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, LEFT(screen), "after the first undo")
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, start, "after the second undo")
            t.spoon.redo(window)
            t.assert.frameEqual(window.frame, byHand, "after redo")
        }
    },
    {
        name: "a move by hand followed by a command is recorded, so undo returns to it",
        run: async (t) => {
            const { window, screen, start } = await windowOpen(t)
            t.spoon.leftHalf(window)
            const byHand = { x: screen.x + 300, y: screen.y + 200, w: 450, h: 350 }
            await t.frameSet(window, byHand)
            t.spoon.bottomRight(window)
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, byHand, "after the first undo")
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, LEFT(screen), "after the second undo")
            t.spoon.undo(window)
            t.assert.frameEqual(window.frame, start, "after the third undo")
        }
    },
    {
        name: "a position identical to the last one is not added again",
        run: async (t) => {
            const { window } = await windowOpen(t)
            t.spoon.leftHalf(window)
            t.spoon.leftHalf(window)
            t.spoon.leftHalf(window)
            // The start, and the left half once: the second and third calls each record the
            // left half, which is already the last position.
            t.assert.equal(t.spoon.historyDepth(window), 2)
        }
    },
    {
        name: "undo with no history leaves the window where it is and shows an alert",
        run: async (t) => {
            const { window, start } = await windowOpen(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.historyDepth(window), 0, "historyDepth")
            t.assert.equal(t.spoon.undo(window), t.spoon, "undo returned")
            t.assert.frameEqual(window.frame, start, "the window moved")
            t.assert.equal(alerts.join(" | "), "No window history", "alert")
        }
    },
    {
        name: "redo without a preceding undo does nothing and shows an alert",
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            t.spoon.leftHalf(window)
            const alerts = t.alertsCapture()
            t.spoon.redo(window)
            t.assert.frameEqual(window.frame, LEFT(screen), "the window moved")
            t.assert.equal(alerts.join(" | "), "Nothing to redo", "alert")
        }
    },
    {
        name: "a move after undo ends the series, so redo does nothing",
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            t.spoon.leftHalf(window)
            t.spoon.undo(window)
            t.spoon.topRight(window)
            const alerts = t.alertsCapture()
            t.spoon.redo(window)
            t.assert.frameEqual(window.frame, TOP_RIGHT(screen), "the window moved")
            t.assert.equal(alerts.join(" | "), "Nothing to redo", "alert")
        }
    },
    {
        name: "the history is kept for each window separately",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const screen = t.screenFrame(first)
            const start = { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 }
            await t.frameSet(first, start)
            await t.frameSet(second, start)
            t.spoon.leftHalf(first)
            t.spoon.topRight(second)
            t.spoon.undo(first)
            t.assert.frameEqual(first.frame, start, "the first window after its undo")
            t.assert.frameEqual(second.frame, TOP_RIGHT(screen), "the second window")
        }
    },
    {
        name: "historyClear forgets every window's history",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            t.spoon.leftHalf(first)
            t.spoon.rightHalf(second)
            t.assert.equal(t.spoon.historyClear(), t.spoon, "historyClear returned")
            t.assert.equal(t.spoon.historyDepth(first), 0, "the first window's history")
            t.assert.equal(t.spoon.historyDepth(second), 0, "the second window's history")
        }
    },
    {
        name: "a window's history is forgotten when the window closes",
        run: async (t) => {
            const { window } = await windowOpen(t)
            t.spoon.leftHalf(window)
            const id = window.id
            t.assert.equal(t.spoon.historyDepth({ id }), 1, "historyDepth before closing")
            await t.windowClose(window)
            // hs.windowfilter reports the closing a little after the window has gone.
            const started = Date.now()
            while (t.spoon.historyDepth({ id }) !== 0 && Date.now() - started < 3000) await t.wait(0.1)
            t.assert.equal(t.spoon.historyDepth({ id }), 0, "historyDepth after closing")
        }
    },
    {
        name: "swapping two windows adds a position to each, and undo on either returns it",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const screen = t.screenFrame(first)
            const a = { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 }
            const b = { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 }
            await t.frameSet(first, a)
            await t.frameSet(second, b)
            t.assert.equal(t.spoon.windowWithWindowSwap(second, first), true, "swap returned")
            await t.wait(0.5)
            t.assert.frameEqual(first.frame, b, "the first window after the swap")
            t.assert.equal(t.spoon.historyDepth(first), 1, "the first window's historyDepth")
            t.assert.equal(t.spoon.historyDepth(second), 1, "the second window's historyDepth")
            t.spoon.undo(first)
            t.spoon.undo(second)
            t.assert.frameEqual(first.frame, a, "the first window after undo")
            t.assert.frameEqual(second.frame, b, "the second window after undo")
        }
    },
    {
        name: "tiling two windows adds a position to each, and undo on either returns it",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const screen = t.screenFrame(first)
            const a = { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 }
            const b = { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 }
            await t.frameSet(first, a)
            await t.frameSet(second, b)
            t.assert.equal(t.spoon.tileWith(second, first), true, "tileWith returned")
            await t.wait(0.5)
            t.spoon.undo(first)
            t.spoon.undo(second)
            t.assert.frameEqual(first.frame, a, "the first window after undo")
            t.assert.frameEqual(second.frame, b, "the second window after undo")
        }
    },
    {
        name: "the history keeps at most config.historySize positions, discarding the oldest",
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            const historySize = t.spoon.config.historySize
            t.spoon.config.historySize = 3
            try {
                // Each move records where the window was before it: the start, the left half,
                // the top right, the bottom right and the right half. Only the last three are
                // kept, so the third undo reaches the top right and no further.
                for (const placement of ["leftHalf", "topRight", "bottomRight", "rightHalf", "topLeft"]) {
                    t.spoon[placement](window)
                }
                t.assert.equal(t.spoon.historyDepth(window), 3, "historyDepth")
                t.spoon.undo(window)
                t.spoon.undo(window)
                t.spoon.undo(window)
                t.assert.frameEqual(window.frame, TOP_RIGHT(screen), "after three undos")
            } finally {
                t.spoon.config.historySize = historySize
            }
        }
    }
]

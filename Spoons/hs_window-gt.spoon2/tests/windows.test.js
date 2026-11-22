// Tests of the functions that act on two windows or change which window has the focus, with
// both windows on one screen. The same functions across two screens are tested in
// two-screens.test.js.

function part(screen, x, y, w, h) {
    return { x: screen.x + x * screen.w, y: screen.y + y * screen.h, w: w * screen.w, h: h * screen.h }
}

function copy(f) {
    return { x: f.x, y: f.y, w: f.w, h: f.h }
}

// Opens two test windows at two different frames on the same screen, and returns them with
// the screen's usable frame and their frames.
async function twoOpen(t) {
    const [first, second] = await t.windowsOpen(2)
    const screen = t.screenFrame(first)
    const a = { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 }
    const b = { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 }
    await t.frameSet(first, a)
    await t.frameSet(second, b)
    return { first, second, screen, a, b }
}

function focusedId() {
    const window = hs.window.focusedWindow()
    return window ? window.id : null
}

// Focuses a window directly, not through the Spoon, and waits for hs_windowfilter-gt to report
// it to the Spoon.
async function focus(t, window) {
    window.focus()
    await t.wait(0.4)
}

// Waits until the Spoon's delayed second assertion of the focus has run.
function reassertWait(t) {
    return t.wait(t.spoon.config.focusReassertDelay + 0.3)
}

module.exports = [
    {
        name: "windowFocus focuses a window, and it still has the focus after the second assertion",
        run: async (t) => {
            const { first, second } = await twoOpen(t)
            await focus(t, second)
            t.assert.equal(t.spoon.windowFocus(first), true, "windowFocus returned")
            await t.wait(0.2)
            t.assert.equal(focusedId(), first.id, "the focused window")
            await reassertWait(t)
            t.assert.equal(focusedId(), first.id, "the focused window after the second assertion")
            t.assert.equal(hs.window.orderedWindows()[0].id, first.id, "the frontmost window")
        }
    },
    {
        name: "tileWith puts the other window on the left half and this one on the right, with the focus",
        run: async (t) => {
            const { first, second, screen } = await twoOpen(t)
            t.assert.equal(t.spoon.tileWith(second, first), true, "tileWith returned")
            await reassertWait(t)
            t.assert.frameEqual(second.frame, part(screen, 0, 0, 1 / 2, 1), "the other window")
            t.assert.frameEqual(first.frame, part(screen, 1 / 2, 0, 1 / 2, 1), "this window")
            t.assert.equal(focusedId(), first.id, "the focused window")
        }
    },
    {
        name: "tileWith refuses to tile a window with itself",
        run: async (t) => {
            const { first, a } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.tileWith(first, first), false)
            t.assert.frameEqual(first.frame, a, "the window moved")
            t.assert.equal(alerts.join(" | "), "A window cannot be tiled with itself", "alert")
        }
    },
    {
        name: "windowWithWindowSwap exchanges the frames of two windows, and focuses this one",
        run: async (t) => {
            const { first, second, a, b } = await twoOpen(t)
            t.assert.equal(t.spoon.windowWithWindowSwap(second, first), true, "returned")
            await reassertWait(t)
            t.assert.frameEqual(first.frame, b, "this window")
            t.assert.frameEqual(second.frame, a, "the other window")
            t.assert.equal(focusedId(), first.id, "the focused window")
        }
    },
    {
        name: "windowWithWindowSwap refuses to swap a window with itself",
        run: async (t) => {
            const { first, a } = await twoOpen(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.windowWithWindowSwap(first, first), false)
            t.assert.frameEqual(first.frame, a, "the window moved")
            t.assert.equal(alerts.join(" | "), "A window cannot be swapped with itself", "alert")
        }
    },
    {
        name: "windowWithPreviousSwap exchanges a window with the window directly behind it",
        run: async (t) => {
            const { first, second, a, b } = await twoOpen(t)
            await focus(t, second)
            await focus(t, first)
            t.assert.equal(t.spoon.windowWithPreviousSwap(first), true, "returned")
            await reassertWait(t)
            t.assert.frameEqual(first.frame, b, "this window")
            t.assert.frameEqual(second.frame, a, "the window behind it")
        }
    },
    {
        name: "windowPrevious focuses the window that had the focus before",
        run: async (t) => {
            const { first, second } = await twoOpen(t)
            await focus(t, first)
            await focus(t, second)
            t.assert.equal(t.spoon.windowPrevious(), true, "returned")
            await t.wait(0.3)
            t.assert.equal(focusedId(), first.id, "the focused window")
        }
    },
    {
        name: "windowPrevious called twice returns to the window it started from",
        run: async (t) => {
            const { first, second } = await twoOpen(t)
            await focus(t, first)
            await focus(t, second)
            t.spoon.windowPrevious()
            await reassertWait(t)
            t.spoon.windowPrevious()
            await reassertWait(t)
            t.assert.equal(focusedId(), second.id, "the focused window")
        }
    },
    {
        name: "windowToBackSend puts a window behind the others, without moving any window",
        timeout: 60,
        run: async (t) => {
            const { first, second } = await twoOpen(t)
            await focus(t, second)
            await focus(t, first)
            const frames = new Map(hs.window.orderedWindows().map((w) => [w.id, { title: w.title, frame: copy(w.frame) }]))
            t.assert.equal(t.spoon.windowToBackSend(first), true, "returned")
            await t.wait(1)
            const ordered = hs.window.orderedWindows().map((w) => w.id)
            t.assert.ok(ordered.indexOf(second.id) < ordered.indexOf(first.id), "the other test window is not in front of it")
            t.assert.ok(focusedId() !== first.id, "the window still has the focus")
            const moved = []
            for (const window of hs.window.orderedWindows()) {
                const before = frames.get(window.id)
                if (!before) continue
                const f = window.frame, g = before.frame
                if (f.x !== g.x || f.y !== g.y || f.w !== g.w || f.h !== g.h) moved.push(before.title)
            }
            t.assert.equal(moved.length, 0, `windows moved: ${moved.join(", ")}`)
        }
    },
    {
        name: "tileWith returns null when the chooser of the other window is dismissed",
        run: async (t) => {
            const { first, a } = await twoOpen(t)
            const cancelled = t.promptCancel()
            const result = await t.spoon.tileWith(undefined, first)
            await cancelled
            t.assert.equal(result, null, "returned")
            t.assert.frameEqual(first.frame, a, "the window moved")
        }
    },
    {
        name: "windowWithWindowSwap returns null when the chooser of the other window is dismissed",
        run: async (t) => {
            const { first, a } = await twoOpen(t)
            const cancelled = t.promptCancel()
            const result = await t.spoon.windowWithWindowSwap(undefined, first)
            await cancelled
            t.assert.equal(result, null, "returned")
            t.assert.frameEqual(first.frame, a, "the window moved")
        }
    }
]

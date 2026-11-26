// Every test of hs_window-gt that needs two screens. With fewer connected, the harness reports
// each of them as skipped without running it. make test-two-screens runs this file alone.
//
// The screens are taken in the order of hs.screen.all(), which is the order the Spoon's "next"
// and "previous" follow. The tests use the first two screens, and a third when one is
// connected.

function copy(f) {
    return { x: f.x, y: f.y, w: f.w, h: f.h }
}

function centerOf(f) {
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 }
}

// A frame within a screen's usable frame, given as fractions of it.
function within(screen, x, y, w, h) {
    const f = screen.frame
    return { x: f.x + x * f.w, y: f.y + y * f.h, w: w * f.w, h: h * f.h }
}

// The frame the Spoon gives a window moved from one screen to another without a remembered
// frame: the same place and size relative to the screen.
function proportional(frame, from, to) {
    const a = from.frame, b = to.frame
    return {
        x: b.x + ((frame.x - a.x) / a.w) * b.w,
        y: b.y + ((frame.y - a.y) / a.h) * b.h,
        w: frame.w * (b.w / a.w),
        h: frame.h * (b.h / a.h)
    }
}

function pointerAt(t, x, y, message) {
    const p = hs.mouse.absolutePosition()
    if (Math.abs(p.x - x) > 1 || Math.abs(p.y - y) > 1) {
        t.assert.fail(`${message ? message + ": " : ""}expected the pointer at (${x}, ${y}), got (${p.x}, ${p.y})`)
    }
}

// Opens a test window on a screen, at a frame given as fractions of that screen.
async function windowOn(t, screen, x = 0.1, y = 0.1, w = 0.3, h = 0.4) {
    const [window] = await t.windowsOpen()
    await t.frameSet(window, within(screen, x, y, w, h))
    return window
}

// Puts a window into fullscreen and waits until the Space switch has finished.
async function fullscreenEnter(t, window) {
    window.focus()
    await t.wait(0.4)
    window.toggleFullscreen()
    const started = Date.now()
    while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
    t.assert.ok(window.isFullscreen, `"${window.title}" did not enter fullscreen`)
    await t.wait(1.5)
}

// The front window of a screen, from the stacking order of the Space it shows, among the windows
// given.
function frontOf(screen, windows) {
    const space = (screen.spaces || []).find((s) => s.isCurrent)
    const ids = new Set(windows.map((w) => w.id))
    return space ? space.windowIDs().find((id) => ids.has(id)) || null : null
}

const tests = [
    {
        name: "windowToScreenMove next moves a window to the next screen, keeping its place relative to the screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const before = copy(window.frame)
            t.assert.equal(t.spoon.windowToScreenMove("next", window), true, "returned")
            await t.wait(0.3)
            t.assert.equal(window.screen.id, b.id, "the window's screen")
            t.assert.frameEqual(window.frame, proportional(before, a, b))
        }
    },
    {
        name: "windowToScreenMove previous returns a window to the frame it had on that screen",
        run: async (t) => {
            const [a] = hs.screen.all()
            const window = await windowOn(t, a)
            const before = copy(window.frame)
            t.spoon.windowToScreenMove("next", window)
            await t.wait(0.3)
            t.assert.equal(t.spoon.windowToScreenMove("previous", window), true, "returned")
            await t.wait(0.3)
            t.assert.equal(window.screen.id, a.id, "the window's screen")
            t.assert.frameEqual(window.frame, before)
        }
    },
    {
        name: "windowToScreenMove to a given screen moves the window there",
        run: async (t) => {
            // The target is the last screen not showing a fullscreen window: a move onto one that
            // is showing one is refused, which another test checks.
            const screens = hs.screen.all()
            const occupied = t.spoon.fullscreenScreenIds()
            const a = screens[0]
            const target = screens.slice(1).reverse().find((s) => !occupied.has(s.id))
            if (!target) t.skip("every screen but the first is showing a fullscreen window")
            const window = await windowOn(t, a)
            const before = copy(window.frame)
            t.assert.equal(t.spoon.windowToScreenMove(target, window), true, "returned")
            await t.wait(0.3)
            t.assert.equal(window.screen.id, target.id, "the window's screen")
            t.assert.frameEqual(window.frame, proportional(before, a, target))
        }
    },
    {
        name: "a window returning to a screen takes the frame it last had there",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            t.spoon.windowToScreenMove(b, window)
            await t.wait(0.3)
            // Placed somewhere of its own on b, through the Spoon.
            t.spoon.bottomRight(window)
            await t.wait(0.3)
            const onB = copy(window.frame)
            t.spoon.windowToScreenMove(a, window)
            await t.wait(0.3)
            t.spoon.windowToScreenMove(b, window)
            await t.wait(0.3)
            t.assert.frameEqual(window.frame, onB)
        }
    },
    {
        // Hammerspoon 2 itself, without this Spoon: the sequence of frames in issue #423, which
        // cut the window at the right edge of the screen it left. Hammerspoon 2 fixed it in pull
        // request #429 (8e595e8a), and the test is kept so that the defect is noticed if it
        // returns. The Spoon never worked around it.
        name: "Hammerspoon 2 gives a window the full width of a frame set on another screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const target = within(b, 1 / 2, 1 / 2, 1 / 2, 1 / 2)
            const aRight = a.fullFrame.x + a.fullFrame.w
            // The defect cuts the width at the right edge of the screen the window leaves, so
            // it can only show when the target frame crosses that edge.
            if (!(target.x < aRight && target.x + target.w > aRight)) {
                t.skip("on these screens, the target frame does not cross the first screen's right edge")
            }
            const [window] = await t.windowsOpen()
            const start = within(a, 0.1, 0.1, 0.3, 0.4)
            for (const frame of [start, within(b, 0.1, 0.1, 0.3, 0.4), target, start]) {
                window.frame = new HSRect(frame.x, frame.y, frame.w, frame.h)
                await t.wait(0.3)
            }
            window.frame = new HSRect(target.x, target.y, target.w, target.h)
            await t.wait(0.3)
            t.assert.frameEqual(window.frame, target)
        }
    },
    {
        name: "a window resized by hand does not take the frame it last had on the other screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            t.spoon.windowToScreenMove(b, window)
            await t.wait(0.3)
            t.spoon.bottomRight(window)
            await t.wait(0.3)
            t.spoon.windowToScreenMove(a, window)
            await t.wait(0.3)
            const byHand = within(a, 0.2, 0.2, 0.25, 0.3)
            await t.frameSet(window, byHand)
            t.spoon.windowToScreenMove(b, window)
            await t.wait(0.3)
            t.assert.frameEqual(window.frame, proportional(byHand, a, b))
        }
    },
    {
        name: "windowToScreenMove returns null when its chooser of screens is dismissed",
        run: async (t) => {
            const [a] = hs.screen.all()
            const window = await windowOn(t, a)
            const before = copy(window.frame)
            const cancelled = t.promptCancel()
            const result = await t.spoon.windowToScreenMove(undefined, window)
            await cancelled
            t.assert.equal(result, null, "returned")
            t.assert.frameEqual(window.frame, before, "the window moved")
        }
    },
    {
        name: "windowToScreenMove moves a fullscreen window, which is fullscreen on the new screen",
        timeout: 25,
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            await fullscreenEnter(t, window)
            const result = await t.spoon.windowToScreenMove(b, window)
            t.assert.equal(result, true, "returned")
            const started = Date.now()
            while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            await t.wait(1.5)
            t.assert.ok(window.isFullscreen, "the window is not fullscreen")
            t.assert.equal(window.screen.id, b.id, "the window's screen")
        }
    },
    {
        name: "windowToScreenMove refuses a screen showing a fullscreen window",
        timeout: 25,
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const blocker = await windowOn(t, b)
            await fullscreenEnter(t, blocker)
            t.assert.equal(t.spoon.fullscreenScreenIds().has(b.id), true, "fullscreenScreenIds")
            t.assert.equal(t.spoon.screenHasFullscreenWindow(b), true, "screenHasFullscreenWindow")
            const window = await windowOn(t, a)
            const before = copy(window.frame)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.windowToScreenMove(b, window), false, "returned")
            t.assert.frameEqual(window.frame, before, "the window moved")
            t.assert.equal(alerts.join(" | "), "That screen is showing a fullscreen window", "alert")
        }
    },
    {
        name: "windowToScreenMove next skips a screen showing a fullscreen window, or refuses when every other one does",
        timeout: 40,
        run: async (t) => {
            const screens = hs.screen.all()
            const a = screens[0]
            const others = screens.slice(1)
            for (const screen of others) await fullscreenEnter(t, await windowOn(t, screen))
            const window = await windowOn(t, a)
            const before = copy(window.frame)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.windowToScreenMove("next", window), false, "returned")
            t.assert.frameEqual(window.frame, before, "the window moved")
            t.assert.equal(alerts.join(" | "), "Every other screen has a fullscreen window", "alert")
        }
    },
    {
        name: "mouseScreenCenter puts the pointer in the middle of another screen",
        run: (t) => {
            const screens = hs.screen.all()
            const target = screens[screens.length - 1]
            t.assert.equal(t.spoon.mouseScreenCenter(target), true, "returned")
            const c = centerOf(target.fullFrame)
            pointerAt(t, c.x, c.y)
        }
    },
    {
        name: "mouseScreenCenterNext goes through every screen in turn and starts again",
        run: (t) => {
            const screens = hs.screen.all()
            const c0 = centerOf(screens[0].fullFrame)
            hs.mouse.setAbsolutePosition(c0.x, c0.y)
            for (let i = 1; i <= screens.length; i++) {
                const target = screens[i % screens.length]
                t.assert.equal(t.spoon.mouseScreenCenterNext(), true, `call ${i} returned`)
                const c = centerOf(target.fullFrame)
                pointerAt(t, c.x, c.y, `call ${i}`)
            }
        }
    },
    {
        name: "tileWith brings the other window from another screen, on the left half of this window's screen",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const other = await windowOn(t, b)
            t.assert.equal(t.spoon.tileWith(other, window), true, "returned")
            await t.wait(0.6)
            t.assert.equal(other.screen.id, a.id, "the other window's screen")
            t.assert.frameEqual(other.frame, within(a, 0, 0, 1 / 2, 1), "the other window")
            t.assert.frameEqual(window.frame, within(a, 1 / 2, 0, 1 / 2, 1), "this window")
        }
    },
    {
        name: "windowWithWindowSwap exchanges two windows on different screens",
        run: async (t) => {
            const [a, b] = hs.screen.all()
            const window = await windowOn(t, a)
            const other = await windowOn(t, b, 0.5, 0.4, 0.3, 0.3)
            const mine = copy(window.frame), theirs = copy(other.frame)
            t.assert.equal(t.spoon.windowWithWindowSwap(other, window), true, "returned")
            await t.wait(0.6)
            t.assert.equal(window.screen.id, b.id, "this window's screen")
            t.assert.equal(other.screen.id, a.id, "the other window's screen")
            t.assert.frameEqual(window.frame, theirs, "this window")
            t.assert.frameEqual(other.frame, mine, "the other window")
        }
    }
]

tests.push({
    // An application that is activated can bring forward the window it last had as its main
    // window: Google Chrome did, on 2026-11-23 (hammer2spoons-ei6.50). The test windows do not
    // behave that way, so the test does it itself: right after the switch, it raises the other
    // window of the same application, as Chrome would.
    name: "windowFocus raises again another screen's front window that a window of the same application covered",
    run: async (t) => {
        const [a, b] = hs.screen.all()
        const [p1, p2] = await t.windowsOpen(2)
        const [q] = await t.windowsOpen(1)
        await t.frameSet(p1, within(b, 0.1, 0.1, 0.4, 0.5))
        await t.frameSet(q, within(b, 0.15, 0.15, 0.4, 0.5))
        await t.frameSet(p2, within(a, 0.1, 0.1, 0.4, 0.5))
        for (const window of [p2, p1, q]) {
            window.focus()
            await t.wait(0.4)
        }
        t.assert.equal(frontOf(b, [p1, q]), q.id, "the front window of the second screen before the switch")
        t.spoon.windowFocus(p2)
        await t.wait(0.05)
        p1.raise()
        await t.wait(0.05)
        t.assert.equal(frontOf(b, [p1, q]), p1.id, "the other window of the same application covered it")
        await t.wait(1.0)
        t.assert.equal(frontOf(b, [p1, q]), q.id, "the front window of the second screen after the switch")
        const focused = hs.window.focusedWindow()
        t.assert.equal(focused ? focused.id : null, p2.id, "the focused window")
    }
})

module.exports = { screens: 2, tests }

// Tests of the pointer functions and of the screen functions that work on one screen. The
// same functions across two screens are tested in two-screens.test.js. The harness puts the
// pointer back after each test.

// Points by which the pointer's position may differ from the point it was sent to. The
// position is read back with fractions of a point.
const POINTER_TOLERANCE = 1

function pointerAt(t, x, y, message) {
    const p = hs.mouse.absolutePosition()
    if (Math.abs(p.x - x) > POINTER_TOLERANCE || Math.abs(p.y - y) > POINTER_TOLERANCE) {
        t.assert.fail(`${message ? message + ": " : ""}expected the pointer at (${x}, ${y}), got (${p.x}, ${p.y})`)
    }
}

function centerOf(f) {
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 }
}

// Whether a canvas is still on screen. A destroyed canvas may throw instead of answering.
function showing(canvas) {
    try {
        return canvas.isShowing()
    } catch (e) {
        return false
    }
}

// The tests that check a refusal for having only one screen are skipped when there are more.
function oneScreenNeed(t) {
    const connected = hs.screen.all().length
    if (connected > 1) t.skip(`needs exactly one screen, and ${connected} are connected`)
}

// Opens a test window, puts it inside its screen and focuses it.
async function windowOpen(t) {
    const [window] = await t.windowsOpen()
    const screen = t.screenFrame(window)
    await t.frameSet(window, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
    window.focus()
    await t.wait(0.4)
    return window
}

module.exports = [
    {
        name: "mouseMove puts the pointer at a point",
        run: (t) => {
            const screen = hs.screen.primary().frame
            const x = screen.x + 300, y = screen.y + 200
            t.assert.equal(t.spoon.mouseMove(x, y), true, "returned")
            pointerAt(t, x, y)
        }
    },
    {
        name: "mouseMove draws a ring around the pointer, which is removed after config.mouseHighlightSeconds",
        run: async (t) => {
            const canvases = t.canvasesCapture()
            const screen = hs.screen.primary().frame
            const x = screen.x + 300, y = screen.y + 200
            t.spoon.mouseMove(x, y)
            t.assert.equal(canvases.length, 1, "canvases created")
            const { frame, canvas } = canvases[0]
            const box = t.spoon.config.mouseHighlightSize + t.spoon.config.mouseHighlightWidth
            t.assert.equal(frame.w, box, "the canvas's width")
            t.assert.equal(frame.h, box, "the canvas's height")
            t.assert.equal(frame.x + frame.w / 2, x, "the canvas's horizontal centre")
            // A canvas is placed in screen coordinates, with y = 0 at the top of the primary screen.
            t.assert.equal(frame.y + frame.h / 2, y, "the canvas's vertical centre")
            const ring = canvas.canvasElements()[0]
            t.assert.equal(ring.type, "circle", "the element")
            t.assert.equal(ring.action, "stroke", "the element's action")
            t.assert.equal(ring.radius, t.spoon.config.mouseHighlightSize / 2, "the ring's radius")
            t.assert.equal(ring.strokeWidth, t.spoon.config.mouseHighlightWidth, "the ring's line width")
            t.assert.ok(showing(canvas), "the ring is not shown")
            await t.wait(t.spoon.config.mouseHighlightSeconds + 0.3)
            t.assert.ok(!showing(canvas), "the ring is still shown")
        }
    },
    {
        name: "a second ring removes the first",
        run: (t) => {
            const canvases = t.canvasesCapture()
            const screen = hs.screen.primary().frame
            t.spoon.mouseHighlight(screen.x + 300, screen.y + 200)
            t.spoon.mouseHighlight(screen.x + 400, screen.y + 300)
            t.assert.equal(canvases.length, 2, "canvases created")
            t.assert.ok(!showing(canvases[0].canvas), "the first ring is still shown")
            t.assert.ok(showing(canvases[1].canvas), "the second ring is not shown")
        }
    },
    {
        name: "mouseHighlight draws a ring without moving the pointer",
        run: (t) => {
            const before = hs.mouse.absolutePosition()
            const canvases = t.canvasesCapture()
            const screen = hs.screen.primary().frame
            t.spoon.mouseHighlight(screen.x + 300, screen.y + 200)
            t.assert.equal(canvases.length, 1, "canvases created")
            pointerAt(t, before.x, before.y, "the pointer moved")
        }
    },
    {
        name: "mouseWindowCenter puts the pointer in the middle of a window",
        run: async (t) => {
            const window = await windowOpen(t)
            t.assert.equal(t.spoon.mouseWindowCenter(window), true, "returned")
            const c = centerOf(window.frame)
            pointerAt(t, c.x, c.y)
        }
    },
    {
        name: "mouseWindowCenter called without a window uses the focused window",
        run: async (t) => {
            const window = await windowOpen(t)
            t.assert.equal(t.spoon.mouseWindowCenter(), true, "returned")
            const c = centerOf(window.frame)
            pointerAt(t, c.x, c.y)
        }
    },
    {
        name: "mouseWindowCenterNext puts the pointer in the middle of a different window on each call",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const screen = t.screenFrame(first)
            await t.frameSet(first, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
            await t.frameSet(second, { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 })
            first.focus()
            await t.wait(0.4)
            const centres = hs.window.allWindows().map((w) => centerOf(w.frame))
            const reached = []
            for (let i = 0; i < 2; i++) {
                t.assert.equal(t.spoon.mouseWindowCenterNext(), true, `call ${i + 1} returned`)
                const p = hs.mouse.absolutePosition()
                const match = centres.some((c) => Math.abs(c.x - p.x) <= POINTER_TOLERANCE && Math.abs(c.y - p.y) <= POINTER_TOLERANCE)
                t.assert.ok(match, `call ${i + 1} put the pointer at (${p.x}, ${p.y}), which is not the middle of any window`)
                reached.push(`${Math.round(p.x)},${Math.round(p.y)}`)
            }
            t.assert.ok(reached[0] !== reached[1], "both calls put the pointer in the same place")
        }
    },
    {
        name: "mouseScreenCenter puts the pointer in the middle of a given screen",
        run: (t) => {
            const screen = hs.screen.primary()
            t.assert.equal(t.spoon.mouseScreenCenter(screen), true, "returned")
            const c = centerOf(screen.fullFrame)
            pointerAt(t, c.x, c.y)
        }
    },
    {
        name: "mouseScreenCenter called without a screen uses the focused window's screen",
        run: async (t) => {
            const window = await windowOpen(t)
            t.assert.equal(t.spoon.mouseScreenCenter(), true, "returned")
            const c = centerOf(window.screen.fullFrame)
            pointerAt(t, c.x, c.y)
        }
    },
    {
        name: "mouseScreenCenterNext refuses with an alert when there is only one screen",
        run: (t) => {
            oneScreenNeed(t)
            const before = hs.mouse.absolutePosition()
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.mouseScreenCenterNext(), false, "returned")
            pointerAt(t, before.x, before.y, "the pointer moved")
            t.assert.equal(alerts.join(" | "), "Only one screen", "alert")
        }
    },
    {
        name: "windowToScreenMove refuses with an alert when there is only one screen",
        run: async (t) => {
            oneScreenNeed(t)
            const window = await windowOpen(t)
            const before = window.frame
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.windowToScreenMove("next", window), false, "returned")
            t.assert.frameEqual(window.frame, before, "the window moved")
            t.assert.equal(alerts.join(" | "), "Only one screen", "alert")
        }
    },
    {
        name: "windowToScreenMove to the window's own screen does nothing",
        run: async (t) => {
            const window = await windowOpen(t)
            const before = window.frame
            t.assert.equal(t.spoon.windowToScreenMove(window.screen, window), false, "returned")
            t.assert.frameEqual(window.frame, before, "the window moved")
        }
    },
    {
        name: "no screen is reported as showing a fullscreen window when none is",
        run: async (t) => {
            const window = await windowOpen(t)
            t.assert.equal(t.spoon.fullscreenScreenIds().has(window.screen.id), false, "fullscreenScreenIds")
            t.assert.equal(t.spoon.screenHasFullscreenWindow(window.screen), false, "screenHasFullscreenWindow")
        }
    },
    {
        name: "a screen showing a fullscreen window is reported, and the window cannot be swapped",
        timeout: 20,
        run: async (t) => {
            const [window, other] = await t.windowsOpen(2)
            window.focus()
            await t.wait(0.4)
            window.toggleFullscreen()
            const started = Date.now()
            while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            t.assert.ok(window.isFullscreen, "the window did not enter fullscreen")
            // The Space switch takes about a second to finish.
            await t.wait(1.5)
            const screen = window.screen
            t.assert.equal(t.spoon.fullscreenScreenIds().has(screen.id), true, "fullscreenScreenIds")
            t.assert.equal(t.spoon.screenHasFullscreenWindow(screen), true, "screenHasFullscreenWindow")
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.windowWithWindowSwap(other, window), false, "windowWithWindowSwap returned")
            t.assert.equal(alerts.join(" | "), "A fullscreen window cannot be moved", "alert")
        }
    },
    {
        // An application that turns its Accessibility API off, such as Firefox in kiosk mode,
        // has windows that hs.window.windowAtPoint() cannot find. windowAtPoint() is replaced by
        // one that finds nothing, so the screen must be recognised without it.
        name: "a screen showing a fullscreen window is reported even when hs.window cannot find that window",
        timeout: 20,
        run: async (t) => {
            const [window] = await t.windowsOpen()
            window.focus()
            await t.wait(0.4)
            window.toggleFullscreen()
            const started = Date.now()
            while (!window.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            t.assert.ok(window.isFullscreen, "the window did not enter fullscreen")
            // The Space switch takes about a second to finish.
            await t.wait(1.5)
            const screen = window.screen
            const original = hs.window.windowAtPoint
            const own = Object.prototype.hasOwnProperty.call(hs.window, "windowAtPoint")
            hs.window.windowAtPoint = () => null
            try {
                t.assert.equal(t.spoon.fullscreenScreenIds().has(screen.id), true, "fullscreenScreenIds")
            } finally {
                if (own) hs.window.windowAtPoint = original
                else delete hs.window.windowAtPoint
            }
        }
    }
]

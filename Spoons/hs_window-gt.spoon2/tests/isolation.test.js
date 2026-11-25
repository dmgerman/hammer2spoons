// Tests of isolation, info() and screenshot().

// Points by which a panel's edge may differ from the window's edge, because a window's frame
// is rounded to whole points.
const EDGE_TOLERANCE = 1

// A canvas's frame. Canvases are placed in screen coordinates, with y = 0 at the top of the
// primary screen, as screens and windows are.
function canvasScreenFrame(canvas) {
    const f = canvas.frame()
    return { x: f.x, y: f.y, w: f.w, h: f.h }
}

function showing(canvas) {
    try {
        return canvas.isShowing()
    } catch (e) {
        return false
    }
}

// The panels that should leave a window uncovered: four around it on its screen, and one over
// each other screen. Panels of no size are left out, as the Spoon leaves them out.
function panelsExpected(window) {
    const w = window.frame
    const rects = []
    for (const screen of hs.screen.all()) {
        const f = screen.fullFrame
        if (screen.id !== window.screen.id) {
            rects.push({ x: f.x, y: f.y, w: f.w, h: f.h })
            continue
        }
        rects.push({ x: f.x, y: f.y, w: f.w, h: w.y - f.y })
        rects.push({ x: f.x, y: w.y + w.h, w: f.w, h: f.y + f.h - (w.y + w.h) })
        rects.push({ x: f.x, y: w.y, w: w.x - f.x, h: w.h })
        rects.push({ x: w.x + w.w, y: w.y, w: f.x + f.w - (w.x + w.w), h: w.h })
    }
    return rects.filter((r) => r.w > 0 && r.h > 0)
}

// Checks that the panels on screen are exactly the expected ones, in any order.
function panelsCheck(t, canvases, window, message) {
    const shown = canvases.filter((c) => showing(c.canvas)).map((c) => canvasScreenFrame(c.canvas))
    const expected = panelsExpected(window)
    t.assert.equal(shown.length, expected.length, `${message}: the number of panels`)
    for (const rect of expected) {
        const found = shown.some((s) => ["x", "y", "w", "h"].every((k) => Math.abs(s[k] - rect[k]) <= EDGE_TOLERANCE))
        t.assert.ok(found, `${message}: no panel at {x: ${rect.x}, y: ${rect.y}, w: ${rect.w}, h: ${rect.h}}`)
    }
}

// Opens two test windows at two different frames, focuses the first, and returns them.
async function twoOpen(t) {
    const [first, second] = await t.windowsOpen(2)
    const screen = t.screenFrame(first)
    await t.frameSet(first, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
    await t.frameSet(second, { x: screen.x + 700, y: screen.y + 300, w: 400, h: 300 })
    first.focus()
    await t.wait(0.4)
    return { first, second, screen }
}

module.exports = [
    {
        name: "isolationStart dims everything except the focused window",
        run: async (t) => {
            const { first } = await twoOpen(t)
            const canvases = t.canvasesCapture()
            try {
                t.assert.equal(t.spoon.isolationOn(), false, "isolationOn before")
                t.assert.equal(t.spoon.isolationStart(), t.spoon, "isolationStart returned")
                t.assert.equal(t.spoon.isolationOn(), true, "isolationOn after")
                panelsCheck(t, canvases, first, "after isolationStart")
            } finally {
                t.spoon.isolationStop()
            }
        }
    },
    {
        name: "the panels have config.isolationColor and config.isolationOpacity",
        run: async (t) => {
            await twoOpen(t)
            const canvases = t.canvasesCapture()
            try {
                t.spoon.isolationStart()
                t.assert.ok(canvases.length > 0, "no panel was drawn")
                const fill = canvases[0].canvas.canvasElements()[0].fillColor
                // The default colour is black.
                t.assert.equal(fill.red, 0, "red")
                t.assert.equal(fill.green, 0, "green")
                t.assert.equal(fill.blue, 0, "blue")
                t.assert.ok(Math.abs(fill.alpha - t.spoon.config.isolationOpacity) < 0.01,
                    `alpha: expected ${t.spoon.config.isolationOpacity}, got ${fill.alpha}`)
            } finally {
                t.spoon.isolationStop()
            }
        }
    },
    {
        name: "the uncovered area follows the focus to another window",
        run: async (t) => {
            const { second } = await twoOpen(t)
            const canvases = t.canvasesCapture()
            try {
                t.spoon.isolationStart()
                second.focus()
                await t.wait(0.6)
                panelsCheck(t, canvases, second, "after focusing the second window")
            } finally {
                t.spoon.isolationStop()
            }
        }
    },
    {
        name: "the uncovered area follows the focused window when it moves",
        run: async (t) => {
            const { first, screen } = await twoOpen(t)
            const canvases = t.canvasesCapture()
            try {
                t.spoon.isolationStart()
                await t.frameSet(first, { x: screen.x + 300, y: screen.y + 200, w: 450, h: 350 })
                await t.wait(0.4)
                panelsCheck(t, canvases, first, "after moving the window")
            } finally {
                t.spoon.isolationStop()
            }
        }
    },
    {
        name: "isolationStop removes every panel",
        run: async (t) => {
            await twoOpen(t)
            const canvases = t.canvasesCapture()
            t.spoon.isolationStart()
            t.assert.equal(t.spoon.isolationStop(), t.spoon, "isolationStop returned")
            t.assert.equal(t.spoon.isolationOn(), false, "isolationOn")
            const left = canvases.filter((c) => showing(c.canvas)).length
            t.assert.equal(left, 0, "panels still shown")
        }
    },
    {
        name: "isolationToggle turns isolation on and off",
        run: async (t) => {
            await twoOpen(t)
            const canvases = t.canvasesCapture()
            try {
                t.assert.equal(t.spoon.isolationToggle(), t.spoon, "the first toggle returned")
                t.assert.equal(t.spoon.isolationOn(), true, "after the first toggle")
                t.spoon.isolationToggle()
                t.assert.equal(t.spoon.isolationOn(), false, "after the second toggle")
                t.assert.equal(canvases.filter((c) => showing(c.canvas)).length, 0, "panels still shown")
            } finally {
                t.spoon.isolationStop()
            }
        }
    },
    {
        name: "info returns and shows the window's application, title, screen, frame and history",
        run: async (t) => {
            const { first } = await twoOpen(t)
            t.spoon.leftHalf(first)
            const f = first.frame
            const expected = [
                "osascript",
                first.title,
                `${first.screen.name}  ${Math.round(f.x)},${Math.round(f.y)} ${Math.round(f.w)}×${Math.round(f.h)}`,
                "history: 1"
            ].join("\n")
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.info(first), expected, "returned")
            t.assert.equal(alerts.join(" | "), expected, "alert")
        }
    },
    {
        name: "screenshot writes a PNG of the window to config.screenshotDir and copies it to the pasteboard",
        timeout: 15,
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("Hammerspoon 2 has no Screen Recording permission")
            const { first } = await twoOpen(t)
            // The user's clipboard text is put back afterwards, as the user asked on 2026-11-23.
            // Anything on the clipboard that is not text is lost.
            const text = hs.pasteboard.readString()
            const alerts = t.alertsCapture()
            let path = null
            try {
                path = await t.spoon.screenshot(first)
                t.assert.ok(path, "screenshot returned no path")
                t.assert.ok(path.startsWith(t.spoon.config.screenshotDir + "/"), `the file is not in config.screenshotDir: ${path}`)
                t.assert.ok(path.endsWith(".png"), `the file is not a PNG: ${path}`)
                t.assert.ok(hs.fs.isFile(path), `no file at ${path}`)
                t.assert.ok(hs.pasteboard.hasType("public.png") || hs.pasteboard.hasType("public.tiff"),
                    "the pasteboard holds no image")
                t.assert.equal(alerts.join(" | "), `Copied, and saved to\n${path}`, "alert")
            } finally {
                if (text !== null) hs.pasteboard.writeString(text)
                if (path) hs.fs.deletePath(path)
            }
        }
    }
]

// Tests of the functions that place a window on its screen, resize it in place, or move it by
// its own size, and of the predicates that report whether it fills its screen. Every expected
// frame is computed from the usable frame of the window's screen.

// Opens one test window at a frame well inside its screen, away from every edge, and returns
// the window and the screen's usable frame.
async function windowOpen(t) {
    const [window] = await t.windowsOpen()
    const screen = t.screenFrame(window)
    await t.frameSet(window, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
    return { window, screen }
}

// A frame within a screen, given as fractions of the screen's usable frame.
function part(screen, x, y, w, h) {
    return { x: screen.x + x * screen.w, y: screen.y + y * screen.h, w: w * screen.w, h: h * screen.h }
}

// Copies a frame into a plain object, so that it does not change when the window moves.
function copy(f) {
    return { x: f.x, y: f.y, w: f.w, h: f.h }
}

// The named placements, and where each puts a window, as fractions of the screen.
const PLACEMENTS = [
    ["leftHalf", 0, 0, 1 / 2, 1],
    ["rightHalf", 1 / 2, 0, 1 / 2, 1],
    ["topHalf", 0, 0, 1, 1 / 2],
    ["bottomHalf", 0, 1 / 2, 1, 1 / 2],
    ["leftThird", 0, 0, 1 / 3, 1],
    ["centerThird", 1 / 3, 0, 1 / 3, 1],
    ["rightThird", 2 / 3, 0, 1 / 3, 1],
    ["leftTwoThirds", 0, 0, 2 / 3, 1],
    ["rightTwoThirds", 1 / 3, 0, 2 / 3, 1],
    ["topLeft", 0, 0, 1 / 2, 1 / 2],
    ["topRight", 1 / 2, 0, 1 / 2, 1 / 2],
    ["bottomLeft", 0, 1 / 2, 1 / 2, 1 / 2],
    ["bottomRight", 1 / 2, 1 / 2, 1 / 2, 1 / 2]
]

// The three toggles, the predicate of each, the frame each produces from a frame, the frame it
// restores, and the alert it gives when there is nothing to restore.
const TOGGLES = [
    {
        name: "maximize", predicate: "isMaximized",
        filled: (screen, f) => copy(screen),
        alert: "No earlier size to go back to"
    },
    {
        name: "verticalMaximize", predicate: "isVerticallyMaximized",
        filled: (screen, f) => ({ x: f.x, y: screen.y, w: f.w, h: screen.h }),
        alert: "No earlier height to go back to"
    },
    {
        name: "horizontalMaximize", predicate: "isHorizontallyMaximized",
        filled: (screen, f) => ({ x: screen.x, y: f.y, w: screen.w, h: f.h }),
        alert: "No earlier width to go back to"
    }
]

const tests = []

tests.push({
    name: "place() puts a window in a cell of a grid, spanning columns",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        t.assert.equal(t.spoon.place(window, { cols: 4, rows: 3 }, { col: 1, row: 2, colSpan: 2 }), true)
        t.assert.frameEqual(window.frame, part(screen, 1 / 4, 2 / 3, 2 / 4, 1 / 3))
    }
})

tests.push({
    name: "place() with an empty grid and cell fills the screen",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        t.assert.equal(t.spoon.place(window, {}, {}), true)
        t.assert.frameEqual(window.frame, copy(screen))
    }
})

for (const [name, x, y, w, h] of PLACEMENTS) {
    tests.push({
        name: `${name} places the window`,
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            t.assert.equal(t.spoon[name](window), true, `${name} returned`)
            t.assert.frameEqual(window.frame, part(screen, x, y, w, h))
        }
    })
}

tests.push({
    name: "a placement called without a window acts on the focused window",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        window.focus()
        await t.wait(0.3)
        t.assert.equal(t.spoon.leftHalf(), true)
        t.assert.frameEqual(window.frame, part(screen, 0, 0, 1 / 2, 1))
    }
})

tests.push({
    name: "center moves the window to the middle of its screen, keeping its size",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        t.assert.equal(t.spoon.center(window), true)
        t.assert.frameEqual(window.frame,
            { x: screen.x + (screen.w - 500) / 2, y: screen.y + (screen.h - 400) / 2, w: 500, h: 400 })
    }
})

for (const toggle of TOGGLES) {
    tests.push({
        name: `${toggle.name} fills the screen, and a second call restores the window`,
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            const before = copy(window.frame)
            t.assert.equal(t.spoon[toggle.predicate](window), false, `${toggle.predicate} before`)
            t.assert.equal(t.spoon[toggle.name](window), true, "first call returned")
            t.assert.frameEqual(window.frame, toggle.filled(screen, before), "after the first call")
            t.assert.equal(t.spoon[toggle.predicate](window), true, `${toggle.predicate} after the first call`)
            t.assert.equal(t.spoon[toggle.name](window), true, "second call returned")
            t.assert.frameEqual(window.frame, before, "after the second call")
            t.assert.equal(t.spoon[toggle.predicate](window), false, `${toggle.predicate} after the second call`)
        }
    })

    tests.push({
        name: `${toggle.name} leaves a window that was made to fill the screen by other means`,
        run: async (t) => {
            const { window, screen } = await windowOpen(t)
            const filled = toggle.filled(screen, copy(window.frame))
            await t.frameSet(window, filled)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon[toggle.name](window), false, "returned")
            t.assert.frameEqual(window.frame, filled, "the window moved")
            t.assert.equal(alerts.join(" | "), toggle.alert, "alert")
        }
    })
}

tests.push({
    name: "halfHeight halves the height, keeping the top edge",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        t.assert.equal(t.spoon.halfHeight(window), true)
        t.assert.frameEqual(window.frame, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 200 })
    }
})

tests.push({
    name: "halfWidth halves the width, keeping the left edge",
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        t.assert.equal(t.spoon.halfWidth(window), true)
        t.assert.frameEqual(window.frame, { x: screen.x + 100, y: screen.y + 80, w: 250, h: 400 })
    }
})

tests.push({
    name: "fractionWidth sets the width to each fraction of the screen in the menu",
    timeout: 20,
    run: async (t) => {
        const { window, screen } = await windowOpen(t)
        for (const n of [2, 3, 4, 5, 6, 7, 8]) {
            await t.frameSet(window, { x: screen.x + 100, y: screen.y + 80, w: 500, h: 400 })
            t.assert.equal(t.spoon.fractionWidth(n, window), true, `1/${n} returned`)
            t.assert.frameEqual(window.frame, { x: screen.x + 100, y: screen.y + 80, w: screen.w / n, h: 400 }, `1/${n}`)
        }
    }
})

tests.push({
    name: "fractionWidth refuses a fraction below 1 with an alert",
    run: async (t) => {
        const { window } = await windowOpen(t)
        const before = copy(window.frame)
        const alerts = t.alertsCapture()
        t.assert.equal(t.spoon.fractionWidth(0, window), false)
        t.assert.frameEqual(window.frame, before, "the window moved")
        t.assert.equal(alerts.join(" | "), "Illegal fraction [0]", "alert")
    }
})

tests.push({
    name: "moveByOwnSize moves the window by its width or height in each direction",
    run: async (t) => {
        const [window] = await t.windowsOpen()
        const screen = t.screenFrame(window)
        const middle = { x: screen.x + (screen.w - 400) / 2, y: screen.y + (screen.h - 300) / 2, w: 400, h: 300 }
        const moves = { left: [-400, 0], right: [400, 0], up: [0, -300], down: [0, 300] }
        for (const [direction, [dx, dy]] of Object.entries(moves)) {
            await t.frameSet(window, middle)
            t.assert.equal(t.spoon.moveByOwnSize(direction, window), true, `${direction} returned`)
            t.assert.frameEqual(window.frame, { x: middle.x + dx, y: middle.y + dy, w: 400, h: 300 }, direction)
        }
    }
})

tests.push({
    name: "moveByOwnSize refuses another direction with an alert",
    run: async (t) => {
        const { window } = await windowOpen(t)
        const before = copy(window.frame)
        const alerts = t.alertsCapture()
        t.assert.equal(t.spoon.moveByOwnSize("diagonal", window), false)
        t.assert.frameEqual(window.frame, before, "the window moved")
        t.assert.equal(alerts.join(" | "), "Illegal direction [diagonal]", "alert")
    }
})

tests.push({
    name: "a function whose chooser is dismissed returns null and does not move the window",
    run: async (t) => {
        const { window } = await windowOpen(t)
        const before = copy(window.frame)
        const cancelled = t.promptCancel()
        const result = await t.spoon.fractionWidth(undefined, window)
        await cancelled
        t.assert.equal(result, null)
        t.assert.frameEqual(window.frame, before, "the window moved")
    }
})

module.exports = tests

// The tests of hs_menu-gt that need two screens. With fewer connected, the harness reports each
// of them as skipped without running it. make test-two-screens runs this file alone.
//
// The screens are the first two of hs.screen.all(). A test window is placed on each, and the
// focus moves between them; no key is sent.

// A test window in the middle of a screen, with the focus.
async function windowOn(t, screen) {
    const [window] = await t.windowsOpen()
    const f = screen.frame
    await t.frameSet(window, { x: f.x + f.w * 0.3, y: f.y + f.h * 0.3, w: f.w * 0.4, h: f.h * 0.4 })
    window.focus()
    await t.wait(0.4)
    return window
}

// The centre of a canvas frame in hs.screen's coordinates. A canvas frame has its origin at the
// bottom left of the primary screen, with y growing upwards.
function canvasCentre(frame) {
    const primary = hs.screen.primary().fullFrame
    return { x: frame.x + frame.w / 2, y: (primary.y + primary.h) - (frame.y + frame.h / 2) }
}

function centreOn(t, frame, screen, message) {
    const c = canvasCentre(frame)
    const s = screen.fullFrame
    const expected = { x: s.x + s.w / 2, y: s.y + s.h / 2 }
    if (Math.abs(c.x - expected.x) > 1 || Math.abs(c.y - expected.y) > 1) {
        t.assert.fail(`${message}: expected the centre at (${expected.x}, ${expected.y}), got (${c.x}, ${c.y})`)
    }
}

// The menu's canvas, among the canvases created during one call of onScreenShow(). With
// showDelay at 0 the menu creates its canvas within that call. A canvas created at any other
// time can belong to another of the user's Spoons: on 2026-11-23 a change of focus made one
// create canvases while this test ran.
//
// The Spoon also draws each option in a canvas of its own, created at (0, 0) and never shown,
// while the panel is centred on a screen.
function menuCanvas(t, created, message) {
    const panels = created.filter((c) => c.frame.x !== 0 || c.frame.y !== 0)
    t.assert.equal(panels.length, 1, `panels created for ${message}`)
    return panels[0].canvas
}

const MENU = [{ label: "Sub", key: "k", children: [{ label: "Inner" }, { label: "Two" }, { label: "Three" }, { label: "Four" }, { label: "Five" }] }]

const tests = [
    {
        name: "the menu opens on the focused window's screen, and its submenus stay there after the focus moves",
        run: async (t) => {
            const [first, second] = hs.screen.all()
            const there = await windowOn(t, second)
            const here = await windowOn(t, first)
            there.focus()
            await t.wait(0.4)

            const screen = t.spoon.config.screen
            const delay = screen.showDelay
            screen.showDelay = 0
            const canvases = t.canvasesCapture()
            t.cleanup(() => { t.spoon.onScreenHide(); t.spoon.onScreenPositionReset(); screen.showDelay = delay })
            const session = t.spoon.onScreenShow(MENU, { name: "Root" })
            const canvas = menuCanvas(t, canvases, "the menu")
            await t.wait(0.3)
            centreOn(t, canvas.frame(), second, "the menu")

            here.focus()
            await t.wait(0.4)
            session.activate(0)
            await t.wait(0.3)
            centreOn(t, canvas.frame(), second, "the submenu, after the focus moved")

            t.spoon.onScreenHide()
            t.spoon.onScreenPositionReset()
            const before = canvases.length
            t.spoon.onScreenShow(MENU, { name: "Root" })
            const again = menuCanvas(t, canvases.slice(before), "the menu shown again")
            centreOn(t, again.frame(), first, "the menu shown again")
        }
    }
]

module.exports = { screens: 2, tests }

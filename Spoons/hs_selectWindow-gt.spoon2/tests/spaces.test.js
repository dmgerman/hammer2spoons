// Tests of the Space shown in a row, as the readme describes it under "windowSelect()": a window on
// a Space its screen is not showing has that Space after its screen, "Desktop 2" for another
// desktop and "fullscreen" for a window in fullscreen.
//
// The first test moves a test window to another desktop of its screen with window.moveToSpace(),
// which does not switch to that desktop, and moves it back when the test ends. It needs a screen
// with a second desktop, and is skipped without one. The second test puts a test window in
// fullscreen and focuses another test window on the same screen, which shows that screen's desktop
// again; the fixture takes a window out of fullscreen before closing it.

const { choosersCapture, open, openWait, key, focus } = require("./chooser.js")

// The row of a window, found by its title.
const rowOf = (record, window) => record.rows.find((row) => row.text === window.title)

// The Spaces of a screen, the one it shows first.
function spacesOf(screen) {
    const spaces = screen.spaces || []
    return { current: spaces.find((s) => s.isCurrent) || null, all: spaces }
}

// Opens windowSelect()'s chooser, and returns its record once it is open.
async function chooserRows(t, choosers) {
    const chooser = open(t, () => t.spoon.windowSelect())
    await openWait(t, chooser)
    const record = choosers[choosers.length - 1]
    return { chooser, record }
}

module.exports = [
    {
        name: "a window on another desktop has that desktop after its screen, and a window on the desktop shown has none",
        timeout: 20,
        run: async (t) => {
            const screen = hs.screen.all().find((s) => {
                const { current, all } = spacesOf(s)
                return current && current.type === "desktop" && all.some((sp) => sp.type === "desktop" && !sp.isCurrent)
            })
            if (!screen) t.skip("no screen shows a desktop and has a second one")
            const { current, all } = spacesOf(screen)
            const other = all.find((sp) => sp.type === "desktop" && !sp.isCurrent)

            const choosers = choosersCapture(t)
            const [focused, shown, away] = await t.windowsOpen(3)
            const f = screen.frame
            for (const [i, window] of [focused, shown, away].entries()) {
                await t.frameSet(window, { x: f.x + 60 + 40 * i, y: f.y + 60 + 40 * i, w: 400, h: 300 })
            }
            await focus(t, focused)
            await away.moveToSpace(other)
            t.cleanup(async () => {
                if (!away.spaces.some((sp) => sp.id === current.id)) await away.moveToSpace(current)
            })
            await t.wait(0.5)
            t.assert.ok(away.spaces.some((sp) => sp.id === other.id), "the window was not moved to the other desktop")

            const { chooser, record } = await chooserRows(t, choosers)
            const awayRow = rowOf(record, away)
            const shownRow = rowOf(record, shown)
            t.assert.ok(awayRow, "the window on the other desktop has no row")
            t.assert.ok(shownRow, "the window on the desktop shown has no row")
            t.assert.equal(awayRow.subText, `osascript  ·  ${screen.name}  ·  Desktop ${other.desktopNumber}`, "the row of the window on the other desktop")
            t.assert.equal(shownRow.subText, `osascript  ·  ${screen.name}`, "the row of the window on the desktop shown")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "a window in fullscreen on a Space that is not shown has fullscreen after its screen",
        timeout: 30,
        run: async (t) => {
            const choosers = choosersCapture(t)
            const [full, other, focused] = await t.windowsOpen(3)
            const screen = full.screen
            const f = screen.frame
            await t.frameSet(other, { x: f.x + 100, y: f.y + 100, w: 400, h: 300 })
            await t.frameSet(focused, { x: f.x + 140, y: f.y + 140, w: 400, h: 300 })

            await focus(t, full)
            full.toggleFullscreen()
            const started = Date.now()
            while (!full.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            t.assert.ok(full.isFullscreen, "the window did not enter fullscreen")
            await t.wait(1.5)
            // Focusing a window on the same screen shows that screen's desktop again.
            await focus(t, focused)
            await t.wait(1.5)
            const fullscreenSpace = full.spaces[0]
            t.assert.ok(fullscreenSpace && fullscreenSpace.type === "fullscreen", "the window is not on a fullscreen Space")
            t.assert.ok(!fullscreenSpace.isCurrent, "the fullscreen Space is still shown")

            const { chooser, record } = await chooserRows(t, choosers)
            const fullRow = rowOf(record, full)
            t.assert.ok(fullRow, "the window in fullscreen has no row")
            t.assert.equal(fullRow.subText, `osascript  ·  ${screen.name}  ·  fullscreen`, "the row of the window in fullscreen")
            t.assert.equal(rowOf(record, other).subText, `osascript  ·  ${screen.name}`, "the row of the window on the desktop shown")
            await key(t, chooser, [], "escape")
        }
    }
]

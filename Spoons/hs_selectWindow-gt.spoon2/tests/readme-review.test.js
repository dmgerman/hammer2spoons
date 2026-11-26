// Tests of the statements of the readme that the other files do not cover, found by reading the
// readme as a whole against the tests: the settings' defaults, matching the typed text as a
// whole, leaving out windows that are not standard, a thumbnail not being enlarged, and
// windowPreviousSelect() reaching a minimized window.

const { choosersCapture, open, openWait, type, key, focus, focusedId, testRows, previousGuard } = require("./chooser.js")

// The id of the row the copy's chooser has selected, or null when no row is listed.
function selectedId(chooser) {
    const contents = chooser.selectedRowContents(chooser.selectedRow)
    return contents && contents.id !== undefined ? contents.id : null
}

module.exports = [
    {
        name: "the settings have the defaults the readme gives",
        run: (t) => {
            const c = t.spoon.config
            const expected = {
                rowsToDisplay: 14, width: 0.4, wideWidth: 0.22, wideScreenPoints: 3000,
                showThumbnail: false, thumbnailHeightRatio: 0.4, thumbnailTopRatio: 0.12,
                thumbnailGap: 12, persistentThumbnailCache: false,
                thumbnailToggleKey: "tab", thumbnailRefreshKey: "tab",
                skipApplications: ["Hammerspoon", "Hammerspoon 2"], fullscreenScreenSkip: false
            }
            const wrong = Object.keys(expected)
                .filter((k) => JSON.stringify(c[k]) !== JSON.stringify(expected[k]))
                .map((k) => `${k} is ${JSON.stringify(c[k])}`)
            t.assert.equal(wrong.join(", "), "", "settings that differ")
        }
    },
    {
        name: "the typed text is matched as a whole: two words found separately find nothing together",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await type(t, chooser, a.title)
            t.assert.equal(selectedId(chooser), a.id, "the row selected for the title alone")
            // The title is in the row's text and "osascript" in the line beneath it.
            await type(t, chooser, " osascript")
            t.assert.equal(selectedId(chooser), null, "a row is still listed for the title and the application together")
            await key(t, chooser, [], "escape")
            t.assert.equal(focusedId(), b.id, "the focused window")
        }
    },
    {
        name: "a window that is not standard is not listed",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const title = `${t.titlePrefix}borderless`
            const borderless = await t.windowOpenBorderless(title)
            if (borderless.isStandard) t.skip("the borderless test window is reported as standard, so it cannot stand for a window that is not")
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            t.assert.ok(!t.spoon.order().some((e) => e.endsWith(title)), "the borderless window is in order()")
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            t.assert.ok(!testRows(t, choosers[0]).some((r) => r.text === title), "the borderless window is listed")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "a snapshot smaller than thumbnailHeightRatio allows is drawn at its own size",
        run: async (t) => {
            if (!hs.permissions.checkScreenRecording()) t.skip("needs the Screen Recording permission")
            const [a] = await t.windowsOpen(1)
            const area = a.screen.frame
            await t.frameSet(a, { x: area.x + 40, y: area.y + 40, w: 260, h: 160 })
            const [b] = await t.windowsOpen(1)
            await focus(t, a)
            await focus(t, b)
            const config = t.spoon.config
            const original = config.showThumbnail
            config.showThumbnail = true
            t.cleanup(() => { config.showThumbnail = original })
            const canvases = t.canvasesCapture()
            const chooser = open(t, () => t.spoon.windowSelect())
            await openWait(t, chooser)
            await t.wait(0.8)
            const thumbnail = canvases[canvases.length - 1]
            t.assert.ok(thumbnail, "no thumbnail")
            const height = a.frame.h
            t.assert.ok(Math.abs(thumbnail.frame.h - height) <= 2, `the thumbnail is ${thumbnail.frame.h} points high, and the window ${height}`)
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "windowPreviousSelect() reaches a minimized window, and brings it back",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            a.minimize()
            await t.wait(1)
            previousGuard(t, a)
            t.assert.equal(t.spoon.windowPreviousSelect(), true, "the result")
            await t.wait(1)
            t.assert.ok(!a.isMinimized, "the window is still minimized")
            t.assert.equal(focusedId(), a.id, "the focused window")
        }
    }
]

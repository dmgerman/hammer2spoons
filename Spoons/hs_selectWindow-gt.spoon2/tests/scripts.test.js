// Tests of the functions for other scripts, as the readme describes them under "Finding and
// focusing windows from other scripts": windowByTitleFind, windowByTitleSelect,
// applicationByNameSelect, applicationWindowByTitleSelect and fullscreenWindowNextSelect.
//
// Every pattern names test windows only: their titles start with the run's own prefix, and their
// application is osascript, which runs no window of the user's. The last test puts a test window in
// fullscreen; the fixture takes it out of fullscreen before closing it.

const { focus, focusedId } = require("./chooser.js")

// A RegExp that matches exactly one title.
const exactly = (title) => new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)

module.exports = [
    {
        name: "windowByTitleFind returns the most recently used window whose title matches, without focusing it, and null when none does",
        run: async (t) => {
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const found = t.spoon.windowByTitleFind(exactly(a.title))
            t.assert.equal(found ? found.id : null, a.id, "the window found")
            t.assert.equal(focusedId(), b.id, "the focused window")
            // Both titles start with the run's prefix, so a string matching it finds the more
            // recently used, b.
            const recent = t.spoon.windowByTitleFind(t.titlePrefix)
            t.assert.equal(recent ? recent.id : null, b.id, "the more recently used of two that match")
            t.assert.equal(t.spoon.windowByTitleFind(`${t.titlePrefix}no such window`), null, "a title that matches nothing")
        }
    },
    {
        name: "windowByTitleSelect focuses the window and returns it, and alerts for no match, a missing pattern and a bad one",
        run: async (t) => {
            const alerts = t.alertsCapture()
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            const selected = t.spoon.windowByTitleSelect(exactly(a.title))
            await t.wait(0.8)
            t.assert.equal(selected ? selected.id : null, a.id, "the window returned")
            t.assert.equal(focusedId(), a.id, "the focused window")
            t.assert.equal(t.spoon.windowByTitleSelect(`${t.titlePrefix}no such window`), null, "no match")
            t.assert.equal(t.spoon.windowByTitleSelect(""), null, "a missing pattern")
            t.assert.equal(t.spoon.windowByTitleSelect("(unclosed"), null, "a bad pattern")
            t.assert.ok(alerts.some((x) => x.startsWith("No window's title matches")), `alerts: ${alerts.join(" | ")}`)
            t.assert.ok(alerts.some((x) => x === "No title given"), `alerts: ${alerts.join(" | ")}`)
            t.assert.ok(alerts.some((x) => x.startsWith("Bad title pattern")), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(focusedId(), a.id, "the focused window after the alerts")
        }
    },
    {
        name: "applicationByNameSelect and applicationWindowByTitleSelect focus the most recently used matching window",
        run: async (t) => {
            const alerts = t.alertsCapture()
            const [a, b, c] = await t.windowsOpen(3)
            for (const window of [a, b, c]) await focus(t, window)
            // c, the most recently used window of osascript, has the focus; a string pattern.
            const byName = t.spoon.applicationByNameSelect("^osascri")
            await t.wait(0.8)
            t.assert.equal(byName ? byName.id : null, c.id, "applicationByNameSelect: the most recently used window of osascript")
            const byTitle = t.spoon.applicationWindowByTitleSelect("osascript", exactly(a.title))
            await t.wait(0.8)
            t.assert.equal(byTitle ? byTitle.id : null, a.id, "applicationWindowByTitleSelect: the window returned")
            t.assert.equal(focusedId(), a.id, "applicationWindowByTitleSelect: the focused window")
            // The name must match exactly.
            t.assert.equal(t.spoon.applicationWindowByTitleSelect("osascrip", exactly(b.title)), null, "a name that is not exact")
            t.assert.ok(alerts.some((x) => x.startsWith("No osascrip window's title matches")), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(t.spoon.applicationByNameSelect(/^Zq no such application$/), null, "applicationByNameSelect with no match")
            t.assert.ok(alerts.some((x) => x.startsWith("No application's name matches")), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(focusedId(), a.id, "the focused window after the alerts")
        }
    },
    {
        name: "fullscreenWindowNextSelect alerts when no other window is in fullscreen, and focuses a test window in fullscreen",
        timeout: 30,
        run: async (t) => {
            // fullscreenWindowNextSelect() would focus a window of the user's in fullscreen, so the
            // test runs only when none is.
            const users = hs.window.allWindows().filter((w) => w.isFullscreen && !(w.title || "").startsWith(t.titlePrefix))
            if (users.length) t.skip("a window of the user's is in fullscreen")
            const alerts = t.alertsCapture()
            const [full, other] = await t.windowsOpen(2)
            const f = full.screen.frame
            await t.frameSet(other, { x: f.x + 100, y: f.y + 100, w: 400, h: 300 })
            await focus(t, other)
            t.assert.equal(t.spoon.fullscreenWindowNextSelect(), null, "with no window in fullscreen")
            t.assert.ok(alerts.includes("No other window is in fullscreen"), `alerts: ${alerts.join(" | ")}`)

            await focus(t, full)
            full.toggleFullscreen()
            const started = Date.now()
            while (!full.isFullscreen && Date.now() - started < 5000) await t.wait(0.1)
            t.assert.ok(full.isFullscreen, "the window did not enter fullscreen")
            await t.wait(1.5)
            await focus(t, other)
            await t.wait(1.5)
            const selected = t.spoon.fullscreenWindowNextSelect()
            await t.wait(1.5)
            t.assert.equal(selected ? selected.id : null, full.id, "the window returned")
            t.assert.equal(focusedId(), full.id, "the focused window")
        }
    }
]

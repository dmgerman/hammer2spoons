// Tests of the key that opened the chooser, pressed again, and of singleRowSwitch, as the readme
// describes them under "The chooser" and "Settings".
//
// The key is bound with bindHotkeys() as ctrl-alt-f17, so that its Shift form, ctrl-alt-shift-f17,
// is one of the test keys this repository uses. ctrl-alt-f17 itself is checked to be free first, and
// the test is skipped when it is not. Every key is pressed only while the copy's chooser is open,
// except the one that opens it.

// A synthetic F-key press reaches a hotkey only with fn, which a real F-key carries: on
// 2026-11-25 ctrl-alt-shift-f17 sent without it ran nothing. fn is added to F-keys only.
const withFn = (mods, key) => (/^f\d+$/.test(key) ? [...mods, "fn"] : mods)

const { choosersCapture, interactive, focus, focusedId } = require("./chooser.js")

const BASE = ["ctrl", "alt"]
const SHIFTED = ["ctrl", "alt", "shift"]

// Whether a chord is free, by binding it and releasing it at once.
function chordFree(mods, key) {
    const probe = hs.hotkey.bind(mods, key, () => {}, null)
    if (!probe) return false
    probe.destroy()
    return true
}

module.exports = [
    {
        name: "the key that opened the chooser moves its selection down when pressed again, and up with Shift, round at either end",
        timeout: 20,
        run: async (t) => {
            if (!chordFree(BASE, "f17") || !chordFree(SHIFTED, "f17")) t.skip("ctrl-alt-f17 or ctrl-alt-shift-f17 is bound")
            const choosers = choosersCapture(t)
            const [a, b, c] = await t.windowsOpen(3)
            for (const window of [a, b, c]) await focus(t, window)
            t.cleanup(() => t.spoon.bindHotkeys({}))
            t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
            t.spoon.bindHotkeys({ windowSelect: [BASE, "f17"] })

            hs.eventtap.keyStroke(withFn(BASE, "f17"), "f17", null)
            await t.wait(0.8)
            t.assert.equal(choosers.length, 1, "choosers after the first press")
            const chooser = choosers[0].chooser
            const press = async (mods) => {
                if (!(chooser.isVisible && interactive().promptIsOpen())) t.assert.fail("the chooser closed")
                hs.eventtap.keyStroke(withFn(mods, "f17"), "f17", null)
                await t.wait(0.4)
                return chooser.selectedRow
            }
            t.assert.equal(chooser.selectedRow, 0, "the row selected when it opens")
            t.assert.equal(await press(BASE), 1, "the key again moves down")
            t.assert.equal(await press(SHIFTED), 0, "with Shift it moves up")
            const last = await press(SHIFTED)
            t.assert.equal(last, choosers[0].rows.length - 1, "with Shift on the first row it goes round to the last")
            t.assert.equal(await press(BASE), 0, "the key on the last row goes round to the first")
            t.assert.equal(choosers.length, 1, "choosers opened")
            if (interactive().promptIsOpen()) hs.eventtap.keyStroke([], "escape", null)
            await t.wait(0.5)
            t.assert.equal(focusedId(), c.id, "the focused window after Escape")
        }
    },
    {
        name: "with singleRowSwitch, a chooser with one row switches at once, and without it the chooser is shown",
        run: async (t) => {
            const choosers = choosersCapture(t)
            const original = t.spoon.config.singleRowSwitch
            t.cleanup(() => { t.spoon.config.singleRowSwitch = original })
            t.cleanup(() => { t.spoon.stop(); t.spoon.start() })
            const [a, b] = await t.windowsOpen(2)
            await focus(t, a)
            await focus(t, b)
            t.assert.equal(t.spoon.config.singleRowSwitch, false, "the default")
            t.spoon.config.singleRowSwitch = true
            t.spoon.applicationWindowSelect()
            await t.wait(0.8)
            t.assert.equal(choosers.length, 0, "choosers with singleRowSwitch")
            t.assert.equal(focusedId(), a.id, "the window switched to")
            t.spoon.config.singleRowSwitch = false
            t.spoon.applicationWindowSelect()
            await t.wait(0.8)
            t.assert.equal(choosers.length, 1, "choosers without singleRowSwitch")
            if (interactive().promptIsOpen()) hs.eventtap.keyStroke([], "escape", null)
            await t.wait(0.4)
        }
    }
]

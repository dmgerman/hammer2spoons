// Tests of the statements of the readme that the other files do not cover, found by reading the
// readme as a whole against the tests: the history kept across a restart, a password kept only
// until one, and selecting an image entry.

const { copy, imageMake, copyImage, fresh, entries, text, chooserCapture, historyOpen, key } = require("./clipboard.js")

const PASSWORD = "Zq7#vK2$mP9!xR4w"

module.exports = [
    {
        name: "the history is kept across a restart, and a password-like entry is not",
        run: async (t) => {
            fresh(t)
            await copy(t, text(t, "kept"))
            await copy(t, PASSWORD)
            t.assert.equal(entries(t)[0], PASSWORD, "the newest entry before the restart")
            // stop() and start() are what a restart of Hammerspoon 2 runs.
            t.spoon.stop()
            t.spoon.start()
            t.assert.equal(entries(t).join(" | "), text(t, "kept"), "the entries after the restart")
        }
    },
    {
        name: "selecting an image entry copies the image to the clipboard",
        timeout: 15,
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copyImage(t, imageMake(36, 26))
            await copy(t, text(t, "newer"))
            await historyOpen(t, chooser)
            await key(t, chooser, [], "down")
            await key(t, chooser, [], "return")
            const image = hs.pasteboard.readImage()
            t.assert.ok(image, "no image on the clipboard")
            t.assert.equal(`${Math.round(image.size.w)}x${Math.round(image.size.h)}`, "36x26", "the image's size")
        }
    }
]

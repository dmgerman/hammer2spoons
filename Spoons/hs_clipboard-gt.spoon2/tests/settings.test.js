// Tests of the settings, as the readme lists them under "Configuration": their defaults, and the
// settings no other file tests. The keys used are ctrl-alt-shift with 7, 8 or 9, which the user
// does not bind.

const { copy, imageMake, copyImage, fresh, text, chooserCapture, record, historyOpen, key } = require("./clipboard.js")

const PASSWORD = "Zq7#vK2$mP9!xR4w"
const OTHER_PASSWORD = "Hb4%Lw8&Tn3*Yd6q"

function settingsSet(t, values) {
    const config = t.spoon.config
    const original = {}
    for (const name of Object.keys(values)) {
        original[name] = config[name]
        config[name] = values[name]
    }
    t.cleanup(() => Object.assign(config, original))
}

module.exports = [
    {
        name: "each setting can also be set on the Spoon's object, as hs.spoons.use()'s config option sets it",
        run: (t) => {
            const config = t.spoon.config
            const saved = Object.assign({}, config)
            t.cleanup(() => Object.assign(config, saved))
            const names = Object.keys(config)
            t.assert.ok(names.length > 0, "no settings")
            // A value that no setting has, set and restored at once.
            const marker = { zqMarker: true }
            for (const name of names) {
                // As hs.spoons.use() applies its config option: Object.assign(spoon, config).
                Object.assign(t.spoon, { [name]: marker })
                t.assert.equal(config[name], marker, `${name}: config after setting the object`)
                config[name] = saved[name]
                t.assert.equal(t.spoon[name], saved[name], `${name}: the object after setting config`)
            }
        }
    },
    {
        name: "the settings have the defaults the readme gives",
        run: (t) => {
            const c = t.spoon.config
            const expected = {
                historySize: 100, imageHistorySize: 10, maxEntrySize: 4990, displayMaxLength: 200,
                deduplicate: true, copiedAlert: true, alertDuration: 1, honorIgnoredIdentifiers: true,
                passwordsHide: true, passwordTest: null, passwordEntropyThreshold: 3.5,
                passwordMinLength: 8, passwordMaxNewlines: 1,
                revealCurrentKey: { mods: ["cmd"], key: "r" }, revealAllKey: { mods: ["cmd", "shift"], key: "r" },
                pasteDelay: 0.2, showPreview: true, previewHeightRatio: 0.5, previewGap: 12,
                previewPollSeconds: 0.15, watchInterval: 0.8, menubarShow: true, menubarTitle: "📋"
            }
            const wrong = Object.keys(expected)
                .filter((k) => JSON.stringify(c[k]) !== JSON.stringify(expected[k]))
                .map((k) => `${k} is ${JSON.stringify(c[k])}`)
            t.assert.equal(wrong.join(", "), "", "settings that differ")
            t.assert.equal(c.ignoredIdentifiers.length, 7, "the number of ignoredIdentifiers")
        }
    },
    {
        name: "the copied alert is shown for alertDuration seconds, and not at all with copiedAlert false",
        run: async (t) => {
            const alerts = t.alertsCapture()
            fresh(t)
            settingsSet(t, { alertDuration: 0.7 })
            await copy(t, text(t, "announced"))
            const index = alerts.findIndex((m) => m.startsWith("Copied "))
            t.assert.ok(index !== -1, `alerts: ${alerts.join(" | ") || "none"}`)
            t.assert.equal(alerts.durations[index], 0.7, "the alert's duration")
            settingsSet(t, { copiedAlert: false })
            const before = alerts.length
            await copy(t, text(t, "silent"))
            t.assert.equal(alerts.slice(before).filter((m) => m.startsWith("Copied ")).length, 0, "copied alerts with copiedAlert false")
        }
    },
    {
        name: "with showPreview false, no image is drawn beside the chooser",
        timeout: 15,
        run: async (t) => {
            const chooser = chooserCapture(t)
            settingsSet(t, { showPreview: false })
            fresh(t)
            await copyImage(t, imageMake(60, 40))
            let canvases = null
            await historyOpen(t, chooser, () => { canvases = t.canvasesCapture() })
            await t.wait(0.6)
            t.assert.equal(canvases.length, 0, "previews drawn")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "previewGap is the space between the preview and the chooser",
        timeout: 20,
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copyImage(t, imageMake(60, 40))
            const rightEdges = []
            for (const gap of [12, 52]) {
                settingsSet(t, { previewGap: gap })
                let canvases = null
                await historyOpen(t, chooser, () => { canvases = t.canvasesCapture() })
                await t.wait(0.6)
                const preview = canvases[canvases.length - 1]
                t.assert.ok(preview, `no preview with previewGap ${gap}`)
                rightEdges.push(preview.frame.x + preview.frame.w)
                await key(t, chooser, [], "escape")
            }
            t.assert.ok(Math.abs(rightEdges[0] - rightEdges[1] - 40) <= 1, `the right edge moved by ${rightEdges[0] - rightEdges[1]} points`)
        }
    },
    {
        name: "revealCurrentKey and revealAllKey change the keys that reveal masked entries",
        run: async (t) => {
            settingsSet(t, { revealCurrentKey: { mods: ["ctrl", "alt", "shift"], key: "f17" }, revealAllKey: { mods: ["ctrl", "alt", "shift"], key: "f18" } })
            // The keys are created by start(), which chooserCapture() runs.
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, PASSWORD)
            await copy(t, OTHER_PASSWORD)
            const shown = () => chooser.rows.slice(0, 2).map((r) => r.text.startsWith("[hidden") ? "hidden" : "shown").join(",")
            await historyOpen(t, chooser)
            await key(t, chooser, ["ctrl", "alt", "shift"], "f17")
            t.assert.equal(shown(), "shown,hidden", "after the reveal key")
            await key(t, chooser, ["ctrl", "alt", "shift"], "f18")
            t.assert.equal(shown(), "shown,shown", "after the reveal all key")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "pasteDelay is how long after the chooser closes the entries are typed",
        run: async (t) => {
            fresh(t)
            settingsSet(t, { pasteDelay: 1.2 })
            await copy(t, text(t, "delayed"))
            const [window] = await t.windowsOpen(1)
            window.focus()
            await t.wait(0.4)
            const typed = record(t, hs.eventtap, "keyStrokes")
            t.spoon.entriesPaste(0, "\n")
            await t.wait(0.6)
            t.assert.equal(typed.length, 0, "keys typed within 0.6 s")
            await t.wait(1)
            t.assert.ok(typed.length > 0, "nothing typed within 1.6 s")
        }
    }
]

// Tests of the history, as the readme describes it under "The history" and "Files": what is
// recorded and what is not, the limits, duplicates, images, and the history file.

const { copy, copyWith, imageMake, copyImage, fresh, entries, texts, images } = require("./clipboard.js")

const text = (t, name) => `clipboard test ${t.runId} ${name}`

// Sets fields of the copy's config until the test ends.
function settingsSet(t, values) {
    const config = t.spoon.config
    const original = {}
    for (const name of Object.keys(values)) {
        original[name] = config[name]
        config[name] = values[name]
    }
    t.cleanup(() => Object.assign(config, original))
}

function historyRead(t) {
    return JSON.parse(hs.fs.read(t.spoon.config.historyFile, 0, 0))
}

const pngs = (t) => (hs.fs.list(t.spoon.config.clipboardDir) || []).filter((name) => name.endsWith(".png")).sort()

module.exports = [
    {
        name: "copied text is added to the top of the history",
        run: async (t) => {
            fresh(t)
            await copy(t, text(t, "one"))
            await copy(t, text(t, "two"))
            t.assert.equal(entries(t).join(" | "), [text(t, "two"), text(t, "one")].join(" | "))
        }
    },
    {
        name: "copying text already in the history moves it to the top instead of adding it again",
        run: async (t) => {
            fresh(t)
            await copy(t, text(t, "a"))
            await copy(t, text(t, "b"))
            await copy(t, text(t, "a"))
            t.assert.equal(entries(t).join(" | "), [text(t, "a"), text(t, "b")].join(" | "))
        }
    },
    {
        name: "with deduplicate false, text copied again is added again",
        run: async (t) => {
            fresh(t)
            settingsSet(t, { deduplicate: false })
            await copy(t, text(t, "a"))
            await copy(t, text(t, "b"))
            await copy(t, text(t, "a"))
            t.assert.equal(entries(t).join(" | "), [text(t, "a"), text(t, "b"), text(t, "a")].join(" | "))
        }
    },
    {
        name: "historySize limits the text entries, and the oldest is removed",
        run: async (t) => {
            fresh(t)
            settingsSet(t, { historySize: 3 })
            for (const n of [1, 2, 3, 4, 5]) await copy(t, text(t, `n${n}`))
            t.assert.equal(texts(t).join(" | "), [5, 4, 3].map((n) => text(t, `n${n}`)).join(" | "))
        }
    },
    {
        name: "images are counted separately, imageHistorySize limits them, and a removed image's file is deleted",
        timeout: 20,
        run: async (t) => {
            fresh(t)
            settingsSet(t, { historySize: 2, imageHistorySize: 2 })
            await copy(t, text(t, "kept 1"))
            await copy(t, text(t, "kept 2"))
            for (const n of [1, 2, 3]) {
                await copyImage(t, imageMake(40 + n, 30, n / 3))
                // Image files are named after the second they were copied in.
                await t.wait(1.1)
            }
            t.assert.equal(images(t).length, 2, "image entries")
            t.assert.ok(images(t)[0].startsWith("[image 43x30]"), `the newest image entry: ${images(t)[0]}`)
            t.assert.equal(texts(t).join(" | "), [text(t, "kept 2"), text(t, "kept 1")].join(" | "), "text entries")
            t.assert.equal(pngs(t).length, 2, "image files")
        }
    },
    {
        name: "an image file is named after the time it was copied, and the directory holds only the history's images",
        timeout: 15,
        run: async (t) => {
            fresh(t)
            await copyImage(t, imageMake(20, 20))
            const files = pngs(t)
            t.assert.equal(files.length, 1, "image files")
            t.assert.ok(/^\d{8}T\d{6}\.png$/.test(files[0]), `the file name: ${files[0]}`)
            t.assert.ok(images(t)[0].endsWith(`${t.spoon.config.clipboardDir}/${files[0]}`), "the entry's path")
            t.spoon.historyClear()
            t.assert.equal(pngs(t).length, 0, "image files after historyClear()")
        }
    },
    {
        name: "two images copied within one second are both kept, each with its own file",
        run: async (t) => {
            fresh(t)
            // The clipboard is read every watcherInterval seconds, 0.8 by default, at the same
            // fractions of a second each time, so waiting cannot make two readings fall within one
            // second. The test therefore sends the watcher's change event itself after each copy,
            // through hs.pasteboard._watcherEmitter, which is private to Hammerspoon 2 and used
            // here only. The copy reads both images within a few milliseconds. The user's
            // hs_clipboard-gt receives the same events and ignores them, since it is paused.
            const emitter = hs.pasteboard._watcherEmitter
            if (!emitter || typeof emitter.emit !== "function") t.skip("hs.pasteboard._watcherEmitter is not available")
            hs.pasteboard.writeImage(imageMake(21, 21))
            emitter.emit("change", hs.pasteboard.changeCount)
            hs.pasteboard.writeImage(imageMake(22, 22))
            emitter.emit("change", hs.pasteboard.changeCount)
            // Read at once, before the watcher's own reading adds the second image again.
            const found = images(t).slice(0, 2)
            const paths = found.map((e) => e.replace(/^\[image \S+\] /, ""))
            const files = pngs(t)
            t.assert.equal(found.length, 2, "image entries")
            t.assert.equal(new Set(paths).size, 2, "different files for the two entries")
            t.assert.equal(files.length, 2, "image files")
            // The two copies are a few milliseconds apart, so they fall in one second unless a
            // second ended between them.
            const seconds = new Set(files.map((name) => name.slice(0, 15)))
            if (seconds.size === 1) t.assert.ok(files.some((name) => /^\d{8}T\d{6}-2\.png$/.test(name)), `the file names: ${files.join(", ")}`)
        }
    },
    {
        name: "an entry longer than maxEntrySize is cut at the last blank line that fits, or at the limit",
        run: async (t) => {
            fresh(t)
            settingsSet(t, { maxEntrySize: 60 })
            const head = text(t, "head")
            const paragraphs = `${head}\n\n${"x".repeat(80)}`
            await copy(t, paragraphs)
            t.assert.equal(entries(t)[0], head, "with a blank line")
            const plain = `${text(t, "plain")} ${"y".repeat(80)}`
            await copy(t, plain)
            t.assert.equal(entries(t)[0], plain.slice(0, 60), "without a blank line")
        }
    },
    {
        name: "a copy marked as private or temporary is not added, unless honorIgnoredIdentifiers is false",
        run: async (t) => {
            fresh(t)
            await copyWith(t, text(t, "concealed"), { "org.nspasteboard.ConcealedType": "" })
            t.assert.equal(entries(t).length, 0, "entries after a concealed copy")
            settingsSet(t, { honorIgnoredIdentifiers: false })
            await copyWith(t, text(t, "concealed again"), { "org.nspasteboard.ConcealedType": "" })
            t.assert.equal(entries(t)[0], text(t, "concealed again"), "the entry with honorIgnoredIdentifiers false")
        }
    },
    {
        name: "the history file holds paste on select and the entries, newest first, and is rewritten on each change",
        run: async (t) => {
            fresh(t)
            await copy(t, text(t, "first"))
            await copy(t, text(t, "second"))
            const data = historyRead(t)
            t.assert.equal(typeof data.pasteOnSelect, "boolean", "pasteOnSelect")
            t.assert.equal(data.items.map((e) => e.content).join(" | "), [text(t, "second"), text(t, "first")].join(" | "), "the entries")
        }
    },
    {
        name: "start() rewrites the history file, removing a password-like entry left in it",
        run: async (t) => {
            const password = "Zq7#vK2$mP9!xR4w"
            t.assert.ok(t.spoon.passwordLike(password), "the test password is not password-like")
            t.spoon.stop()
            t.cleanup(() => t.spoon.start())
            hs.fs.write(t.spoon.config.historyFile, JSON.stringify({ pasteOnSelect: false, items: [
                { type: "text", content: password }, { type: "text", content: text(t, "plain") }] }), false)
            t.spoon.start()
            t.cleanup(() => t.spoon.stop())
            const contents = historyRead(t).items.map((e) => e.content)
            t.assert.equal(contents.join(" | "), text(t, "plain"), "the entries in the file")
        }
    }
]

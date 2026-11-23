// Tests of the album list, as the readme describes it under "The list file", "The example list",
// "Adding an album to the list" and "Albums". The lists are files in the run's directory; the
// copy's albumListPath points there (tests/spoon.js).
//
// Adding an album plays Music and asks Apple's catalogue which album is playing, so that test
// controls the user's Music application, which the user agreed to on 2026-11-23.

const { musicAsk, musicRunning, musicKeep, musicStateWait } = require("./music.js")

function listWrite(t, name, lines) {
    const path = `${t.dir}/${name}`
    hs.fs.write(path, lines.join("\n") + "\n", false)
    return path
}

// Points the copy's albumListPath at a file of the run's directory that does not exist, until
// the test ends.
function listMissing(t, name) {
    const config = t.spoon.config
    const original = config.albumListPath
    config.albumListPath = `${t.dir}/${name}`
    t.cleanup(() => { config.albumListPath = original })
    return config.albumListPath
}

// The example list the Spoon includes.
function exampleFile() {
    return hs.fs.pathToAbsolute(`${__dirname}/../albums.txt`)
}

// Opens the user's hs_interactive-gt's chooser through albumChoose(), records its rows, and
// cancels it with Escape, sent only while the prompt is open.
async function chooserRows(t, path) {
    const original = hs.chooser.create
    const own = Object.prototype.hasOwnProperty.call(hs.chooser, "create")
    const recorded = { rows: null }
    hs.chooser.create = function () {
        const real = original.apply(hs.chooser, arguments)
        const proxy = new Proxy(real, {
            get(target, property) {
                const value = target[property]
                if (typeof value !== "function") return value
                return (...args) => {
                    if (property === "setChoices") recorded.rows = args[0]
                    const result = value.apply(target, args)
                    return result === target ? proxy : result
                }
            },
            set(target, property, value) { target[property] = value; return true }
        })
        return proxy
    }
    t.cleanup(() => { if (own) hs.chooser.create = original; else delete hs.chooser.create })
    const interactive = hs.spoons["hs_interactive-gt"]
    t.spoon.albumChoose(path)
    const started = Date.now()
    while (!interactive.promptIsOpen()) {
        if (Date.now() - started > 3000) t.assert.fail("the album chooser did not open")
        await t.wait(0.05)
    }
    await t.wait(0.3)
    if (interactive.promptIsOpen()) hs.eventtap.keyStroke([], "escape", null)
    await t.wait(0.5)
    return recorded.rows || []
}

module.exports = [
    // --- the list file ---
    {
        name: "albumsRead() reads links, Band|Album lines and comments, and ignores every other line",
        run: (t) => {
            const path = listWrite(t, "format.txt", [
                "# a comment line",
                "https://music.apple.com/ca/album/kid-a/1097862870 # Radiohead — Kid A",
                "https://music.apple.com/ca/album/the-bends/1097862703",
                "music://music.apple.com/ca/album/amnesiac/1097864180 # Amnesiac",
                "",
                "  Miles Davis | Kind of Blue  # a comment after a name",
                "Pink Floyd|",
                "just some words",
                "|No band"
            ])
            const entries = t.spoon.albumsRead(path)
            t.assert.equal(JSON.stringify(entries), JSON.stringify([
                { kind: "url", url: "https://music.apple.com/ca/album/kid-a/1097862870", label: "Radiohead — Kid A" },
                { kind: "url", url: "https://music.apple.com/ca/album/the-bends/1097862703", label: "the bends" },
                { kind: "url", url: "music://music.apple.com/ca/album/amnesiac/1097864180", label: "Amnesiac" },
                { kind: "name", band: "Miles Davis", album: "Kind of Blue" }
            ]))
        }
    },
    {
        name: "albumRandomPick() returns an entry of the list, or null when the list has none",
        run: (t) => {
            const path = listWrite(t, "two.txt", ["A|One", "B|Two"])
            for (let i = 0; i < 10; i++) {
                const pick = t.spoon.albumRandomPick(path)
                t.assert.ok(pick && ["One", "Two"].includes(pick.album), `the pick: ${JSON.stringify(pick)}`)
            }
            const empty = listWrite(t, "empty.txt", ["# nothing here"])
            t.assert.equal(t.spoon.albumRandomPick(empty), null, "the pick from an empty list")
        }
    },
    {
        name: "albumChoose() lists the albums sorted by name, a link with \"link\" beneath it and a name with its band",
        run: async (t) => {
            const path = listWrite(t, "choose.txt", [
                "Radiohead|The Bends",
                "https://music.apple.com/ca/album/kid-a/1097862870 # Radiohead — Kid A",
                "Miles Davis|Kind of Blue"
            ])
            const rows = await chooserRows(t, path)
            // A link sorts by its name and a Band|Album line by its band and album, so the keys
            // are "miles davis kind of blue", "radiohead — kid a" and "radiohead the bends".
            t.assert.equal(rows.map((r) => `${r.text} / ${r.subText}`).join(" | "),
                "Kind of Blue / Miles Davis | Radiohead — Kid A / link | The Bends / Radiohead")
        }
    },
    // --- the example list ---
    {
        name: "the example list holds the Radiohead studio albums and albums by Miles Davis and Pink Floyd, all as links",
        run: (t) => {
            const entries = t.spoon.albumsRead(exampleFile())
            t.assert.ok(entries.length > 0, "the example list is empty")
            t.assert.ok(entries.every((e) => e.kind === "url"), "an entry is not a link")
            const by = (band) => entries.filter((e) => e.label.startsWith(`${band} — `)).length
            t.assert.equal(by("Radiohead"), 9, "Radiohead albums")
            t.assert.ok(by("Miles Davis") >= 2 && by("Pink Floyd") >= 2, `Miles Davis ${by("Miles Davis")}, Pink Floyd ${by("Pink Floyd")}`)
        }
    },
    {
        name: "when there is no list, the example is copied to albumListPath the first time it is needed, with an alert",
        run: (t) => {
            const alerts = t.alertsCapture()
            const path = listMissing(t, "copied.txt")
            const entries = t.spoon.albumsRead()
            t.assert.ok(hs.fs.exists(path), "the example was not copied")
            t.assert.equal(hs.fs.read(path), hs.fs.read(exampleFile()), "the copy's contents")
            t.assert.equal(entries.length, t.spoon.albumsRead(exampleFile()).length, "the entries read")
            t.assert.ok(alerts.some((m) => m.includes("example list was copied")), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    },
    {
        name: "when the example cannot be copied, it is read where it is, with an alert",
        run: (t) => {
            const alerts = t.alertsCapture()
            const config = t.spoon.config
            const original = config.albumListPath
            config.albumListPath = `${t.dir}/no-such-directory/albums.txt`
            t.cleanup(() => { config.albumListPath = original })
            const entries = t.spoon.albumsRead()
            t.assert.equal(entries.length, t.spoon.albumsRead(exampleFile()).length, "the entries read")
            t.assert.ok(alerts.some((m) => m.startsWith("Could not create")), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    },
    {
        name: "a path given to a function is read as it is, and the example is never copied to it",
        run: (t) => {
            const alerts = t.alertsCapture()
            const path = `${t.dir}/given.txt`
            const entries = t.spoon.albumsRead(path)
            t.assert.equal(entries.length, 0, "entries")
            t.assert.ok(!hs.fs.exists(path), "the example was copied to the path given")
            t.assert.ok(alerts.some((m) => m.startsWith("No album list at")), `alerts: ${alerts.join(" | ") || "none"}`)
        }
    },
    // --- adding the album playing ---
    {
        name: "currentAlbumAdd() adds the album playing as a link with its name, and not a second time",
        timeout: 30,
        run: async (t) => {
            if (!musicRunning()) t.skip("Music is not running")
            musicKeep(t)
            musicAsk("play")
            await musicStateWait(t, "playing")
            const track = musicAsk('return (get artist of current track) & "\\t" & (get album of current track)')
            if (!track) t.skip("Music has no current track to play")
            const [artist, album] = track.split("\t")
            const alerts = t.alertsCapture()
            const path = `${t.dir}/added.txt`
            t.spoon.currentAlbumAdd(path)
            const started = Date.now()
            while (!alerts.some((m) => m.startsWith("Added: ") || m.startsWith("Could not add"))) {
                if (Date.now() - started > 15000) t.assert.fail(`no alert of the addition; alerts: ${alerts.join(" | ") || "none"}`)
                await t.wait(0.2)
            }
            t.assert.ok(alerts.includes(`Added: ${artist} — ${album}`), `alerts: ${alerts.join(" | ")}`)
            const lines = String(hs.fs.read(path)).split("\n").filter(Boolean)
            t.assert.equal(lines.length, 1, "lines in the list")
            const name = `${artist} — ${album}`
            const asLink = /^https:\/\/music\.apple\.com\/\S+\/album\/\S+\/\d+ # /.test(lines[0]) && lines[0].endsWith(` # ${name}`)
            const asName = lines[0] === `${artist}|${album}`
            t.assert.ok(asLink || asName, `the line written: ${lines[0]}`)
            t.spoon.currentAlbumAdd(path)
            const again = Date.now()
            while (!alerts.some((m) => m.startsWith("Already listed: "))) {
                if (Date.now() - again > 15000) t.assert.fail(`not reported as already listed; alerts: ${alerts.join(" | ")}`)
                await t.wait(0.2)
            }
            t.assert.equal(String(hs.fs.read(path)).split("\n").filter(Boolean).length, 1, "lines after the second addition")
        }
    }
]

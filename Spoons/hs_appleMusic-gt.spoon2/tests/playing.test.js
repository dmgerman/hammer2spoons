// Tests of playing an album, as the readme describes it under "Playing an album" and "Albums".
//
// Each test makes Music play an album from the catalogue, through the album's page and its Play
// button, so it replaces what Music was playing; Music's scripting cannot return to a playlist
// afterwards. The volume, and whether Music was playing, are put back. The user agreed to this on
// 2026-11-27.

const { musicAsk, musicRunning, musicKeep, announce } = require("./music.js")

const KIND_OF_BLUE = "https://music.apple.com/ca/album/kind-of-blue/268443092 # Miles Davis — Kind of Blue"
const SILENT_WAY = "https://music.apple.com/ca/album/in-a-silent-way/193603857 # Miles Davis — In a Silent Way"

function listWrite(t, name, lines) {
    const path = `${t.dir}/${name}`
    hs.fs.write(path, lines.join("\n") + "\n", false)
    return path
}

// Waits until Music plays a track of an album whose name contains `album`, for at most `seconds`,
// and returns the album then playing.
async function albumPlayingWait(t, album, seconds) {
    const started = Date.now()
    let now = null
    while (Date.now() - started < seconds * 1000) {
        const line = await musicAsk('return (get player state as text) & tab & (get album of current track)')
        const [state, playing] = String(line).split("\t")
        now = playing
        if (state === "playing" && playing && playing.includes(album)) return playing
        await t.wait(1)
    }
    return now
}

async function prepare(t) {
    if (!musicRunning()) t.skip("Music is not running")
    await musicKeep(t)
}

module.exports = [
    {
        name: "albumRandomPlay() names the album in an alert and plays it",
        timeout: 60,
        run: async (t) => {
            await prepare(t)
            const path = listWrite(t, "one.txt", [KIND_OF_BLUE])
            const alerts = t.alertsCapture()
            announce("Next: Random album, from a list holding only Kind of Blue")
            t.spoon.albumRandomPlay(path)
            const playing = await albumPlayingWait(t, "Kind of Blue", 40)
            t.assert.ok(alerts.includes("Miles Davis — Kind of Blue"), `alerts: ${alerts.join(" | ") || "none"}`)
            t.assert.ok(playing && playing.includes("Kind of Blue"), `the album playing: ${playing}`)
        }
    },
    {
        name: "albumChoose() plays the album chosen in the chooser",
        timeout: 60,
        run: async (t) => {
            await prepare(t)
            const path = listWrite(t, "two.txt", [KIND_OF_BLUE, SILENT_WAY])
            const interactive = hs.spoons["hs_interactive-gt"]
            announce("Next: Choose album, typing \"silent\" and choosing In a Silent Way")
            t.spoon.albumChoose(path)
            const started = Date.now()
            while (!interactive.promptIsOpen()) {
                if (Date.now() - started > 3000) t.assert.fail("the album chooser did not open")
                await t.wait(0.05)
            }
            await t.wait(0.3)
            for (const key of "silent") {
                hs.eventtap.keyStroke([], key, null)
                await t.wait(0.05)
            }
            await t.wait(0.3)
            if (interactive.promptIsOpen()) hs.eventtap.keyStroke([], "return", null)
            const playing = await albumPlayingWait(t, "In a Silent Way", 40)
            t.assert.ok(playing && playing.includes("In a Silent Way"), `the album playing: ${playing}`)
        }
    },
    {
        name: "albumPlay() finds an album by its band and name in the catalogue, and plays it",
        timeout: 60,
        run: async (t) => {
            await prepare(t)
            announce("Next: albumPlay(\"Pink Floyd\", \"Meddle\")")
            t.spoon.albumPlay("Pink Floyd", "Meddle")
            const playing = await albumPlayingWait(t, "Meddle", 40)
            t.assert.ok(playing && playing.includes("Meddle"), `the album playing: ${playing}`)
        }
    }
]

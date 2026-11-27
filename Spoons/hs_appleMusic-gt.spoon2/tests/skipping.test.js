// Tests of skipping to another album, as the readme describes it under "Skipping to another album".
//
// They use what Music is playing: a playlist, or anything else that Music will continue with
// another album. Music's Previous does not reach its History, so an album played before cannot be
// used (measured on 2026-11-27). The album that follows is read from the queue panel (albumAfter()
// in music.js); when none follows, the test is skipped. Afterwards the test plays the user's track
// again and puts back whether Music was playing; the position within the track is lost.

const { musicAsk, musicRunning, musicKeep, announce, albumAfter, trackReturn } = require("./music.js")

// The name and the album in one question, so that a skip cannot fall between the two.
async function trackNow() {
    const line = await musicAsk('return (get name of current track) & tab & (get album of current track)')
    const [name, album] = String(line).split("\t")
    return { name, album }
}

// Waits for the Spoon's alert that the skip has ended, for at most `seconds`, then reads the track.
// Polling the album instead read it while the Spoon was still skipping.
async function skipWait(t, alerts, seconds) {
    const began = Date.now()
    const count = alerts.length
    while (Date.now() - began < seconds * 1000) {
        const done = alerts.slice(count).find((m) => m.startsWith("Album: ") || m.startsWith("No other album"))
        if (done) {
            const track = await trackNow()
            announce(`Now on "${track.album}": ${track.name}`)
            return { alert: done, track }
        }
        await t.wait(0.5)
    }
    return { alert: null, track: await trackNow() }
}

module.exports = [
    {
        name: "albumNext moves to the first track of the album that follows, and albumPrevious back to the album before",
        timeout: 180,
        run: async (t) => {
            if (!musicRunning()) t.skip("Music is not running")
            announce("Recording Music's volume and whether it plays, to put them back afterwards")
            await musicKeep(t)
            if (await musicAsk("get player state as text") !== "playing") t.skip("Music is not playing")
            const start = await trackNow()
            t.assert.ok(start.album, "Music reported no album")

            announce("Reading the album that follows from Music's queue panel")
            const after = albumAfter(start.album)
            if (!after) t.skip(`no other album follows "${start.album}" in what Music is playing`)
            const nextAlbum = after.detail.slice(after.detail.lastIndexOf(" — ") + 3)
            t.cleanup(async () => {
                announce(`Playing your track again: ${start.name}`)
                await trackReturn(start.name)
            })

            const alerts = t.alertsCapture()
            announce(`Next: Next album, from "${start.album}" to "${nextAlbum}"`)
            t.spoon.albumNext()
            const nextSkip = await skipWait(t, alerts, 40)
            const next = nextSkip.track
            t.assert.equal(nextSkip.alert, `Album: ${nextAlbum}`, "the alert of Next album")
            t.assert.equal(next.album, nextAlbum, "the album after Next album")
            t.assert.equal(next.name, after.title, "the track after Next album")

            announce(`Next: Prev album, from "${nextAlbum}" back to "${start.album}"`)
            t.spoon.albumPrevious()
            const backSkip = await skipWait(t, alerts, 60)
            const back = backSkip.track
            t.assert.equal(backSkip.alert, `Album: ${start.album}`, "the alert of Prev album")
            t.assert.equal(back.album, start.album, "the album after Prev album")

            // On the album's first track, the track before belongs to another album. When Music
            // stays on the same track, nothing comes before it, and there is nothing to check.
            await t.wait(3)
            announce(`Next: one track back from "${back.name}", to check that it is the album's first track`)
            await musicAsk("previous track")
            await t.wait(1)
            const before = await trackNow()
            if (before.name !== back.name) {
                t.assert.ok(before.album !== start.album, `the track before "${back.name}", which Prev album left playing, is "${before.name}" on the same album`)
            }
        }
    }
]

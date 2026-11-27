// Tests of skipping to another album, as the readme describes it under "Skipping to another album".
//
// They use what Music is playing: a playlist, or anything else that Music will continue with
// another album. Music's Previous does not reach its History, so an album played before cannot be
// used (measured on 2026-11-27). The album that follows is read from the queue panel (albumAfter()
// in music.js); when none follows, the test is skipped. Afterwards the test plays the user's track
// again and puts back whether Music was playing; the position within the track is lost.

const { musicAsk, musicRunning, musicKeep, announce, albumAfter, trackReturn } = require("./music.js")

const trackNow = async () => ({
    name: await musicAsk("get name of current track"),
    album: await musicAsk("get album of current track")
})

// Polls Music until `done(track)` is true, announcing each answer, for at most `seconds`.
async function trackWait(t, done, seconds) {
    const began = Date.now()
    let track = await trackNow()
    while (!done(track) && Date.now() - began < seconds * 1000) {
        await t.wait(1)
        track = await trackNow()
        announce(`Now on "${track.album}": ${track.name}`)
    }
    return track
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

            announce(`Next: Next album, from "${start.album}" to "${nextAlbum}"`)
            t.spoon.albumNext()
            const next = await trackWait(t, (track) => track.album === nextAlbum, 40)
            t.assert.equal(next.album, nextAlbum, "the album after Next album")
            t.assert.equal(next.name, after.title, "the track after Next album")

            announce(`Next: Prev album, from "${nextAlbum}" back to "${start.album}"`)
            t.spoon.albumPrevious()
            const back = await trackWait(t, (track) => track.album === start.album, 60)
            t.assert.equal(back.album, start.album, "the album after Prev album")
        }
    }
]

// Helpers for hs_appleMusic-gt's tests, which control the user's Music application. The user
// agreed to this on 2026-11-23.
//
//   const { musicKeep, musicAsk } = require("./music.js")
//
// A test that changes what Music is doing calls musicKeep() first. When the test ends, Music is
// paused again if it was not playing, and its volume is put back. The track Music was on cannot
// be put back, because Music's scripting interface cannot return to a track in the queue it was
// playing from.

const MUSIC_BUNDLE_ID = "com.apple.Music"

/** Asks Music directly, without the copy, and returns the result as text, or null. */
function musicAsk(body) {
    const outcome = hs.osascript.applescriptSync(`tell application "Music"\n${body}\nend tell`)
    if (!outcome || !outcome.success) return null
    return outcome.result === undefined || outcome.result === null ? "" : String(outcome.result)
}

const musicRunning = () => hs.application.matchingBundleID(MUSIC_BUNDLE_ID) !== null

/** Records Music's player state and volume, and puts them back when the test ends. */
function musicKeep(t) {
    if (!musicRunning()) return
    const state = musicAsk("get player state as text")
    const volume = musicAsk("get sound volume")
    t.cleanup(async () => {
        if (state !== "playing" && musicAsk("get player state as text") === "playing") musicAsk("pause")
        if (volume !== null && volume !== "") musicAsk(`set sound volume to ${Number(volume)}`)
    })
}

/** Resolves once Music reports `state`, or fails after `seconds`. */
async function musicStateWait(t, state, seconds = 5) {
    const started = Date.now()
    while (musicAsk("get player state as text") !== state) {
        if (Date.now() - started > seconds * 1000) t.assert.fail(`Music did not reach "${state}" within ${seconds} s`)
        await t.wait(0.2)
    }
}

module.exports = { MUSIC_BUNDLE_ID, musicAsk, musicRunning, musicKeep, musicStateWait }

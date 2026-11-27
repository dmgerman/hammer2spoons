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

// The longest a test waits for Music to answer one question, in seconds.
const ANSWER_TIMEOUT = 10

/**
 * Asks Music directly, without the copy, and resolves to the result as text, or null when the
 * script fails or Music does not answer within ANSWER_TIMEOUT seconds.
 *
 * Asked with the asynchronous hs.osascript.applescript(). The synchronous form blocks all of
 * Hammerspoon 2 until Music answers, and Music can take minutes while it opens an album page:
 * on 2026-11-23 that froze Hammerspoon 2 during a run. See ai/tests-hs_appleMusic-gt.org.
 */
function musicAsk(body) {
    const asked = hs.osascript.applescript(`tell application "Music"\n${body}\nend tell`)
        .then((outcome) => {
            if (!outcome || !outcome.success) return null
            return outcome.result === undefined || outcome.result === null ? "" : String(outcome.result)
        })
        .catch(() => null)
    const late = new Promise((resolve) => hs.timer.doAfter(ANSWER_TIMEOUT, () => resolve(null)))
    return Promise.race([asked, late])
}

const musicRunning = () => hs.application.matchingBundleID(MUSIC_BUNDLE_ID) !== null

/**
 * Records Music's player state and volume, and puts them back when the test ends: Music plays
 * again if it was playing, and is paused if it was not.
 */
async function musicKeep(t) {
    if (!musicRunning()) return
    const state = await musicAsk("get player state as text")
    const volume = await musicAsk("get sound volume")
    t.cleanup(async () => {
        if (volume !== null && volume !== "") await musicAsk(`set sound volume to ${Number(volume)}`)
        const now = await musicAsk("get player state as text")
        if (state === "playing" && now !== "playing") await musicAsk("play")
        if (state !== "playing" && now === "playing") await musicAsk("pause")
    })
}

/** Resolves once Music reports `state`, or fails after `seconds`. */
async function musicStateWait(t, state, seconds = 15) {
    const started = Date.now()
    while (await musicAsk("get player state as text") !== state) {
        if (Date.now() - started > seconds * 1000) t.assert.fail(`Music did not reach "${state}" within ${seconds} s`)
        await t.wait(0.2)
    }
}

module.exports = { MUSIC_BUNDLE_ID, musicAsk, musicRunning, musicKeep, musicStateWait }

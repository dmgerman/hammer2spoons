// Tests of auto-play, as the readme describes it under "Auto-play".
//
// Auto-play acts on Music's playerInfo notification. These tests post that notification
// themselves, with hs.distributednotifications.post(), and answer the Spoon's question about the
// player state in place of Music, so that Music is neither stopped nor played. The album list is an
// empty file, so when auto-play acts it reports that the list is empty and turns itself off: that
// alert is how the tests see it act. A posted notification is distributed to every application, so
// another application listening to Music also receives these.

const { musicRunning } = require("./music.js")

const PLAYER_INFO = "com.apple.Music.playerInfo"
const EMPTY = "Auto-play off: no albums in "

// Answers "get player state as text" with `state.value` instead of asking Music, until the test ends.
function playerStateFake(t, state) {
    const original = hs.osascript.applescript
    const own = Object.prototype.hasOwnProperty.call(hs.osascript, "applescript")
    hs.osascript.applescript = function (script) {
        if (/get player state as text/.test(String(script))) return Promise.resolve({ success: true, result: state.value, raw: state.value })
        return original.apply(hs.osascript, arguments)
    }
    t.cleanup(() => { if (own) hs.osascript.applescript = original; else delete hs.osascript.applescript })
}

// An empty album list, and auto-play turned off when the test ends.
function autoPlayPrepare(t) {
    if (!musicRunning()) t.skip("Music is not running")
    const path = `${t.dir}/empty.txt`
    hs.fs.write(path, "", false)
    const original = t.spoon.config.albumListPath
    t.spoon.config.albumListPath = path
    t.cleanup(() => {
        t.spoon.autoPlayStop()
        t.spoon.config.albumListPath = original
    })
}

// Waits up to `seconds` for an alert that starts with `prefix`, and returns whether one came.
async function alertWait(t, alerts, prefix, seconds) {
    const started = Date.now()
    while (Date.now() - started < seconds * 1000) {
        if (alerts.some((m) => m.startsWith(prefix))) return true
        await t.wait(0.2)
    }
    return false
}

const stopped = () => hs.distributednotifications.post(PLAYER_INFO, null, { "Player State": "Stopped" })

module.exports = [
    {
        name: "autoPlayStart() acts at once when Music is already stopped",
        timeout: 20,
        run: async (t) => {
            autoPlayPrepare(t)
            const state = { value: "stopped" }
            playerStateFake(t, state)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.autoPlayStart(), true, "autoPlayStart()")
            t.assert.ok(await alertWait(t, alerts, EMPTY, 5), `alerts: ${alerts.join(" | ") || "none"}`)
            t.assert.equal(t.spoon.autoPlayIsEnabled(), false, "auto-play after an empty list")
        }
    },
    {
        name: "while auto-play is on, Music's Stopped notification starts an album, and Paused does nothing",
        timeout: 30,
        run: async (t) => {
            autoPlayPrepare(t)
            const state = { value: "paused" }
            playerStateFake(t, state)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.autoPlayStart(), true, "autoPlayStart()")
            t.assert.equal(await alertWait(t, alerts, EMPTY, 3), false, "acted while Music is paused")

            hs.distributednotifications.post(PLAYER_INFO, null, { "Player State": "Paused" })
            t.assert.equal(await alertWait(t, alerts, EMPTY, 3), false, "acted on Paused")

            state.value = "stopped"
            stopped()
            t.assert.ok(await alertWait(t, alerts, EMPTY, 5), `no action on Stopped; alerts: ${alerts.join(" | ") || "none"}`)
            t.assert.equal(t.spoon.autoPlayIsEnabled(), false, "auto-play after an empty list")
        }
    },
    {
        name: "a Stopped notification does nothing when Music reports that it is not stopped a second later",
        timeout: 20,
        run: async (t) => {
            autoPlayPrepare(t)
            const state = { value: "paused" }
            playerStateFake(t, state)
            const alerts = t.alertsCapture()
            t.spoon.autoPlayStart()
            stopped()
            t.assert.equal(await alertWait(t, alerts, EMPTY, 4), false, "acted although Music was not stopped")
            t.assert.equal(t.spoon.autoPlayIsEnabled(), true, "auto-play is still on")
        }
    },
    {
        name: "after autoPlayStop(), a Stopped notification does nothing",
        timeout: 20,
        run: async (t) => {
            autoPlayPrepare(t)
            const state = { value: "paused" }
            playerStateFake(t, state)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.autoPlayStart(), true, "autoPlayStart()")
            t.assert.equal(t.spoon.autoPlayStop(), true, "autoPlayStop()")
            t.assert.equal(t.spoon.autoPlayIsEnabled(), false, "autoPlayIsEnabled()")
            state.value = "stopped"
            stopped()
            t.assert.equal(await alertWait(t, alerts, EMPTY, 4), false, "acted after autoPlayStop()")
        }
    }
]

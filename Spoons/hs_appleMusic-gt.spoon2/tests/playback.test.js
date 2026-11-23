// Tests of playback, the track playing and the volume, as the readme describes them under
// "Playback", "The track playing" and "Volume". They control the user's Music application, which
// the user agreed to on 2026-11-23, on whatever Music has loaded: no album page is opened.
// musicKeep() puts Music's playing or paused state and its volume back after each test.
//
// Music's volume is changed only while Music is paused, so that nothing plays loudly. The output
// device's volume is only set to the value it already has, so the user's speakers never change.
// currentTrackShow() copies to the clipboard, so that test pauses the user's hs_clipboard-gt and
// puts the clipboard back.

const { MUSIC_BUNDLE_ID, musicAsk, musicRunning, musicKeep, musicStateWait } = require("./music.js")

// Skips the test unless Music is running, makes sure it has a track loaded, playing it when it
// has none, and keeps Music's state. A question about the current track fails while Music changes
// state, so it is asked again before the test gives up.
async function needTrack(t) {
    if (!musicRunning()) t.skip("Music is not running")
    await musicKeep(t)
    if (await currentName() !== null) return
    await musicAsk("play")
    const started = Date.now()
    while (await currentName() === null) {
        if (Date.now() - started > 10000) t.skip("Music has no track loaded")
        await t.wait(0.3)
    }
}

const currentName = () => musicAsk("get name of current track")

// Resolves once the current track's name differs from `name`, or fails after `seconds`.
async function trackChange(t, name, seconds = 10) {
    const started = Date.now()
    while (true) {
        const now = await currentName()
        if (now !== null && now !== name) return now
        if (Date.now() - started > seconds * 1000) t.assert.fail(`the track stayed "${name}" for ${seconds} s`)
        await t.wait(0.2)
    }
}

async function playing(t) {
    await musicAsk("play")
    await musicStateWait(t, "playing")
}

async function paused(t) {
    await musicAsk("pause")
    await musicStateWait(t, "paused")
}

// Answers hs.application.matchingBundleID() for Music with null until the test ends, so that the
// copy takes Music to be not running. Every other call is passed on.
function musicHidden(t) {
    const original = hs.application.matchingBundleID
    const own = Object.prototype.hasOwnProperty.call(hs.application, "matchingBundleID")
    hs.application.matchingBundleID = function (bundle) {
        if (bundle === MUSIC_BUNDLE_ID) return null
        return original.apply(hs.application, arguments)
    }
    t.cleanup(() => { if (own) hs.application.matchingBundleID = original; else delete hs.application.matchingBundleID })
}

// Pauses the user's hs_clipboard-gt and saves the clipboard's text, and puts both back when the
// test ends, as hs_clipboard-gt's own tests do.
function clipboardProtect(t) {
    const text = hs.pasteboard.readString()
    const user = hs.spoons["hs_clipboard-gt"]
    let kept = null
    if (user) {
        kept = { honor: user.config.honorIgnoredIdentifiers, ids: user.config.ignoredIdentifiers }
        const everything = []
        everything.includes = () => true
        user.config.honorIgnoredIdentifiers = true
        user.config.ignoredIdentifiers = everything
    }
    t.cleanup(async () => {
        if (text !== null && text !== undefined) hs.pasteboard.writeString(text)
        // The user's Spoon reads the clipboard at its interval; waiting longer than that lets it
        // see the restored text while it is still paused.
        await t.wait((Number(hs.pasteboard.watcherInterval) || 0.8) * 2 + 0.5)
        if (user && kept) {
            user.config.honorIgnoredIdentifiers = kept.honor
            user.config.ignoredIdentifiers = kept.ids
        }
    })
}


module.exports = [
    // --- playback ---
    {
        name: "playerState(), isPlaying() and isRunning() report what Music is doing",
        timeout: 40,
        run: async (t) => {
            await needTrack(t)
            await playing(t)
            t.assert.equal(t.spoon.playerState(), "playing", "playerState() while playing")
            t.assert.equal(t.spoon.isPlaying(), true, "isPlaying() while playing")
            t.assert.equal(t.spoon.isRunning(), true, "isRunning()")
            await paused(t)
            t.assert.equal(t.spoon.playerState(), "paused", "playerState() while paused")
            t.assert.equal(t.spoon.isPlaying(), false, "isPlaying() while paused")
        }
    },
    {
        name: "playPauseToggle() pauses Music when it plays and plays it otherwise, and play() resumes after a pause",
        timeout: 40,
        run: async (t) => {
            await needTrack(t)
            await playing(t)
            t.spoon.playPauseToggle()
            await musicStateWait(t, "paused")
            t.spoon.playPauseToggle()
            await musicStateWait(t, "playing")
            await paused(t)
            t.spoon.play()
            await musicStateWait(t, "playing")
        }
    },
    {
        name: "trackNext() and trackPrevious() go to the next and the previous track",
        timeout: 40,
        run: async (t) => {
            // Music reports a track number of 0 for a track streamed from the catalogue, so
            // tracks are told apart by name.
            await needTrack(t)
            await playing(t)
            const start = await currentName()
            t.spoon.trackNext()
            const next = await trackChange(t, start)
            t.spoon.trackPrevious()
            const back = await trackChange(t, next)
            t.assert.equal(back, start, "the track after trackPrevious()")
        }
    },
    {
        name: "playbackStop() stops Music, and playing again starts the album from its first track",
        timeout: 40,
        run: async (t) => {
            // The first track's name cannot be asked of a streamed album, so the test moves past
            // the track playing, stops, and checks that playing again does not resume that track.
            await needTrack(t)
            await playing(t)
            const start = await currentName()
            t.spoon.trackNext()
            const second = await trackChange(t, start)
            t.spoon.playbackStop()
            await musicStateWait(t, "stopped")
            t.spoon.play()
            await musicStateWait(t, "playing")
            const now = await currentName()
            t.assert.ok(now !== second, `playing again resumed "${second}"`)
            t.assert.ok(Number(await musicAsk("get player position")) < 5, "playing again did not start at the beginning of a track")
        }
    },
    {
        name: "focus() makes Music the frontmost application",
        timeout: 20,
        run: async (t) => {
            if (!musicRunning()) t.skip("Music is not running")
            t.spoon.focus()
            await t.wait(1)
            const front = hs.application.frontmost()
            t.assert.equal(front && front.bundleID, MUSIC_BUNDLE_ID, "the frontmost application")
        }
    },
    {
        name: "when Music is not running, the playback functions show \"Music is not running\" and do nothing else",
        run: (t) => {
            musicHidden(t)
            const alerts = t.alertsCapture()
            const scripts = []
            const original = hs.osascript.applescriptSync
            const own = Object.prototype.hasOwnProperty.call(hs.osascript, "applescriptSync")
            hs.osascript.applescriptSync = function (script) {
                if (String(script).startsWith('tell application "Music"')) scripts.push(script)
                return original.apply(hs.osascript, arguments)
            }
            t.cleanup(() => { if (own) hs.osascript.applescriptSync = original; else delete hs.osascript.applescriptSync })
            const names = ["playPauseToggle", "play", "playbackStop", "trackNext", "trackPrevious", "albumNext", "albumPrevious"]
            for (const name of names) t.spoon[name]()
            t.assert.equal(alerts.filter((m) => m === "Music is not running").length, names.length, `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(scripts.length, 0, "scripts sent to Music")
            t.assert.equal(t.spoon.playerState(), "not running", "playerState()")
            t.assert.equal(t.spoon.isRunning(), false, "isRunning()")
            t.assert.equal(t.spoon.currentTrack(), null, "currentTrack()")
            t.assert.equal(t.spoon.volumeGet(), null, "volumeGet()")
        }
    },
    // --- the track playing ---
    {
        name: "currentTrack(), currentArtist() and currentAlbum() describe the track playing",
        timeout: 30,
        run: async (t) => {
            await needTrack(t)
            const name = await musicAsk("get name of current track")
            const artist = await musicAsk("get artist of current track")
            const album = await musicAsk("get album of current track")
            const duration = Number(await musicAsk("get duration of current track"))
            const track = t.spoon.currentTrack()
            t.assert.ok(track, "currentTrack() returned null")
            t.assert.equal(`${track.name} | ${track.artist} | ${track.album}`, `${name} | ${artist} | ${album}`, "the names")
            t.assert.ok(Math.abs(track.duration - duration) < 1, `the duration: ${track.duration} against ${duration}`)
            t.assert.equal(t.spoon.currentArtist(), artist, "currentArtist()")
            t.assert.equal(t.spoon.currentAlbum(), album, "currentAlbum()")
        }
    },
    {
        name: "currentTrackText() and currentTrackShow() describe the track, with its album's address, and currentTrackShow() copies it",
        timeout: 40,
        run: async (t) => {
            await needTrack(t)
            clipboardProtect(t)
            const alerts = t.alertsCapture()
            const track = t.spoon.currentTrack()
            const text = await t.spoon.currentTrackText()
            const first = `${track.name} - ${track.artist} [${track.album}]`
            t.assert.ok(text && text.startsWith(first), `the text: ${text}`)
            const url = await t.spoon.currentAlbumURL()
            if (url) {
                t.assert.ok(/^https:\/\/music\.apple\.com\/\S+\/album\/\S+\/\d+$/.test(url), `the address: ${url}`)
                t.assert.equal(text, `${first}\n${url}`, "the text with the address")
            } else {
                t.assert.equal(text, first, "the text without an address")
            }
            t.spoon.currentTrackShow()
            const started = Date.now()
            while (!alerts.includes(text)) {
                if (Date.now() - started > 15000) t.assert.fail(`no alert of the text; alerts: ${alerts.join(" | ") || "none"}`)
                await t.wait(0.2)
            }
            t.assert.equal(hs.pasteboard.readString(), text, "the clipboard")
        }
    },
    {
        name: "albumURLResolve() gives null for a track the catalogue does not have",
        timeout: 20,
        run: async (t) => {
            const url = await t.spoon.albumURLResolve({ name: "No Such Track 7731", artist: "Zq Test Band 7731", album: "No Such Album 7731", duration: 100 })
            t.assert.equal(url, null)
        }
    },
    // --- volume ---
    {
        name: "volumeGet(), volumeSet(), volumeAdjust() and volumeShow() read and set Music's volume, from 0 to 100",
        timeout: 40,
        run: async (t) => {
            await needTrack(t)
            await paused(t)
            const alerts = t.alertsCapture()
            t.assert.equal(t.spoon.volumeGet(), Number(await musicAsk("get sound volume")), "volumeGet()")
            t.assert.equal(t.spoon.volumeSet(30), 30, "volumeSet(30)")
            t.assert.equal(Number(await musicAsk("get sound volume")), 30, "Music's volume after volumeSet(30)")
            t.assert.equal(t.spoon.volumeAdjust(5), 35, "volumeAdjust(5)")
            t.assert.ok(alerts.includes("Volume 35"), `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(t.spoon.volumeAdjust(-10), 25, "volumeAdjust(-10)")
            t.assert.equal(t.spoon.volumeShow(), 25, "volumeShow()")
            t.assert.ok(alerts.filter((m) => m === "Volume 25").length >= 2, `alerts: ${alerts.join(" | ")}`)
            t.assert.equal(t.spoon.volumeSet(-5), 0, "volumeSet(-5)")
            t.assert.equal(t.spoon.volumeSet(150), 100, "volumeSet(150)")
            t.assert.equal(Number(await musicAsk("get sound volume")), 100, "Music's volume after volumeSet(150)")
        }
    },
    {
        name: "systemVolume() reads the output device's volume, and systemVolumeSet() sets it, reads it back and shows it",
        run: (t) => {
            const device = hs.audiodevice.defaultOutputDevice()
            if (!device) t.skip("there is no output device")
            const alerts = t.alertsCapture()
            const now = t.spoon.systemVolume()
            if (now === null) t.skip(`${device.name} has no volume that can be set`)
            t.assert.equal(now, Math.round(Number(device.volume) * 100), "systemVolume()")
            // Set to the value it has, so that the user's speakers do not change.
            t.assert.equal(t.spoon.systemVolumeSet(now), now, "systemVolumeSet()")
            t.assert.ok(alerts.includes(`System volume ${now}`), `alerts: ${alerts.join(" | ")}`)
        }
    }
]

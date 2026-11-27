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

/**
 * Shows the user what the test does next, in an alert, and writes it to the console with the
 * seconds since the run's first step, so that a slow step can be found afterwards.
 */
let announcedFrom = null
function announce(text) {
    if (announcedFrom === null) announcedFrom = Date.now()
    hs.ui.alert(text).duration(2.5).show()
    console.log(`[hs_appleMusic-gt test] ${((Date.now() - announcedFrom) / 1000).toFixed(1)} s: ${text}`)
}

const axValue = (element, name) => {
    try {
        const value = element.attributeValue(name)
        return value === undefined ? null : value
    } catch (e) {
        return null
    }
}

/**
 * The first element of Music's window, breadth first, for which `test` is true, or null. Tables,
 * outlines and rows are not entered, because they hold Music's longest lists, and at most `limit`
 * elements are visited, so that the search is short.
 */
function musicFind(test, limit = 400) {
    const app = hs.application.matchingBundleID(MUSIC_BUNDLE_ID)
    if (!app) return null
    const pending = [hs.ax.applicationElement(app)]
    let visited = 0
    while (pending.length && visited < limit) {
        const element = pending.shift()
        visited++
        if (test(element)) return element
        if (/^AX(Table|Outline|Row|MenuBar)$/.test(String(axValue(element, "AXRole")))) continue
        pending.push(...(element.children() || []))
    }
    return null
}

/**
 * The rows of the queue panel, each as {heading} for a section heading or {title, detail, cell} for a
 * track, where detail is "Artist — Album". Null when the panel is closed.
 */
function queueRows() {
    const split = musicFind((el) => axValue(el, "AXRole") === "AXSplitGroup")
    const panel = split ? (split.children() || []).find((c) =>
        /play queue|headerContainer/.test(`${axValue(c, "AXDescription")} ${axValue(c, "AXIdentifier")}`)) : null
    if (!panel) return null
    const scroller = (panel.children() || [])[0]
    const table = scroller ? (scroller.children() || []).find((c) => axValue(c, "AXRole") === "AXTable") : null
    if (!table) return null
    return (table.children() || []).filter((c) => axValue(c, "AXRole") === "AXRow").map((row) => {
        const cell = (row.children() || [])[0]
        const texts = (cell ? cell.children() || [] : [])
            .filter((c) => axValue(c, "AXRole") === "AXStaticText").map((c) => String(axValue(c, "AXValue") || ""))
        return texts.length === 1 ? { heading: texts[0], cell } : { title: texts[0], detail: texts[1], cell }
    })
}

/**
 * The first album after the one playing, from the queue panel's sections after History (Queue,
 * Continue Playing), as {detail, title}: "Artist — Album" and the name of its first track. Null when
 * no other album follows, or the panel is closed.
 */
function albumAfter(currentAlbum) {
    const rows = queueRows() || []
    let section = null
    for (const row of rows) {
        if (row.heading) {
            section = row.heading
            continue
        }
        if (section === "History" || !row.detail) continue
        if (!row.detail.endsWith(` — ${currentAlbum}`)) return { detail: row.detail, title: row.title }
    }
    return null
}

/**
 * Plays again the track called `name` in the current queue, stepping back with `previous track`
 * (sent twice, because once only restarts a track that has played a few seconds) and then forward,
 * until Music reports it. The position within the track is not restored: Music's scripting cannot
 * return to it. Resolves to whether the track was found.
 */
async function trackReturn(name) {
    for (const command of ["previous track", "next track"]) {
        for (let i = 0; i < 25; i++) {
            if (await musicAsk("get name of current track") === name) return true
            await musicAsk(command)
            if (command === "previous track") await musicAsk(command)
            await new Promise((r) => hs.timer.doAfter(0.8, r))
        }
    }
    return await musicAsk("get name of current track") === name
}

module.exports = { MUSIC_BUNDLE_ID, musicAsk, musicRunning, musicKeep, musicStateWait, announce,
    albumAfter, trackReturn }

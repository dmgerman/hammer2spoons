// hs_appleMusic-gt — a port of the Hammerspoon 1 hs_music Spoon.
//
// Playback, volume and track information go through AppleScript: Hammerspoon 2 has no
// hs.itunes, and Music's scripting interface covers all of it.
//
// Playing a named album cannot. AppleScript reaches only what is in the library, and a
// library that streams holds almost nothing, so an album from the list has to be played
// the way a person would. Version 1 typed into Music's search field and clicked the first
// card in the results. This asks the iTunes Search API for the album's identifier instead,
// opens that album's page with a music:// URL, and presses the Play button on it. The
// album is then chosen by identifier rather than by whichever card came first, which is
// what kept turning a plain album into its deluxe edition.

// MARK: - User-configurable settings

const config = {
    // The album list: one album per line, as an Apple Music address or as "Band|Album".
    // When this file does not exist, the example list included with the Spoon is copied here
    // the first time an album is chosen.
    albumListPath: `${hs.appinfo.configDir}/albums.txt`,

    // Which Apple Music storefront to search, as a two-letter country code such as "us" or
    // "jp". A wrong one finds nothing. Null uses the region of the system's locale.
    storefront: null,

    // Placeholders: {name}, {artist}, {album}, {url}.
    trackFormat: "{name} - {artist} [{album}]",
    // Used in place of trackFormat once the album's page has been found.
    trackURLFormat: "{name} - {artist} [{album}]\n{url}",
    alertDuration: 3,

    // How far the length the API reports may sit from the length Music reports before the
    // two are taken to be different recordings. Seconds.
    durationTolerance: 2,

    // albumNext and albumPrevious skip a track at a time until the album changes. The
    // limit stops a long playlist of single-track albums from skipping forever. An expanded
    // edition can have more than 20 tracks.
    maxAlbumSkipAttempts: 50,

    // The album page takes a moment to render after the URL opens, so its Play button is
    // waited for rather than expected.
    playButtonTitle: "Play",
    playButtonPollInterval: 0.4,
    playButtonTimeout: 10,

    // How many search results to consider before matching on name.
    searchLimit: 25,

    // Seconds to wait for Apple Music to answer a question or a command. A step that is not
    // answered in time gives up with an alert, so that a busy Apple Music cannot stop
    // Hammerspoon 2 from responding.
    answerTimeout: 5
}

const MUSIC_BUNDLE_ID = "com.apple.Music"

// The example album list included with the Spoon, copied for a user who has none.
const EXAMPLE_ALBUM_LIST = `${__dirname}/albums.txt`

// MARK: - State

let autoPlayEnabled = false
// While auto-play starts an album, the Stopped that Music may post as the album page opens is
// ignored until this time, in milliseconds.
let autoPlayQuietUntil = 0
// Incremented to stop an album skip in progress: a skip stops when this differs from the value it
// started with.
let albumSkipRun = 0
// Called with each of Music's playerInfo notifications while a skip waits for one, or null.
let playerInfoWaiter = null
let playButtonTimer = null

// MARK: - Talking to Music

function alert(message) {
    hs.ui.alert(message).duration(config.alertDuration).show()
}

/** A string as the contents of an AppleScript string literal. */
function forAppleScript(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Run AppleScript against Music, without waiting for it: Hammerspoon 2 keeps responding while
 * Music answers. hs.osascript.applescriptSync() would block all of Hammerspoon 2 until Music
 * answered, with no time limit: on 2026-11-27 a slow Apple Music froze it until the user killed
 * it (hammer2spoons-9i2).
 *
 * @param {string} body The statements inside `tell application "Music"`.
 * @returns {Promise<?string>} The result as text, or null when the script failed or Music did not
 *          answer within config.answerTimeout seconds. It never rejects. A late answer is ignored,
 *          but the script itself cannot be cancelled and still runs in Music.
 */
function musicTell(body) {
    const asked = hs.osascript.applescript(`tell application "Music"\n${body}\nend tell`)
        .then((outcome) => {
            if (!outcome || !outcome.success) {
                console.error(`[hs_appleMusic-gt] AppleScript failed: ${outcome ? outcome.raw : "no result"}`)
                return null
            }
            return outcome.result === undefined || outcome.result === null ? "" : String(outcome.result)
        })
        .catch((e) => {
            console.error(`[hs_appleMusic-gt] AppleScript failed: ${e}`)
            return null
        })
    let timer = null
    const late = new Promise((resolve) => {
        timer = hs.timer.doAfter(config.answerTimeout, () => {
            alert(`Apple Music did not answer within ${config.answerTimeout} s`)
            resolve(null)
        })
    })
    return Promise.race([asked, late]).finally(() => timer.stop())
}

/** Whether Music is running. Asked of the application list, so Music is not launched. */
function isRunning() {
    return hs.application.matchingBundleID(MUSIC_BUNDLE_ID) !== null
}

/** Reports and returns false when Music is not running, for the callers that need it. */
function runningRequire() {
    if (isRunning()) return true
    alert("Music is not running")
    return false
}

/** A promise of "playing", "paused", "stopped", "not running", or "unknown" when Music did not answer. */
async function playerState() {
    if (!isRunning()) return "not running"
    return (await musicTell("get player state as text")) || "unknown"
}

/** A promise of whether Music is playing. */
async function isPlaying() {
    return (await playerState()) === "playing"
}

// MARK: - Playback

function playPauseToggle() {
    if (!runningRequire()) return module.exports
    musicTell("playpause")
    return module.exports
}

function play() {
    if (!runningRequire()) return module.exports
    musicTell("play")
    return module.exports
}

/** Stop playback. Playing again restarts the album rather than resuming it. */
function playbackStop() {
    if (!runningRequire()) return module.exports
    musicTell("stop")
    return module.exports
}

function trackNext() {
    if (!runningRequire()) return module.exports
    musicTell("next track")
    return module.exports
}

function trackPrevious() {
    if (!runningRequire()) return module.exports
    musicTell("previous track")
    return module.exports
}

// MARK: - What is playing

/**
 * The current track.
 *
 * The duration is read along with the names because it is what tells one release of a track
 * from another when the album's page is looked up.
 *
 * @returns {Promise<?object>} `{name, artist, album, duration}`, or null when nothing is playing
 *          or Music did not answer. `duration` is in seconds, and is null when Music does not
 *          report one.
 */
async function currentTrack() {
    if (!isRunning()) return null
    // One call rather than four, so the four fields describe the same track even if it
    // changes while they are read. Tab-separated: none of the fields may contain a tab.
    const line = await musicTell(
        'try\n' +
        'return (get name of current track) & "\\t" & (get artist of current track) & "\\t" ' +
        '& (get album of current track) & "\\t" & (get duration of current track)\n' +
        'on error\n' +
        'return ""\n' +
        'end try'
    )
    if (!line) return null

    const parts = String(line).split("\t")
    if (parts.length < 3) return null
    const duration = Number(parts[3])
    return {
        name: parts[0],
        artist: parts[1],
        album: parts[2],
        duration: Number.isFinite(duration) ? duration : null
    }
}

/**
 * A track as one line of text.
 *
 * @param {object} track From `currentTrack`.
 * @param {?string} [url] The album's page. Given one, `config.trackURLFormat` is used.
 */
function trackDescribe(track, url) {
    const format = url ? config.trackURLFormat : config.trackFormat
    return format
        .replace("{name}", track.name)
        .replace("{artist}", track.artist)
        .replace("{album}", track.album)
        .replace("{url}", url || "")
}

/**
 * The current track as text, with the album's page appended once it is known.
 *
 * Asynchronous because the URL is not something Music holds: it has to be looked up. The
 * promise resolves to `config.trackFormat` alone rather than rejecting when the lookup
 * finds nothing, so a track outside the catalogue still describes itself.
 *
 * @returns {Promise<?string>} Null when nothing is playing.
 */
async function currentTrackText() {
    const track = await currentTrack()
    if (!track) return null
    return albumURLResolve(track).then((url) => trackDescribe(track, url))
}

/** A promise of the artist of the track playing, or null. */
async function currentArtist() {
    const track = await currentTrack()
    return track ? track.artist : null
}

/** A promise of the album of the track playing, or null. */
async function currentAlbum() {
    const track = await currentTrack()
    return track ? track.album : null
}

/**
 * Show the current track, and copy the same text to the pasteboard, as version 1 did.
 *
 * Both happen once the album's URL has been looked up, so there is one alert rather than
 * one for the names and another for the URL. A lookup that finds nothing, or fails, still
 * shows the names: the promise resolves to null rather than rejecting.
 */
function currentTrackShow() {
    if (!runningRequire()) return module.exports
    currentTrack().then((track) => {
        if (!track) {
            alert("Nothing is playing")
            return
        }
        currentTrackShowFor(track)
    })
    return module.exports
}

function currentTrackShowFor(track) {
    albumURLResolve(track).then((url) => {
        const text = trackDescribe(track, url)
        hs.pasteboard.writeString(text)
        alert(text)
    }).catch((e) => {
        console.error(`[hs_appleMusic-gt] showing ${track.artist} — ${track.name} failed: ${e}`)
        const text = trackDescribe(track)
        hs.pasteboard.writeString(text)
        alert(text)
    })
}

// MARK: - Volume

/** A promise of Music's own volume, 0 to 100, or null when it cannot be read. */
async function volumeGet() {
    if (!isRunning()) return null
    const value = await musicTell("get sound volume")
    return value === null || value === "" ? null : Number(value)
}

/** Show the volume as well as returning a promise of it, for a menu button that reports it. */
async function volumeShow() {
    const volume = await volumeGet()
    alert(volume === null ? "Music is not running" : `Volume ${volume}`)
    return volume
}

/**
 * Set the volume.
 *
 * @param {number} level 0 to 100. Values outside that are clamped.
 * @returns {Promise<?number>} The volume set, or null when Music is not running or did not answer.
 */
async function volumeSet(level) {
    if (!runningRequire()) return null
    const wanted = Math.max(0, Math.min(100, Math.round(Number(level))))
    if (!Number.isFinite(wanted)) {
        alert(`Illegal volume [${level}]`)
        return null
    }
    return (await musicTell(`set sound volume to ${wanted}`)) === null ? null : wanted
}

// MARK: - The system's volume
//
// Distinct from everything above, which is Music's own volume: Music has a level of its
// own and the output device has another, and turning one down does not touch the other.
// Both are here because both are reached from the same place when something is playing.
//
// hs.audiodevice gives the output device's volume as a fraction of one; these take and
// return a percentage, so that they read the same way as the Music functions beside them.

/**
 * The system's output volume, as a percentage.
 *
 * @returns {?number} 0 to 100, or null when there is no output device or it has no
 *          adjustable volume — some do not, HDMI among them.
 */
function systemVolume() {
    const device = hs.audiodevice.defaultOutputDevice()
    if (!device) return null

    const fraction = device.volume
    if (fraction === null || fraction === undefined) return null
    return Math.round(Number(fraction) * 100)
}

/**
 * Set the system's output volume.
 *
 * @param {number} percent 0 to 100. Values outside that are clamped.
 * @returns {?number} The volume set, or null when it could not be set.
 */
function systemVolumeSet(percent) {
    const device = hs.audiodevice.defaultOutputDevice()
    if (!device) {
        alert("No output device")
        return null
    }

    const wanted = Number(percent)
    if (!Number.isFinite(wanted)) {
        alert(`Illegal volume [${percent}]`)
        return null
    }

    const clamped = Math.max(0, Math.min(100, Math.round(wanted)))
    device.volume = clamped / 100

    // Read back rather than reporting what was asked for: a device that will not take a
    // volume accepts the assignment silently and keeps the one it had.
    const now = systemVolume()
    if (now === null) {
        alert(`${device.name} has no adjustable volume`)
        return null
    }
    alert(`System volume ${now}`)
    return now
}

/**
 * Change the volume by `delta`, which may be negative.
 *
 * @returns {Promise<?number>} The new volume, or null when Music is not running or did not answer.
 */
async function volumeAdjust(delta) {
    const current = await volumeGet()
    if (current === null) {
        alert("Music is not running")
        return null
    }
    const volume = await volumeSet(current + Number(delta))
    if (volume !== null) alert(`Volume ${volume}`)
    return volume
}

// MARK: - Skipping a whole album
//
// Music has no "next album", so tracks are skipped until the album name changes. After each skip,
// the album is read from the playerInfo notification that Music posts when the track changes.
// When none arrives within config.answerTimeout seconds, Music is asked instead. Hammerspoon 2
// keeps responding throughout.

const PLAYER_INFO = "com.apple.Music.playerInfo"

function playerInfoHandle(object, info) {
    if (playerInfoWaiter) playerInfoWaiter(info)
}

/**
 * The next playerInfo notification. Call it before the command that changes the track, so that
 * the notification cannot arrive before it is waited for.
 *
 * @returns {Promise<?object>} The notification's userInfo, or null after config.answerTimeout seconds.
 */
function playerInfoNext() {
    return new Promise((resolve) => {
        const timer = hs.timer.doAfter(config.answerTimeout, () => {
            playerInfoWaiter = null
            resolve(null)
        })
        playerInfoWaiter = (info) => {
            timer.stop()
            playerInfoWaiter = null
            resolve(info)
        }
    })
}

/** Skip a track, and return a promise of the album then playing, or null. */
async function trackSkip(direction, run) {
    const changed = playerInfoNext()
    musicTell(direction === "next" ? "next track" : "previous track")
    const info = await changed
    if (run !== albumSkipRun) return null
    if (info && info.Album !== undefined) return info.Album
    return currentAlbum()
}

/** Stop an album skip in progress. */
function albumSkipStop() {
    albumSkipRun += 1
    playerInfoWaiter = null
    hs.distributednotifications.off(PLAYER_INFO, playerInfoHandle)
}

function newAlbumSkipTo(direction) {
    if (!runningRequire()) return module.exports
    albumSkipStop()
    const run = albumSkipRun
    hs.distributednotifications.on(PLAYER_INFO, playerInfoHandle)
    albumSkip(direction, run).finally(() => {
        if (run === albumSkipRun) albumSkipStop()
    })
    return module.exports
}

async function albumSkip(direction, run) {
    const startAlbum = await currentAlbum()
    if (run !== albumSkipRun) return
    if (startAlbum === null) {
        alert("Nothing is playing")
        return
    }

    for (let attempts = 1; attempts <= config.maxAlbumSkipAttempts; attempts++) {
        const album = await trackSkip(direction, run)
        if (run !== albumSkipRun) return
        if (album !== null && album !== startAlbum) {
            // Going back lands on the last track of the previous album, so walk to its first
            // track: keep going back while the album stays the same, then forward once.
            if (direction === "previous") await firstTrackSeek(album, run)
            else alert(`Album: ${album}`)
            return
        }
    }
    alert(`No other album within ${config.maxAlbumSkipAttempts} tracks`)
}

async function firstTrackSeek(targetAlbum, run) {
    for (let attempts = 1; attempts <= config.maxAlbumSkipAttempts; attempts++) {
        const album = await trackSkip("previous", run)
        if (run !== albumSkipRun) return
        if (album !== targetAlbum) {
            // One track too far: come forward to the first track.
            await trackSkip("next", run)
            if (run !== albumSkipRun) return
            alert(`Album: ${targetAlbum}`)
            return
        }
    }
    alert(`Album: ${targetAlbum}, ${config.maxAlbumSkipAttempts} tracks back, not at its first track`)
}

function albumNext() {
    return newAlbumSkipTo("next")
}

function albumPrevious() {
    return newAlbumSkipTo("previous")
}

// MARK: - The album list

/** The album name a URL carries, from the slug Apple Music puts in its path. */
function urlLabel(url) {
    const match = /\/album\/([^/?#]+)/.exec(url)
    if (!match) return url
    return decodeURIComponent(match[1]).replace(/-/g, " ")
}

/**
 * The album list to read: `path` when given, otherwise `config.albumListPath`.
 *
 * When `config.albumListPath` does not exist, the example list included with the Spoon is
 * copied there, and an alert says so. If the copy fails, the example is read where it is.
 */
function albumListFile(path) {
    if (path) return path
    const file = config.albumListPath
    if (hs.fs.exists(file)) return file

    if (hs.fs.copy(EXAMPLE_ALBUM_LIST, file)) {
        const message = `No album list was found, so the example list was copied to ${file}`
        console.log(`[hs_appleMusic-gt] ${message}`)
        alert(message)
        return file
    }
    console.error(`[hs_appleMusic-gt] could not copy the example album list to ${file}`)
    alert(`Could not create ${file}; playing from the example list`)
    return EXAMPLE_ALBUM_LIST
}

/**
 * Read the album list.
 *
 * A line is either a URL to an album page or a `Band|Album` name. Everything from a # to
 * the end of the line is a comment, so a whole line can be one; on a URL line the comment
 * also names the album, a URL having no readable name of its own.
 *
 * @param {string} [path] Defaults to the list `albumListFile()` chooses.
 * @returns {object[]} Entries in file order, each `{kind: "url", url, label}` or
 *          `{kind: "name", band, album}`.
 */
function albumsRead(path) {
    const file = albumListFile(path)
    if (!hs.fs.exists(file)) {
        alert(`No album list at ${file}`)
        return []
    }

    const contents = hs.fs.read(file)
    if (contents === null || contents === undefined) {
        alert(`Could not read ${file}`)
        return []
    }

    const albums = []
    for (const raw of String(contents).split("\n")) {
        const hash = raw.indexOf("#")
        const comment = hash < 0 ? "" : raw.slice(hash + 1).trim()
        const line = (hash < 0 ? raw : raw.slice(0, hash)).trim()
        if (!line) continue

        if (/^(https?|music):\/\//i.test(line)) {
            albums.push({ kind: "url", url: line, label: comment || urlLabel(line) })
            continue
        }

        const separator = line.indexOf("|")
        if (separator < 0) continue

        const band = line.slice(0, separator).trim()
        const album = line.slice(separator + 1).trim()
        if (band && album) albums.push({ kind: "name", band, album })
    }
    return albums
}

/** How an entry is named in an alert or a chooser. */
function entryDescribe(entry) {
    if (!entry) return "?"
    return entry.kind === "url" ? entry.label : `${entry.band} — ${entry.album}`
}

/** One entry at random, or null when the list is empty. */
function albumRandomPick(path) {
    const albums = albumsRead(path)
    if (!albums.length) return null
    return albums[Math.floor(Math.random() * albums.length)]
}

/** Play a random album from the list. */
function albumRandomPlay(path) {
    const choice = albumRandomPick(path)
    if (!choice) {
        alert(`No albums in ${albumListFile(path)}`)
        return module.exports
    }
    alert(entryDescribe(choice))
    entryPlay(choice)
    return module.exports
}

/** Show the list, sorted by what it is named, and play what is chosen. */
function albumChoose(path) {
    const albums = albumsRead(path)
    if (!albums.length) {
        alert(`No albums in ${albumListFile(path)}`)
        return module.exports
    }

    // A URL entry sorts by its label and a named one by its band, so both sit where the
    // eye looks for them.
    const sortKey = (e) => (e.kind === "url" ? e.label : `${e.band} ${e.album}`).toLowerCase()
    const sorted = albums.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)))

    // The chooser is hs_interactive-gt's, so that every Spoon asks for input in the same way.
    const interactive = spoonRequired("hs_interactive-gt")
    interactive.readerRun(interactive.readers.choice.prompted, {
        placeholder: "Album",
        choices: sorted.map((entry) => ({
            text: entry.kind === "url" ? entry.label : entry.album,
            subText: entry.kind === "url" ? "link" : entry.band,
            value: entry
        }))
    }).then((entry) => {
        if (entry) entryPlay(entry)
    })
    return module.exports
}

/**
 * Append the album now playing to the list, unless it is already there.
 *
 * Written as a URL where the album can be identified in the catalogue, because a URL names
 * one album and a `Band|Album` line names whichever release a search happens to return. The
 * name is kept as the line's comment, so the list stays readable.
 */
function currentAlbumAdd(path) {
    if (!runningRequire()) return module.exports
    currentTrack().then((track) => {
        if (!track || !track.album || !track.artist) {
            alert("Nothing is playing")
            return
        }
        currentAlbumAddFor(track, path)
    })
    return module.exports
}

function currentAlbumAddFor(track, path) {
    // The example list is copied first when the user has none, so the album is added to it.
    const file = albumListFile(path)
    const name = `${track.artist} — ${track.album}`

    albumURLResolve(track).then((url) => {
        const albumID = url ? albumIDFromURL(url) : null
        // A list that does not exist yet has nothing in it, and is created by the append.
        const already = hs.fs.exists(file) && albumsRead(file).some((entry) => entry.kind === "url"
            ? albumID !== null && albumIDFromURL(entry.url) === albumID
            : same(entry.band, track.artist) && same(entry.album, track.album))

        if (already) {
            alert(`Already listed: ${name}`)
            return
        }

        hs.fs.append(file, url ? `${url} # ${name}\n` : `${track.artist}|${track.album}\n`)
        alert(`Added: ${name}`)
    }).catch((e) => {
        console.error(`[hs_appleMusic-gt] adding ${name} failed: ${e}`)
        alert(`Could not add ${name}`)
    })

    return module.exports
}

// MARK: - Finding an album in the Apple Music catalogue

/** Text compared the way the catalogue's spelling of it should be forgiven: not at all. */
function same(a, b) {
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/**
 * The storefront to search: `config.storefront`, or the country of the system's locale, such as
 * "ca" for en_CA. "us" when the locale names no country.
 */
function storefront() {
    if (config.storefront) return String(config.storefront).toLowerCase()
    const parts = String(hs.locale.current() || "").split(/[_-]/)
    const region = parts.reverse().find((part) => /^[A-Za-z]{2}$/.test(part) && part === part.toUpperCase())
    return region ? region.toLowerCase() : "us"
}

/** Ask the iTunes API for `path`, and return its results, or [] if the request failed. */
function iTunesResults(path, description) {
    return hs.http.get(`https://itunes.apple.com/${path}`).then((response) => {
        if (!response || response.status !== 200) {
            console.error(`[hs_appleMusic-gt] ${description}: HTTP ${response ? response.status : "no response"}`)
            return []
        }
        try {
            return JSON.parse(response.body).results || []
        } catch (e) {
            console.error(`[hs_appleMusic-gt] ${description}: unreadable response`)
            return []
        }
    }).catch((e) => {
        console.error(`[hs_appleMusic-gt] ${description} failed: ${e}`)
        return []
    })
}

/** The catalogue identifier an album URL ends in, or null. */
function albumIDFromURL(url) {
    const match = /\/album\/[^/?#]+\/(\d+)/.exec(String(url))
    return match ? match[1] : null
}

/**
 * The Apple Music page of the album a track belongs to.
 *
 * Music itself cannot answer this. Its scripting interface describes a track by its names,
 * its length and its position, and holds no catalogue address for it; `URL track`'s address
 * belongs to radio streams. So the track is searched for and identified by what Music does
 * report.
 *
 * The track is searched for rather than the album, because a search for an album name
 * returns that album beside its deluxe, anniversary and remastered editions with no way to
 * tell which one is playing. A track carries a length, and a length separates a remaster
 * from the release it remasters. Where the length still does not decide it, the album name
 * does, and where neither does, nothing is returned: a wrong album URL would be written to
 * the list and played from then on, which is worse than no URL at all.
 *
 * The album is then looked up by identifier, for its own page rather than the track's page
 * within it. Both addresses reach the same album, but only the album's carries the album's
 * name, and `urlLabel` reads the name out of the address.
 *
 * @param {object} track From `currentTrack`.
 * @returns {Promise<?string>} The album's URL, or null when it could not be identified.
 */
function albumURLResolve(track) {
    if (!track || !track.name || !track.artist) return Promise.resolve(null)

    const term = hs.http.encodeForQuery(`${track.artist} ${track.name}`)
    const search = `search?term=${term}&entity=song&limit=${config.searchLimit}` +
        `&country=${storefront()}`

    return iTunesResults(search, `searching for ${track.artist} — ${track.name}`).then((results) => {
        const named = results.filter((r) => same(r.trackName, track.name) && same(r.artistName, track.artist))
        if (!named.length) return null

        const sameLength = (r) => track.duration !== null &&
            Number.isFinite(r.trackTimeMillis) &&
            Math.abs(r.trackTimeMillis / 1000 - track.duration) <= config.durationTolerance
        const sameAlbum = (r) => same(r.collectionName, track.album)

        // Both agreeing identifies the release. Either alone is taken only when it is the
        // one candidate it points at, so that a guess is never made between two.
        const byBoth = named.filter((r) => sameLength(r) && sameAlbum(r))
        const byLength = named.filter(sameLength)
        const byAlbum = named.filter(sameAlbum)

        let chosen = null
        if (byBoth.length) chosen = byBoth[0]
        else if (byLength.length === 1) chosen = byLength[0]
        else if (byAlbum.length === 1) chosen = byAlbum[0]

        if (!chosen || !chosen.collectionId) return null

        const lookup = `lookup?id=${chosen.collectionId}&entity=album&country=${storefront()}`
        return iTunesResults(lookup, `looking up album ${chosen.collectionId}`).then((albums) => {
            const album = albums.find((a) => a.wrapperType === "collection" && a.collectionViewUrl)
            // The trailing ?uo=4 is Apple's affiliate marker, and is of no use in the list.
            return album ? String(album.collectionViewUrl).split("?")[0] : null
        })
    })
}

/**
 * The Apple Music page of the album now playing.
 *
 * @returns {Promise<?string>} Null when nothing is playing, or when the album could not be
 *          identified.
 */
async function currentAlbumURL() {
    const track = await currentTrack()
    return track ? albumURLResolve(track) : null
}

/**
 * Ask the iTunes Search API which album this is.
 *
 * An exact match on both artist and album name is preferred, because a search for an album
 * also returns its deluxe and anniversary editions. Where there is no single exact match
 * the first result is used and the ambiguity is reported, so a wrong album is visible
 * rather than silent.
 *
 * @param {string} band
 * @param {string} album
 * @returns {Promise<?object>} `{name, artist, url}`, or null when nothing was found.
 */
function albumResolve(band, album) {
    const term = hs.http.encodeForQuery(`${band} ${album}`)
    const url = `https://itunes.apple.com/search?term=${term}&entity=album` +
        `&limit=${config.searchLimit}&country=${storefront()}`

    return hs.http.get(url).then((response) => {
        if (!response || response.status !== 200) {
            alert(`Search failed for ${band} — ${album}`)
            return null
        }

        let results
        try {
            results = JSON.parse(response.body).results || []
        } catch (e) {
            alert(`Search returned nothing usable for ${band} — ${album}`)
            return null
        }

        if (!results.length) {
            alert(`Not found: ${band} — ${album}`)
            return null
        }

        const exact = results.filter((r) => same(r.collectionName, album) && same(r.artistName, band))

        let chosen
        if (exact.length === 1) {
            chosen = exact[0]
        } else {
            chosen = exact.length ? exact[0] : results[0]
            const what = exact.length
                ? `${exact.length} albums match exactly`
                : "no exact match"
            alert(`${band} — ${album}: ${what}, playing ${chosen.artistName} — ${chosen.collectionName}`)
        }

        return {
            name: chosen.collectionName,
            artist: chosen.artistName,
            // The same page, opened in Music rather than in a browser.
            url: String(chosen.collectionViewUrl).replace(/^https:/, "music:")
        }
    }).catch((e) => {
        alert(`Search failed for ${band} — ${album}`)
        console.error(`[hs_appleMusic-gt] search failed: ${e}`)
        return null
    })
}

// MARK: - Playing an album

function playButtonWaitStop() {
    if (playButtonTimer) {
        playButtonTimer.stop()
        playButtonTimer = null
    }
}

/** Music's Play button, once its album page has rendered, or null. */
function playButtonFind() {
    const app = hs.application.matchingBundleID(MUSIC_BUNDLE_ID)
    if (!app) return null

    const element = hs.ax.applicationElement(app)
    if (!element) return null

    // findByRole walks the tree itself. The album page carries exactly one button with
    // this title; the buttons on each track row are untitled.
    const buttons = hs.ax.findByRole("AXButton", element)
        .filter((button) => button.title === config.playButtonTitle)
    return buttons.length ? buttons[0] : null
}

/** Wait for the Play button to appear, then press it. */
function playButtonPressWhenReady(description) {
    playButtonWaitStop()
    const deadline = Math.ceil(config.playButtonTimeout / config.playButtonPollInterval)
    let attempts = 0

    const poll = () => {
        attempts += 1
        const button = playButtonFind()

        if (button) {
            playButtonTimer = null
            try {
                button.performAction("AXPress")
            } catch (e) {
                alert(`Music refused to press Play for ${description}: ${e.message}`)
            }
            return
        }
        if (attempts >= deadline) {
            playButtonTimer = null
            alert(`Music did not offer a Play button for ${description}`)
            return
        }
        playButtonTimer = hs.timer.doAfter(config.playButtonPollInterval, poll)
    }

    playButtonTimer = hs.timer.doAfter(config.playButtonPollInterval, poll)
}

/**
 * Open an album page in Music.
 *
 * The address is given the music: scheme and handed to Music itself. AppleScript's
 * `open location` is not used: it waits until the address has been handed over, and this
 * runs in the callback of the search request, on the main thread, where waiting stops every
 * timer and hotkey until it returns.
 */
function albumURLOpen(url) {
    const musicURL = String(url).replace(/^https?:/i, "music:")
    if (!hs.urlevent.openURLWithBundle(musicURL, MUSIC_BUNDLE_ID)) {
        console.error(`[hs_appleMusic-gt] could not open ${musicURL}`)
        alert("Could not open the album in Music")
    }
}

/**
 * Play an album from the list, by URL or by name.
 *
 * @param {object} entry From `albumsRead`.
 * @returns {object} The Spoon. A named album is looked up first, so playing begins later.
 */
function entryPlay(entry) {
    if (!entry) return module.exports

    // A URL needs no lookup: it already names one album exactly.
    if (entry.kind === "url") {
        albumURLOpen(entry.url)
        playButtonPressWhenReady(entry.label)
        return module.exports
    }
    return albumPlay(entry.band, entry.album)
}

/**
 * Play an album by name, whether or not it is in the library.
 *
 * @param {string} band
 * @param {string} album
 * @returns {object} The Spoon. The playing happens later: the album is looked up, its page
 *          is opened, and the Play button is pressed once it has rendered.
 */
function albumPlay(band, album) {
    if (!band || !album) {
        alert("albumPlay needs a band and an album")
        return module.exports
    }

    albumResolve(band, album).then((found) => {
        if (!found) return
        albumURLOpen(found.url)
        playButtonPressWhenReady(`${found.artist} — ${found.name}`)
    }).catch((e) => {
        // A throw inside a then() is otherwise swallowed by the promise, which is what
        // made the first failure here look like nothing happening at all.
        console.error(`[hs_appleMusic-gt] playing ${band} — ${album} failed: ${e}`)
        alert(`Could not play ${band} — ${album}`)
    })

    return module.exports
}

// MARK: - Auto-play
//
// Starts a random album whenever Music has stopped. A paused Music is left alone: pausing
// is a decision, stopping is the end of an album.

/**
 * Music's playerInfo notification: auto-play acts when Music reports that it stopped. It checks a
 * second later that Music is still running and still stopped: Music posts Stopped, without a track,
 * each time it starts playing an album, followed by Playing within the same second (measured on
 * 2026-11-27), and a Music that is quitting must not be launched again.
 */
function autoPlayHandle(object, info) {
    if (info["Player State"] !== "Stopped" || Date.now() < autoPlayQuietUntil) return
    hs.timer.doAfter(1, () => {
        if (!autoPlayEnabled || !isRunning()) return
        playerState().then((state) => {
            if (autoPlayEnabled && state === "stopped" && Date.now() >= autoPlayQuietUntil) autoPlayAlbumStart()
        })
    })
}

function autoPlayAlbumStart() {
    const choice = albumRandomPick()
    if (!choice) {
        alert(`Auto-play off: no albums in ${albumListFile()}`)
        autoPlayStop()
        return
    }

    autoPlayQuietUntil = Date.now() + (config.playButtonTimeout + config.answerTimeout) * 1000
    alert(`Auto-play: ${entryDescribe(choice)}`)
    entryPlay(choice)
}

/**
 * Turn auto-play on: listen for Music's playerInfo notification, which Music posts at each change
 * of its state, and ask Music its state once, in case it has already stopped. A Music that is not
 * running posts nothing, so auto-play does not launch it.
 */
function autoPlayStart() {
    if (autoPlayEnabled) return false
    autoPlayEnabled = true
    hs.distributednotifications.on(PLAYER_INFO, autoPlayHandle)
    playerState().then((state) => {
        if (autoPlayEnabled && state === "stopped") autoPlayAlbumStart()
    })
    return true
}

function autoPlayStop() {
    if (!autoPlayEnabled) return false
    autoPlayEnabled = false
    hs.distributednotifications.off(PLAYER_INFO, autoPlayHandle)
    return true
}

function autoPlayIsEnabled() {
    return autoPlayEnabled
}

/** Turn auto-play on or off, and say which it now is. */
function autoPlayToggle() {
    const enabled = autoPlayIsEnabled() ? !autoPlayStop() : autoPlayStart()
    alert(`Auto-play ${enabled ? "on" : "off"}`)
    return enabled
}

// MARK: - The music menu
//
// The menu hs_menu-gt displays for this Spoon. Every button calls a function here directly,
// with `fn:`. The letters are the ones the Hammerspoon 1 menu used: b and n go back and forward
// a track, B and N an album; u and d change the volume by 20, U and D by 5.

// For the message given when hs_menu-gt is not loaded.
const SPOON_NAME = "hs_appleMusic-gt"
const DOCUMENTATION = "https://github.com/dmgerman/hammer2spoons/tree/main/Spoons"

/**
 * The Spoon `name`, which this Spoon cannot work without. Throws, naming the Spoon and
 * referring to its documentation, when it is not loaded.
 */
function spoonRequired(name) {
    const spoon = hs.spoons[name]
    if (spoon) return spoon
    throw new Error(`${SPOON_NAME} needs ${name}, which is not loaded. ` +
        `See ${DOCUMENTATION}/${name}.spoon2`)
}

/**
 * The music menu, for hs_menu-gt: `menuShow()` displays it, and a menu of your own can include
 * it as a submenu with `children: hs.spoons["hs_appleMusic-gt"].menu`.
 *
 * Most buttons are pressed several times in a row, such as the track and volume buttons, so the
 * menu stays open after a press. Play/Pause, Now playing, Random album and Auto-play close it,
 * and so does Choose album, whose chooser needs the keyboard.
 */
const menu = [
    { label: "Play/Pause", icon: "symbol:playpause.fill", key: "p", fn: () => playPauseToggle(), keepOpen: false },
    { label: "Prev track", icon: "symbol:backward.fill", key: "b", fn: () => trackPrevious() },
    { label: "Next track", icon: "symbol:forward.fill", key: "n", fn: () => trackNext() },
    { label: "Prev album", icon: "symbol:backward.end.fill", key: "B", fn: () => albumPrevious() },
    { label: "Next album", icon: "symbol:forward.end.fill", key: "N", fn: () => albumNext() },
    { label: "Now playing", icon: "symbol:info.circle", key: "i", fn: () => currentTrackShow(), keepOpen: false },

    { label: "Volume", icon: "symbol:speaker.wave.2", key: "v", fn: () => volumeShow() },
    { label: "Vol +20", icon: "symbol:speaker.plus.fill", key: "u", fn: () => volumeAdjust(20) },
    { label: "Vol −20", icon: "symbol:speaker.minus.fill", key: "d", fn: () => volumeAdjust(-20) },
    { label: "Vol +5", icon: "symbol:speaker.plus", key: "U", fn: () => volumeAdjust(5) },
    { label: "Vol −5", icon: "symbol:speaker.minus", key: "D", fn: () => volumeAdjust(-5) },

    { label: "Random album", icon: "symbol:shuffle", key: "r", fn: () => albumRandomPlay(), keepOpen: false },
    { label: "Add current", icon: "symbol:plus.circle", key: "a", fn: () => currentAlbumAdd() },
    { label: "Auto-play", icon: "symbol:infinity", key: "t", fn: () => autoPlayToggle(), keepOpen: false },
    { label: "Choose album", icon: "symbol:list.bullet", key: "c", fn: () => albumChoose(), keepOpen: false },
    { label: "Music app", key: "m", app: MUSIC_BUNDLE_ID }
].map((button) => Object.assign({ navigate: "stay", keepOpen: true }, button))

/** Display the music menu on screen, with hs_menu-gt. */
function menuShow() {
    spoonRequired("hs_menu-gt").onScreenShow(menu, { name: "Music" })
    return module.exports
}

// MARK: - Hotkeys
//
// hs.spoons.use() binds keys through its `hotkeys` option, which calls bindHotkeys(). The name
// is the one hs.spoons.use() calls, so it keeps that spelling rather than this project's
// subject-first order. Only the menu is bound: everything else is in it.

let hotkeys = []

function hotkeysRelease() {
    for (const hotkey of hotkeys) hotkey.destroy()
    hotkeys = []
}

/**
 * Bind keys. Called by hs.spoons.use() with its `hotkeys` option; a second call replaces the
 * bindings of the first.
 *
 * @param {object} mapping `{ menuShow: [modifiers, key] }`, such as
 *        `{ menuShow: [["cmd", "ctrl", "alt"], "m"] }`.
 * @returns {object} The Spoon.
 * @throws For any name but menuShow, or a malformed binding. Nothing is bound in that case.
 */
function bindHotkeys(mapping) {
    const entries = Object.entries(mapping || {})
    for (const [name, binding] of entries) {
        if (name !== "menuShow") {
            throw new Error(`hs_appleMusic-gt: bindHotkeys(): only menuShow can be bound, not ${name}`)
        }
        if (!Array.isArray(binding) || !Array.isArray(binding[0]) || typeof binding[1] !== "string") {
            throw new Error(`hs_appleMusic-gt: bindHotkeys(): menuShow needs [modifiers, key], such as [["cmd", "ctrl", "alt"], "m"]`)
        }
    }
    hotkeysRelease()
    for (const [, [mods, key]] of entries) {
        const hotkey = hs.hotkey.bind(mods, key, () => menuShow(), null)
        if (hotkey) hotkeys.push(hotkey)
        else console.error(`[hs_appleMusic-gt] could not bind ${mods.join("-")} ${key} to menuShow`)
    }
    return module.exports
}

// MARK: - Lifecycle

/**
 * Bring Music forward, launching it if it is not running.
 *
 * setFrontmost() while it is running, so that only Music's main window is raised and its
 * other windows, the MiniPlayer among them, keep their place.
 */
function focus() {
    const app = hs.application.matchingBundleID(MUSIC_BUNDLE_ID)
    if (app) app.setFrontmost(false)
    else hs.application.launchOrFocus(MUSIC_BUNDLE_ID)
    return module.exports
}

function start() {
    // Both are required. Checked here, so that a missing one is reported when the Spoon starts
    // rather than the first time the menu or the album chooser is opened.
    spoonRequired("hs_interactive-gt")
    spoonRequired("hs_menu-gt")
    return module.exports
}

/** Stop auto-play and abandon any skip or Play button still being waited for. */
function stop() {
    hotkeysRelease()
    autoPlayStop()
    albumSkipStop()
    playButtonWaitStop()
    return module.exports
}

module.exports = {
    config,
    // Playback.
    isRunning,
    playerState,
    isPlaying,
    playPauseToggle,
    play,
    playbackStop,
    trackNext,
    trackPrevious,
    albumNext,
    albumPrevious,
    // What is playing.
    currentTrack,
    currentTrackText,
    currentArtist,
    currentAlbum,
    currentTrackShow,
    currentAlbumURL,
    albumURLResolve,
    // Volume.
    volumeGet,
    volumeShow,
    volumeSet,
    volumeAdjust,
    systemVolume,
    systemVolumeSet,
    // Albums.
    albumsRead,
    albumRandomPick,
    albumResolve,
    albumPlay,
    entryPlay,
    albumRandomPlay,
    albumChoose,
    currentAlbumAdd,
    // Auto-play.
    autoPlayStart,
    autoPlayStop,
    autoPlayToggle,
    autoPlayIsEnabled,
    // The music menu.
    menu,
    menuShow,
    bindHotkeys,
    // Lifecycle.
    focus,
    start,
    stop
}

// hs.spoons.use()'s config option copies each of its properties onto this Spoon's object, as the
// Hammerspoon 2 Spoons guide describes. The settings live in config, so each one is also a
// property of the object that reads and writes config: both hs.spoons.use(name, { config: {...} })
// and spoon.config.name = value then set it. No setting has the name of an exported function.
for (const name of Object.keys(config)) {
    Object.defineProperty(module.exports, name, {
        get: () => config[name],
        set: (value) => { config[name] = value },
        enumerable: true,
        configurable: true
    })
}

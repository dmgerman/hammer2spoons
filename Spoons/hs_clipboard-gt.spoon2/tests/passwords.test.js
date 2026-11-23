// Tests of passwords, as the readme describes them under "Passwords" and "A different password
// test": which texts are masked, masking in the chooser, keeping them off disk, revealing them,
// and config.passwordTest. Every password here is made up for the test.

const { copy, fresh, entries, text, chooserCapture, historyOpen, key } = require("./clipboard.js")

// A made-up text that every step of the default test accepts.
const PASSWORD = "Zq7#vK2$mP9!xR4w"
const OTHER_PASSWORD = "Hb4%Lw8&Tn3*Yd6q"

function settingsSet(t, values) {
    const config = t.spoon.config
    const original = {}
    for (const name of Object.keys(values)) {
        original[name] = config[name]
        config[name] = values[name]
    }
    t.cleanup(() => Object.assign(config, original))
}

const fileContents = (t) => JSON.parse(hs.fs.read(t.spoon.config.historyFile, 0, 0)).items.map((e) => e.content)

function consoleErrors(t) {
    const original = console.error
    const errors = []
    console.error = (...args) => { errors.push(args.join(" ")); original.apply(console, args) }
    t.cleanup(() => { console.error = original })
    return errors
}

module.exports = [
    // --- which texts are masked ---
    {
        name: "passwordLike() accepts a random text shaped like a password",
        run: (t) => {
            t.assert.equal(t.spoon.passwordLike(PASSWORD), true, PASSWORD)
            t.assert.equal(t.spoon.passwordLike(OTHER_PASSWORD), true, OTHER_PASSWORD)
        }
    },
    {
        name: "passwordLike() refuses the forms that are never passwords",
        run: (t) => {
            const never = {
                address: "https://example.com/Zq7#vK2",
                path: "/usr/local/Zq7vK2mP9",
                "file name": "Zq7vK2mP9xR4.txt",
                date: "2026-11-23T10:15:00",
                number: "1234567890",
                "MD5 hash": "9e107d9d372bb6826bd81d3542a419d6",
                UUID: "123e4567-e89b-12d3-a456-426614174000",
                "IPv4 address": "192.168.100.200"
            }
            const masked = Object.keys(never).filter((name) => t.spoon.passwordLike(never[name]))
            t.assert.equal(masked.join(", "), "", "forms masked")
        }
    },
    {
        name: "passwordLike() refuses a text shorter than 8, with a space, of one kind of character, or not random",
        run: (t) => {
            const refused = {
                "7 characters": "Zq7#vK2",
                "a space": "Zq7#vK2 mP9!xR4w",
                "lower case only": "qwertzuiopasdfgh",
                "not random": "zzzzzzzzzzzzzzZ1"
            }
            const masked = Object.keys(refused).filter((name) => t.spoon.passwordLike(refused[name]))
            t.assert.equal(masked.join(", "), "", "texts masked")
        }
    },
    {
        name: "passwordMinLength and passwordEntropyThreshold adjust the default test",
        run: (t) => {
            settingsSet(t, { passwordMinLength: 20 })
            t.assert.equal(t.spoon.passwordLike(PASSWORD), false, "a 16-character password with passwordMinLength 20")
            settingsSet(t, { passwordMinLength: 8, passwordEntropyThreshold: 5 })
            t.assert.equal(t.spoon.passwordLike(PASSWORD), false, "with passwordEntropyThreshold 5")
        }
    },
    {
        name: "line breaks at the ends are left out, up to passwordMaxNewlines, and a line break inside prevents masking",
        run: (t) => {
            t.assert.equal(t.spoon.passwordLike(`${PASSWORD}\n`), true, "with one line break after it")
            t.assert.equal(t.spoon.passwordLike(`\n${PASSWORD}`), true, "with one line break before it")
            t.assert.equal(t.spoon.passwordLike(`${PASSWORD}\n\n`), false, "with two line breaks after it")
            t.assert.equal(t.spoon.passwordLike(`Zq7#vK2$\nmP9!xR4w`), false, "with a line break inside it")
            settingsSet(t, { passwordMaxNewlines: 2 })
            t.assert.equal(t.spoon.passwordLike(`${PASSWORD}\n\n`), true, "with two line breaks after it and passwordMaxNewlines 2")
        }
    },
    // --- in the history ---
    {
        name: "a copied password is kept in the history, masked in the chooser, and not written to disk",
        run: async (t) => {
            const chooser = chooserCapture(t)
            const alerts = t.alertsCapture()
            fresh(t)
            await copy(t, text(t, "plain"))
            await copy(t, PASSWORD)
            t.assert.equal(entries(t)[0], PASSWORD, "the newest entry")
            t.assert.equal(fileContents(t).join(" | "), text(t, "plain"), "the entries in the file")
            t.assert.ok(alerts.some((m) => m.includes("(password-like, not persisted)")), `alerts: ${alerts.join(" | ")}`)
            await historyOpen(t, chooser)
            t.assert.equal(chooser.rows[0].text, `[hidden - ${PASSWORD.length} chars]`, "the row")
            t.assert.equal(chooser.rows[0].data, PASSWORD, "the text the row pastes")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "⌘R reveals the selected masked entry and masks it again, ⇧⌘R reveals every one, and closing masks them",
        run: async (t) => {
            const chooser = chooserCapture(t)
            fresh(t)
            await copy(t, PASSWORD)
            await copy(t, OTHER_PASSWORD)
            const shown = () => chooser.rows.slice(0, 2).map((r) => r.text.startsWith("[hidden") ? "hidden" : "shown").join(",")
            await historyOpen(t, chooser)
            t.assert.equal(shown(), "hidden,hidden", "when the chooser opens")
            await key(t, chooser, ["cmd"], "r")
            t.assert.equal(shown(), "shown,hidden", "after ⌘R")
            await key(t, chooser, ["cmd"], "r")
            t.assert.equal(shown(), "hidden,hidden", "after ⌘R again")
            await key(t, chooser, ["cmd", "shift"], "r")
            t.assert.equal(shown(), "shown,shown", "after ⇧⌘R")
            await key(t, chooser, [], "escape")
            await historyOpen(t, chooser)
            t.assert.equal(shown(), "hidden,hidden", "when the chooser opens again")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "with passwordsHide false, a password is shown and written to disk",
        run: async (t) => {
            const chooser = chooserCapture(t)
            settingsSet(t, { passwordsHide: false })
            fresh(t)
            await copy(t, PASSWORD)
            t.assert.equal(fileContents(t).join(" | "), PASSWORD, "the entries in the file")
            await historyOpen(t, chooser)
            t.assert.equal(chooser.rows[0].text, PASSWORD, "the row")
            await key(t, chooser, [], "escape")
        }
    },
    // --- passwordTest ---
    {
        name: "passwordTest replaces the default test, for the chooser, the file and the alert",
        run: async (t) => {
            const chooser = chooserCapture(t)
            const alerts = t.alertsCapture()
            settingsSet(t, { passwordTest: (value) => value.startsWith("sk-") })
            fresh(t)
            const key_ = `sk-${t.runId}`
            await copy(t, PASSWORD)
            await copy(t, key_)
            t.assert.equal(t.spoon.passwordLike(PASSWORD), false, "the default test's password")
            t.assert.equal(fileContents(t).join(" | "), PASSWORD, "the entries in the file")
            t.assert.ok(alerts.some((m) => m.startsWith(`Copied ${key_.length} chars (password-like`)), `alerts: ${alerts.join(" | ")}`)
            await historyOpen(t, chooser)
            t.assert.equal(chooser.rows[0].text, `[hidden - ${key_.length} chars]`, "the sk- row")
            t.assert.equal(chooser.rows[1].text, PASSWORD, "the default test's password's row")
            await key(t, chooser, [], "escape")
        }
    },
    {
        name: "passwordTest can extend the default test, which it receives",
        run: (t) => {
            settingsSet(t, { passwordTest: (value, defaultTest) => defaultTest(value) || value.startsWith("sk-") })
            t.assert.equal(t.spoon.passwordLike(PASSWORD), true, "the default test's password")
            t.assert.equal(t.spoon.passwordLike("sk-abc"), true, "an sk- key")
            t.assert.equal(t.spoon.passwordLike("plain words"), false, "plain words")
        }
    },
    {
        name: "a passwordTest that throws is reported in the console, and the text is treated as a password",
        run: (t) => {
            const errors = consoleErrors(t)
            settingsSet(t, { passwordTest: () => { throw new Error("test failure") } })
            t.assert.equal(t.spoon.passwordLike("plain words"), true, "the result")
            t.assert.ok(errors.some((e) => e.includes("test failure")), `errors: ${errors.join(" | ") || "none"}`)
        }
    }
]

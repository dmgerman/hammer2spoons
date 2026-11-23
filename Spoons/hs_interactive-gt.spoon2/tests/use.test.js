// Tests of use(), use.file(), use.status() and use.report(), as the readme describes them under
// "Loading Spoons".
//
// use() loads a Spoon with hs.spoons.load(), which loads only from the configuration's Spoons
// directory. The tests must not load any Spoon of the user's, nor add one to that directory, so
// hs.spoons.load is replaced for the length of a test: a name starting with test-spoon- gives a
// test Spoon made in memory, or throws when the test asks for a failing one. Which directory
// hs.spoons.load() searches is Hammerspoon 2's behaviour, and is not tested here.

const MODIFIERS = ["ctrl", "alt", "shift"]

function consoleCapture(t) {
    const original = { error: console.error, log: console.log }
    const written = { error: [], log: [] }
    console.error = (...args) => { written.error.push(args.join(" ")); original.error.apply(console, args) }
    console.log = (...args) => { written.log.push(args.join(" ")); original.log.apply(console, args) }
    t.cleanup(() => { console.error = original.error; console.log = original.log })
    return written
}

// Replaces hs.spoons.load until the test ends. Returns the list of names loaded and a function
// that makes a test Spoon, which records the steps of use() in `events`.
let spoons = 0
function loaderFake(t) {
    const original = hs.spoons.load
    const loaded = []
    const made = new Map()
    hs.spoons.load = function (name) {
        if (!String(name).startsWith("test-spoon-")) return original.apply(hs.spoons, arguments)
        loaded.push(name)
        const spoon = made.get(name)
        if (!spoon) throw new Error(`no test Spoon named ${name}`)
        if (spoon.throws) throw new Error(spoon.throws)
        spoon.events.push("load")
        return spoon
    }
    t.cleanup(() => { hs.spoons.load = original })
    function spoonMake(options = {}) {
        const name = `test-spoon-${++spoons}`
        const events = []
        const spoon = { name, events, config: { a: 1, b: 2 }, throws: options.throws || null }
        if (options.start !== false) spoon.start = () => events.push("start")
        made.set(name, spoon)
        return spoon
    }
    return { loaded, spoonMake }
}

function statusOf(t, name) {
    return t.spoon.use.status().filter((r) => r.name === name).pop()
}

module.exports = [
    {
        name: "use() loads a Spoon with hs.spoons.load(), starts it, returns it, and records it as loaded",
        run: (t) => {
            const { loaded, spoonMake } = loaderFake(t)
            const spoon = spoonMake()
            t.assert.equal(t.spoon.use(spoon.name), spoon, "the returned Spoon")
            t.assert.equal(loaded.join(","), spoon.name, "the names loaded")
            t.assert.ok(spoon.events.includes("start"), "start() was not called")
            const record = statusOf(t, spoon.name)
            t.assert.equal(record.state, "loaded", "the state")
            t.assert.equal(record.error, null, "the error")
            t.assert.ok(typeof record.ms === "number", "ms is not a number")
        }
    },
    {
        name: "use() runs before, loads, merges config, then calls after, commands, keys and start, in that order",
        run: (t) => {
            const { spoonMake } = loaderFake(t)
            const spoon = spoonMake()
            let interactiveGiven = null
            t.spoon.use(spoon.name, {
                before: () => spoon.events.push("before"),
                config: { b: 20, c: 30 },
                after: (s) => spoon.events.push(`after config.b=${s.config.b}`),
                commands: (interactive, s) => {
                    interactiveGiven = interactive
                    spoon.events.push(`commands ${s === spoon}`)
                    interactive.define({ name: `${spoon.name}-command`, fn: () => "ran" })
                },
                keys: [[MODIFIERS, "9", `${spoon.name}-command`]]
            })
            t.cleanup(() => t.spoon.keyUnset(MODIFIERS, "9"))
            t.assert.equal(spoon.events.join(" | "), "before | load | after config.b=20 | commands true | start", "the steps")
            t.assert.equal(JSON.stringify(spoon.config), '{"a":1,"b":20,"c":30}', "the merged config")
            t.assert.equal(interactiveGiven, t.spoon, "commands received this Spoon")
            t.assert.equal(t.spoon.keyDescribe(MODIFIERS, "9").command, `${spoon.name}-command`, "the key bound")
        }
    },
    {
        name: "use() with disabled does not load the Spoon, returns null and records it as disabled",
        run: (t) => {
            const { loaded, spoonMake } = loaderFake(t)
            const spoon = spoonMake()
            t.assert.equal(t.spoon.use(spoon.name, { disabled: true }), null, "the result")
            t.assert.equal(loaded.length, 0, "the Spoon was loaded")
            t.assert.equal(statusOf(t, spoon.name).state, "disabled", "the state")
        }
    },
    {
        name: "use() with when loads the Spoon only when it returns true, and records skipped otherwise",
        run: (t) => {
            const { loaded, spoonMake } = loaderFake(t)
            const no = spoonMake(), yes = spoonMake()
            t.assert.equal(t.spoon.use(no.name, { when: () => false }), null, "when false")
            t.assert.equal(statusOf(t, no.name).state, "skipped", "the state when false")
            t.assert.equal(t.spoon.use(yes.name, { when: () => true }), yes, "when true")
            t.assert.equal(loaded.join(","), yes.name, "the names loaded")
        }
    },
    {
        name: "use() with start false does not call the Spoon's start()",
        run: (t) => {
            const { spoonMake } = loaderFake(t)
            const spoon = spoonMake()
            t.spoon.use(spoon.name, { start: false })
            t.assert.ok(!spoon.events.includes("start"), "start() was called")
        }
    },
    {
        name: "use() loads a Spoon that has no start()",
        run: (t) => {
            const { spoonMake } = loaderFake(t)
            const spoon = spoonMake({ start: false })
            t.assert.equal(t.spoon.use(spoon.name), spoon)
            t.assert.equal(statusOf(t, spoon.name).state, "loaded")
        }
    },
    {
        name: "a Spoon that fails to load is reported in the console and recorded, and the calls after it still run",
        run: (t) => {
            const written = consoleCapture(t)
            const { spoonMake } = loaderFake(t)
            const failing = spoonMake({ throws: "broken on purpose" })
            const next = spoonMake()
            t.assert.equal(t.spoon.use(failing.name), null, "the failing call's result")
            t.assert.equal(t.spoon.use(next.name), next, "the next call's result")
            const record = statusOf(t, failing.name)
            t.assert.equal(record.state, "failed", "the state")
            t.assert.equal(record.error, "broken on purpose", "the error")
            t.assert.ok(written.error.some((e) => e.includes(failing.name) && e.includes("broken on purpose")),
                `errors: ${written.error.join(" | ") || "none"}`)
        }
    },
    {
        name: "an error in after or commands makes the call fail",
        run: (t) => {
            consoleCapture(t)
            const { spoonMake } = loaderFake(t)
            const a = spoonMake(), c = spoonMake()
            t.spoon.use(a.name, { after: () => { throw new Error("after failed") } })
            t.spoon.use(c.name, { commands: () => { throw new Error("commands failed") } })
            t.assert.equal(statusOf(t, a.name).error, "after failed", "after")
            t.assert.equal(statusOf(t, c.name).error, "commands failed", "commands")
        }
    },
    {
        name: "use.file() loads a file by its absolute path and returns what it exports",
        run: (t) => {
            const path = `${t.dir}/plain.js`
            hs.fs.write(path, "module.exports = { plain: 42 }\n", false)
            t.cleanup(() => { delete require.cache[path] })
            let given = null
            const contents = t.spoon.use.file(path, { after: (c) => { given = c } })
            t.assert.equal(contents.plain, 42, "the exports")
            t.assert.equal(given, contents, "after received the exports")
            t.assert.equal(statusOf(t, path).state, "loaded", "the state")
        }
    },
    {
        name: "use.file() with disabled or a false when does not load the file",
        run: (t) => {
            const path = `${t.dir}/never.js`
            hs.fs.write(path, "throw new Error('this file must not be loaded')\n", false)
            t.assert.equal(t.spoon.use.file(path, { disabled: true }), null, "disabled")
            t.assert.equal(statusOf(t, path).state, "disabled", "the state when disabled")
            t.assert.equal(t.spoon.use.file(path, { when: () => false }), null, "when false")
            t.assert.equal(statusOf(t, path).state, "skipped", "the state when when is false")
        }
    },
    {
        name: "use.file() records a file that cannot be loaded as failed, and returns null",
        run: (t) => {
            consoleCapture(t)
            const path = `${t.dir}/no-such-file.js`
            t.assert.equal(t.spoon.use.file(path), null, "the result")
            t.assert.equal(statusOf(t, path).state, "failed", "the state")
        }
    },
    {
        name: "use.file() resolves a path beginning with ./ or ../ from the configuration directory",
        run: (t) => {
            const errors = consoleCapture(t).error
            // The fixture's path relative to the configuration directory, without writing
            // anything into that directory.
            const from = hs.appinfo.configDir.split("/").filter(Boolean)
            const to = `${__dirname}/use-file-fixture.js`.split("/").filter(Boolean)
            let common = 0
            while (common < from.length && from[common] === to[common]) common++
            const up = from.length - common
            const path = (up === 0 ? "./" : "../".repeat(up)) + to.slice(common).join("/")
            t.cleanup(() => {
                for (const key of Object.keys(require.cache)) if (key.endsWith("use-file-fixture.js")) delete require.cache[key]
            })
            const contents = t.spoon.use.file(path)
            t.assert.ok(contents && contents.fixture === "use-file-fixture",
                `${path} was not loaded; errors: ${errors.join(" | ") || "none"}`)
            t.assert.equal(statusOf(t, path).state, "loaded", "the record keeps the path as written")
        }
    },
    {
        name: "use.status() returns a copy of each record, as {name, state, ms, error}",
        run: (t) => {
            const { spoonMake } = loaderFake(t)
            const spoon = spoonMake()
            t.spoon.use(spoon.name)
            const record = statusOf(t, spoon.name)
            t.assert.equal(Object.keys(record).sort().join(","), "error,ms,name,state", "the fields")
            record.state = "changed by the test"
            t.assert.equal(statusOf(t, spoon.name).state, "loaded", "a change to the copy reached the records")
        }
    },
    {
        name: "use.report() logs one line per call and a summary, and returns the counts",
        run: (t) => {
            const { spoonMake } = loaderFake(t)
            const loadedSpoon = spoonMake()
            t.spoon.use(loadedSpoon.name)
            const before = t.spoon.use.status()
            const expected = { loaded: 0, disabled: 0, skipped: 0, failed: 0 }
            for (const r of before) expected[r.state] += 1
            const written = consoleCapture(t)
            const counts = t.spoon.use.report()
            t.assert.equal(JSON.stringify(counts), JSON.stringify(expected), "the counts")
            const lines = written.log.filter((l) => l.startsWith("[use] "))
            t.assert.equal(lines.length, before.length + 1, "the lines")
            t.assert.ok(lines.some((l) => l.includes(loadedSpoon.name) && l.includes("loaded")), "no line for the loaded Spoon")
            t.assert.ok(/\d+ loaded, \d+ disabled, \d+ skipped, \d+ failed, in \d+ ms/.test(lines[lines.length - 1]),
                `the summary: ${lines[lines.length - 1]}`)
        }
    }
]

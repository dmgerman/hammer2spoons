// Tests of how options are drawn, options whose picture changes, icons and letters, as the
// readme describes them under "Options whose picture changes", "Icons", "Letters" and "How
// options are drawn". The copy under test saves its pictures in the run's directory
// (tests/spoon.js). The icon tests only read the user's icon file agenda.png.

const ICON = "agenda.png"

function consoleErrors(t) {
    const original = console.error
    const errors = []
    console.error = (...args) => { errors.push(args.join(" ")); original.apply(console, args) }
    t.cleanup(() => { console.error = original })
    return errors
}

// The pictures saved in the copy's cache directory.
function saved(t) {
    return (hs.fs.list(t.spoon.config.cacheDir) || []).filter((name) => name.endsWith(".png"))
}

// Starts each test with empty caches, so that it can count what it saves.
function cachesEmpty(t) {
    t.spoon.diskCacheClear()
}

// A presenter that records what it is given and each image it is sent.
function presenterMake(progressive = true) {
    return {
        progressive,
        canHide: true,
        presented: [],
        images: [],
        present(session, buttons) { this.presented.push(buttons) },
        setImage(index, image) { this.images.push(index) },
        close() {}
    }
}

function open(t, menu, presenter) {
    const session = t.spoon.sessionOpen(menu, presenter, { name: "Root" })
    t.cleanup(() => { if (!session.isClosed()) session.close() })
    return session
}

const draw = (t, button) => t.spoon.buttonImage(button, {})

// A label unique to the run, so that no picture saved earlier is used again.
let made = 0
const label = (t) => `pic ${t.runId} ${++made}`

module.exports = [
    // --- drawing and the caches ---
    {
        name: "buttonImage() draws an option and resolves to an HSImage the size of a tile",
        run: async (t) => {
            cachesEmpty(t)
            const image = await draw(t, { label: label(t) })
            t.assert.ok(image, "no image")
            t.assert.equal(image.typeName, "HSImage", "the type")
            t.assert.equal(image.size.w, t.spoon.config.tileSize, "the width in points")
        }
    },
    {
        name: "a drawn option is saved in cacheDir once, and used again",
        run: async (t) => {
            cachesEmpty(t)
            const option = { label: label(t) }
            await draw(t, option)
            t.assert.equal(saved(t).length, 1, "pictures after the first drawing")
            await draw(t, option)
            t.assert.equal(saved(t).length, 1, "pictures after the second drawing")
        }
    },
    {
        name: "imageCacheClear() keeps the saved files, and diskCacheClear() deletes them and says how many",
        run: async (t) => {
            cachesEmpty(t)
            await draw(t, { label: label(t) })
            await draw(t, { label: label(t) })
            t.spoon.imageCacheClear()
            t.assert.equal(saved(t).length, 2, "pictures after imageCacheClear()")
            t.assert.equal(t.spoon.diskCacheClear(), 2, "diskCacheClear() returned")
            t.assert.equal(saved(t).length, 0, "pictures after diskCacheClear()")
        }
    },
    {
        name: "the picture of an option with imageProvider is never saved",
        run: async (t) => {
            cachesEmpty(t)
            const image = await draw(t, { label: label(t), imageProvider: () => ({ label: "drawn" }) })
            t.assert.ok(image, "no image")
            t.assert.equal(saved(t).length, 0, "pictures saved")
        }
    },
    {
        name: "an icon that cannot be loaded is reported, the option is drawn, and it is not saved",
        run: async (t) => {
            cachesEmpty(t)
            const errors = consoleErrors(t)
            const image = await draw(t, { label: label(t), icon: "no-such-icon-zq.png" })
            t.assert.ok(image, "the option was not drawn")
            t.assert.ok(errors.some((e) => e.includes("no-such-icon-zq.png")), `errors: ${errors.join(" | ") || "none"}`)
            t.assert.equal(saved(t).length, 0, "pictures saved")
        }
    },
    {
        name: "an option with no fields is drawn, and an icon that cannot be loaded is drawn without a label",
        run: async (t) => {
            cachesEmpty(t)
            const errors = consoleErrors(t)
            t.assert.ok(await draw(t, {}), "the option without fields")
            t.assert.ok(await draw(t, { icon: "no-such-icon-zq.png" }), "the option with only a missing icon")
            t.assert.ok(errors.length > 0, "the missing icon was not reported")
        }
    },
    {
        name: "hideLabel, background, labelColor and symbolColor each identify a different saved picture",
        run: async (t) => {
            cachesEmpty(t)
            const name = label(t)
            const base = { label: name, icon: "symbol:hammer" }
            for (const extra of [{}, { hideLabel: true }, { background: "#203040" }, { labelColor: "#405060" }, { symbolColor: "#FF0000" }, { symbolColor: "#00FF00" }]) {
                await draw(t, Object.assign({}, base, extra))
            }
            t.assert.equal(saved(t).length, 6, "pictures saved")
        }
    },
    {
        name: "an option whose icon is an HSImage is drawn each time and never saved",
        run: async (t) => {
            cachesEmpty(t)
            // Two different images of the same size.
            const first = await draw(t, { label: label(t) })
            const second = await draw(t, { label: label(t) })
            cachesEmpty(t)
            const name = label(t)
            const a = await draw(t, { label: name, icon: first })
            const b = await draw(t, { label: name, icon: second })
            t.assert.ok(a && b, "an option was not drawn")
            t.assert.ok(a !== b, "the two options were given the same picture")
            t.assert.equal(saved(t).length, 0, "pictures saved")
        }
    },
    {
        name: "a saved picture is used again after tileSize changes, until diskCacheClear()",
        run: async (t) => {
            cachesEmpty(t)
            const option = { label: label(t) }
            const size = t.spoon.config.tileSize
            t.cleanup(() => { t.spoon.config.tileSize = size })
            await draw(t, option)
            // Read from the saved file, which may report its size in pixels rather than points.
            t.spoon.imageCacheClear()
            const before = (await draw(t, option)).size.w
            t.spoon.config.tileSize = size + 20
            t.spoon.imageCacheClear()
            t.assert.equal((await draw(t, option)).size.w, before, "the width before diskCacheClear()")
            t.spoon.diskCacheClear()
            t.assert.equal((await draw(t, option)).size.w, size + 20, "the width after diskCacheClear()")
        }
    },
    {
        name: "a font that is not installed still draws the option",
        run: async (t) => {
            cachesEmpty(t)
            const font = t.spoon.config.font
            t.cleanup(() => { t.spoon.config.font = font })
            t.spoon.config.font = "NoSuchFont-zq"
            t.assert.ok(await draw(t, { label: label(t) }), "no image")
        }
    },
    // --- imageProvider ---
    {
        name: "imageProvider receives {session, index, state} and may return option fields",
        run: async (t) => {
            let context = null
            const session = open(t, [{ label: "A" }, {
                label: label(t), stateProvider: () => ({ n: 1 }),
                imageProvider: (c) => { context = c; return { label: "from fields" } }
            }], presenterMake())
            await t.wait(0.5)
            t.assert.ok(context, "imageProvider was not called")
            t.assert.equal(context.session, session, "context.session")
            t.assert.equal(context.index, 1, "context.index")
            t.assert.equal(context.state, '{"n":1}', "context.state")
        }
    },
    {
        name: "imageProvider may return a string, an HSImage or a promise",
        run: async (t) => {
            const ready = await draw(t, { label: label(t) })
            const string = await draw(t, { imageProvider: () => "a label" })
            const image = await draw(t, { imageProvider: () => ready })
            const promised = await draw(t, { imageProvider: () => Promise.resolve({ label: "later" }) })
            t.assert.ok(string, "a string")
            t.assert.equal(image, ready, "an HSImage is displayed as it is")
            t.assert.ok(promised, "a promise")
        }
    },
    // --- redrawing ---
    {
        name: "an option is redrawn only when its stateProvider's result changes",
        run: async (t) => {
            let state = { n: 1 }
            const presenter = presenterMake(true)
            open(t, [{ label: label(t), updateInterval: 0.2, stateProvider: () => state, imageProvider: () => ({ label: JSON.stringify(state) }) }], presenter)
            await t.wait(0.4)
            presenter.images.length = 0
            await t.wait(0.7)
            t.assert.equal(presenter.images.length, 0, "redrawn while the state was the same")
            state = { n: 2 }
            await t.wait(0.5)
            t.assert.equal(presenter.images.length, 1, "redrawings after the state changed")
        }
    },
    {
        name: "an option with updateInterval and no stateProvider is redrawn at every interval",
        run: async (t) => {
            const presenter = presenterMake(true)
            open(t, [{ label: label(t), updateInterval: 0.2, imageProvider: () => ({ label: "tick" }) }], presenter)
            await t.wait(0.4)
            presenter.images.length = 0
            await t.wait(1.1)
            t.assert.ok(presenter.images.length >= 3, `redrawings in 1.1 s: ${presenter.images.length}`)
        }
    },
    {
        name: "session.update(index) redraws an option at once",
        run: async (t) => {
            let state = 1
            const presenter = presenterMake(true)
            const session = open(t, [{ label: label(t), updateInterval: 60, stateProvider: () => state, imageProvider: () => ({ label: String(state) }) }], presenter)
            await t.wait(0.4)
            presenter.images.length = 0
            state = 2
            session.update(0)
            await t.wait(0.4)
            t.assert.equal(presenter.images.length, 1, "redrawings")
        }
    },
    {
        name: "a presenter that cannot change its display gets the options once, with their images, and no redrawing",
        run: async (t) => {
            const presenter = presenterMake(false)
            open(t, [{ label: label(t) }, { label: label(t), updateInterval: 0.2, imageProvider: () => ({ label: "tick" }) }], presenter)
            await t.wait(1)
            t.assert.equal(presenter.presented.length, 1, "present() calls")
            t.assert.ok(presenter.presented[0].every((b) => b.image), "an option came without its image")
            t.assert.equal(presenter.images.length, 0, "setImage() calls")
        }
    },
    // --- icons ---
    {
        name: "an icon is loaded from iconDir, from a path, from ~, as an SF Symbol, as an application's icon, or as an HSImage",
        run: async (t) => {
            cachesEmpty(t)
            const errors = consoleErrors(t)
            const copy = `${t.dir}/icon-copy.png`
            hs.fs.copy(`${t.spoon.config.iconDir}/${ICON}`, copy)
            const ready = await draw(t, { label: label(t) })
            const forms = [
                { icon: ICON },
                { icon: copy },
                { icon: `~/${hs.appinfo.configDir.replace(hs.fs.homeDirectory() + "/", "")}/icons/${ICON}` },
                { icon: "symbol:hammer" },
                { icon: "bundle:com.apple.finder" },
                { icon: ready },
                { app: "com.apple.finder" }
            ]
            for (const form of forms) {
                const image = await draw(t, Object.assign({ label: label(t) }, form))
                t.assert.ok(image, `no image for ${JSON.stringify(form.icon || form.app)}`)
            }
            t.assert.equal(errors.join(" | "), "", "errors")
        }
    },
    // --- letters ---
    {
        name: "options without a key are given the unused letters of the alphabet in order",
        run: (t) => {
            const session = open(t, [{ label: "1" }, { label: "2", key: "a" }, { label: "3" }, { label: "4" }], presenterMake())
            t.assert.equal(session.letters().join(","), "s,a,d,f")
        }
    },
    {
        name: "a capital key keeps its case, digits and named keys are allowed, and assigned letters are lower case",
        run: (t) => {
            const session = open(t, [{ label: "1", key: "A" }, { label: "2" }, { label: "3", key: "3" }, { label: "4", key: "space" }, { label: "5", key: "[" }], presenterMake())
            t.assert.equal(session.letters().join(","), "A,a,3,space,[")
        }
    },
    {
        name: "options beyond the alphabet have no letter",
        run: (t) => {
            const count = t.spoon.config.alphabet.length + 2
            const session = open(t, Array.from({ length: count }, (_, i) => ({ label: String(i) })), presenterMake())
            const letters = session.letters()
            t.assert.equal(letters.filter((l) => l === null).length, 2, "options without a letter")
            t.assert.equal(letters.slice(0, 4).join(","), "a,s,d,f", "the home row first")
        }
    }
]

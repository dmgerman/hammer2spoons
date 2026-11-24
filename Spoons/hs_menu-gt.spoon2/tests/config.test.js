// Tests of the settings' defaults, as the readme lists them under "Configuration" and "The on-screen
// menu's settings". The copy's cacheDir is changed by tests/spoon.js, so its default is not
// checked here.

module.exports = [
    {
        name: "each setting can also be set on the Spoon's object, as hs.spoons.use()'s config option sets it",
        run: (t) => {
            const config = t.spoon.config
            const saved = Object.assign({}, config)
            t.cleanup(() => Object.assign(config, saved))
            const names = Object.keys(config)
            t.assert.ok(names.length > 0, "no settings")
            // A value that no setting has, set and restored at once.
            const marker = { zqMarker: true }
            for (const name of names) {
                // As hs.spoons.use() applies its config option: Object.assign(spoon, config).
                Object.assign(t.spoon, { [name]: marker })
                t.assert.equal(config[name], marker, `${name}: config after setting the object`)
                config[name] = saved[name]
                t.assert.equal(t.spoon[name], saved[name], `${name}: the object after setting config`)
            }
        }
    },
    {
        name: "the settings have the defaults the readme gives",
        run: (t) => {
            const c = t.spoon.config
            const expected = {
                iconDir: `${hs.appinfo.configDir}/icons`, tileSize: 96, holdSeconds: 0.5,
                alphabet: "asdfghjklqwertyuiopzxcvbnm", urlBundle: null, iconScale: 0.74,
                iconScaleAlone: 0.94, background: "#101014", labelColor: "#F0F0F0", labelSize: 15,
                labelSizeFloor: 9, font: "Helvetica", symbolColor: "#FFFFFF", alpha: 0.8
            }
            const wrong = Object.keys(expected).filter((k) => c[k] !== expected[k]).map((k) => `${k} is ${JSON.stringify(c[k])}`)
            t.assert.equal(wrong.join(", "), "", "settings that differ")
        }
    },
    {
        name: "the on-screen menu's settings have the defaults the readme gives",
        run: (t) => {
            const s = t.spoon.config.screen
            const expected = {
                tile: 96, spacing: 12, padding: 18, background: "#1C1C1EF5", letterSize: 18,
                letterColor: "#FFD479", level: "floating", showDelay: 0.5,
                cancelKeys: ["escape"], backKeys: ["delete"]
            }
            const wrong = Object.keys(expected)
                .filter((k) => JSON.stringify(s[k]) !== JSON.stringify(expected[k]))
                .map((k) => `${k} is ${JSON.stringify(s[k])}`)
            t.assert.equal(wrong.join(", "), "", "settings that differ")
            t.assert.equal(typeof s.columnsFor, "function", "columnsFor")
        }
    },
    {
        name: "the default columnsFor gives four columns, one per option below four, and more for a large menu",
        run: (t) => {
            const columns = t.spoon.config.screen.columnsFor
            t.assert.equal([1, 2, 3, 4, 8, 10].map(columns).join(","), "1,2,3,4,4,4", "small menus")
            for (const count of [20, 30, 60]) {
                const c = columns(count)
                t.assert.ok(c > 4 && c > Math.ceil(count / c), `${count} options: ${c} columns, ${Math.ceil(count / c)} rows`)
            }
        }
    }
]

// Tests of Hammerspoon 2's hs.windowfilter, for the behaviour this Spoon relies on.
//
// They answer the open questions in ai/compare-hs.windowfilter.org (bead hammer2spoons-rr1.5),
// which decide how this Spoon uses hs.windowfilter. Each test registers its listeners on a filter
// of its own, and removes them when it ends, so that the filter stops observing.

// Registers handler for each of the events on filter, and removes it when the test ends.
function listen(t, filter, events, handler) {
    for (const event of events) filter.on(event, handler)
    t.cleanup(() => { for (const event of events) filter.off(event, handler) })
}

// Waits until window has the focus. focus() activates the window's application, which a
// window of an inactive application needs before it can have the focus.
async function focusWait(t, window) {
    window.focus()
    const started = Date.now()
    while (!window.isFocused) {
        if (Date.now() - started > 3000) t.assert.fail(`"${window.title}" did not take the focus`)
        await t.wait(0.05)
    }
    // hs.windowfilter reads a window again 0.2 s after a change, and emits its events then.
    await t.wait(0.5)
}

module.exports = [
    {
        name: "hs.windowfilter emits windowUnfocused before windowFocused when the focus moves between two windows of one application",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const names = new Map([[first.id, "first"], [second.id, "second"]])
            const filter = hs.windowfilter.create({})
            const events = []
            listen(t, filter, ["windowFocused", "windowUnfocused"], (window, appName, event) => {
                if (window && names.has(window.id)) events.push(`${event} ${names.get(window.id)}`)
            })
            await focusWait(t, first)
            events.length = 0
            await focusWait(t, second)
            t.assert.equal(events.join(", "), "windowUnfocused first, windowFocused second", "events")
        }
    },
    {
        name: "hs.windowfilter's windows(\"focusedLast\") lists the focused window first and the one focused before it second",
        run: async (t) => {
            const [first, second] = await t.windowsOpen(2)
            const filter = hs.windowfilter.create({})
            listen(t, filter, ["windowDestroyed"], () => {})
            await focusWait(t, first)
            await focusWait(t, second)
            const ids = filter.windows("focusedLast").map((w) => w.id)
            t.assert.equal(ids[0], second.id, "the first window listed")
            t.assert.equal(ids[1], first.id, "the second window listed")
        }
    },
    {
        name: "hs.windowfilter allows a window created without a title, under allowTitles: 1, once its title is set",
        run: async (t) => {
            const filter = hs.windowfilter.create({ default: { allowTitles: 1, allowRoles: "*" } })
            const allowed = []
            listen(t, filter, ["windowAllowed"], (window) => { if (window) allowed.push(window.id) })
            const window = await t.windowOpenBorderless("")
            await t.wait(0.5)
            t.assert.ok(!filter.windows().some((w) => w.id === window.id), "the window was allowed without a title")
            await t.windowTitleSet(window, `${t.titlePrefix}titled`)
            await t.wait(0.5)
            t.assert.ok(filter.windows().some((w) => w.id === window.id), "the window was not allowed after its title was set")
            t.assert.ok(allowed.includes(window.id), "windowAllowed was not emitted")
        }
    },
]

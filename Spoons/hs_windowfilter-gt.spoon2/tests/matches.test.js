// Tests of matches(rule, value), the function every rule that matches text uses. These need no
// window. The readme describes the rule values under "Matching".

// Records what console.error writes until the test ends, and returns the list.
function consoleErrorsCapture(t) {
    const original = console.error
    const errors = []
    console.error = (...args) => {
        errors.push(args.join(" "))
        original.apply(console, args)
    }
    t.cleanup(() => { console.error = original })
    return errors
}

// Each case: [description, rule, value, expected].
const CASES = [
    ["a string matches exactly that text", "Inbox", "Inbox", true],
    ["a string does not match a longer text", "Inbox", "Inbox 2", false],
    ["a string does not match a text that differs in case", "Inbox", "inbox", false],
    ["a regular expression matches a text it finds a match in", /^Inbox/, "Inbox 2", true],
    ["a regular expression does not match a text it finds no match in", /^Inbox/, "My Inbox", false],
    ["a regular expression is tested against an empty text for null", /^$/, null, true],
    ["a function matches when it returns a true value", (text) => text.length > 3, "Inbox", true],
    ["a function does not match when it returns a false value", (text) => text.length > 9, "Inbox", false],
    ["an array matches when one of its elements matches", ["Drafts", /^Inbox/], "Inbox 2", true],
    ["an array does not match when none of its elements matches", ["Drafts", /^Sent/], "Inbox", false],
    ["an array can hold a function", ["Drafts", (text) => text === "Inbox"], "Inbox", true],
    ["an empty array matches nothing", [], "Inbox", false],
    ["no rule (undefined) matches everything", undefined, "Inbox", true],
    ["no rule (null) matches everything", null, "Inbox", true]
]

const tests = CASES.map(([description, rule, value, expected]) => ({
    name: `matches: ${description}`,
    run: (t) => t.assert.equal(t.spoon.matches(rule, value), expected)
}))

tests.push({
    name: "matches: a function that throws matches nothing, and its error is written to the console",
    run: (t) => {
        const errors = consoleErrorsCapture(t)
        const rule = () => { throw new Error("broken rule") }
        t.assert.equal(t.spoon.matches(rule, "Inbox"), false, "the result")
        t.assert.ok(errors.some((e) => e.includes("broken rule")), `console errors: ${errors.join(" | ") || "none"}`)
    }
})

module.exports = tests

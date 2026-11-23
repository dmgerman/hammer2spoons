# Developer targets for a Spoon's tests. Not part of the Spoon that users download.
#
# Shared by every Spoon: edit tests-common/makefile, not a copy, and run tests-common/sync.
#
#   make test                                     runs every tests/*.test.js
#   make test TESTS="tests/selftest/*.test.js"   runs the given test files
#   make test-two-screens                         runs only the tests that need two screens
#
# make starts the tests at once, and shows no chooser at the start or the end. tests/run alone
# asks on screen whether to start, and at the end whether the run was uninterrupted.
#
# The tests that need two screens are all in tests/two-screens.test.js. make test runs them
# too, and reports them as skipped when only one screen is connected.

TESTS ?=

.PHONY: test test-two-screens
test:
	tests/run --no-confirm $(TESTS)

test-two-screens:
	tests/run --no-confirm tests/two-screens.test.js

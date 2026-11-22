# Developer targets for hs_window-gt. Not part of the Spoon that users download.
#
#   make test                                     runs every tests/*.test.js
#   make test TESTS="tests/selftest/*.test.js"   runs the given test files
#   make test-two-screens                         runs only the tests that need two screens
#
# The tests that need two screens are all in tests/two-screens.test.js. make test runs them
# too, and reports them as skipped when only one screen is connected.

TESTS ?=

.PHONY: test test-two-screens
test:
	tests/run $(TESTS)

test-two-screens:
	tests/run tests/two-screens.test.js

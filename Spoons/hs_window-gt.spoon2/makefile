# Developer targets for hs_window-gt. Not part of the Spoon that users download.
#
#   make test                                     runs every tests/*.test.js
#   make test TESTS="tests/selftest/*.test.js"   runs the given test files

TESTS ?=

.PHONY: test
test:
	tests/run $(TESTS)

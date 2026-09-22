package main

// developmentVersion is what a build with no stamp reports: `go run`, `go test` and `wails dev`. The update check treats it as
// a build that must not replace itself (docs/architecture/in-app-update.md).
const developmentVersion = "0.0.0-dev"

// version is the application's own version, bare semver: a release candidate and its promotion are the same bytes and report the
// same version. It is set at build time from the root package.json, `-ldflags "-X main.version=<version>"`, by
// scripts/release/wails-build.mjs for CI and for a local build alike, so a variable and not a constant.
var version = developmentVersion

// isVersionRequest reports whether the program was started only to say its version (`narration-utils --version`). The update
// flow runs a downloaded executable this way before it replaces the running one, and nothing else is started: no window, no
// single-instance hand-off, no sidecar.
func isVersionRequest(arguments []string) bool {
	return len(arguments) == 1 && arguments[0] == "--version"
}

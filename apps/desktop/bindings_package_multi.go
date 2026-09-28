package main

// The multi-platform export flow's bindings (render-encode-master.prd.md Phase 6): one mastered/encoded source
// produces packages for several selected delivery profiles in one action, over the same export job's own encoded
// files PackageStart (bindings_export.go) already uses. The orchestration is in multi_package_job.go.

// PackageStartMulti resolves every selected profile, works out each one's required encode format (mp3 by default; a
// profile whose rules name another format, such as M4B, triggers its own encode), reuses the export job's own
// encoded files for any selection that matches its format, asks for one root output folder, then builds each
// profile's package in its own named subfolder under it, in order, as a job. It refuses an empty selection, an
// unknown profile, a path that was not encoded in this session, or a second package build (single or multi-platform)
// or export while one runs. Closing the folder picker without choosing a folder answers the current (unstarted)
// state rather than an error.
func (h *Host) PackageStartMulti(req MultiPackageRequest) (string, error) {
	return encodeBinding(h.startMultiPackage(req))
}

// PackageMultiState answers the multi-platform package job: idle, running with each selected profile's own phase, or
// how it ended with every profile's own result (its manifest and checklist for a success, its message for a
// failure).
func (h *Host) PackageMultiState() (string, error) {
	return encodeBinding(h.multiPackageState(), nil)
}

// PackageMultiCancel stops a running multi-platform build before its next profile starts; packages already built
// keep their results, and a profile not yet reached stays pending. With none running it changes nothing.
func (h *Host) PackageMultiCancel() (string, error) {
	return encodeBinding(h.cancelMultiPackage(), nil)
}

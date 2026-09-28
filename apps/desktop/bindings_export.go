package main

// The Master & QC export flow's bindings (render-encode-master.prd.md Phase 5). The export job is in export_job.go,
// the package job in package_job.go; the wire-contract schema, golden payloads and mock are in apps/ui/src/api.

// ExportPickFiles opens the operating system's picker for the rendered chapter, credits and retail-sample files to
// master and encode, and answers the chosen paths (none when the narrator closes it). Only paths chosen here can be
// exported.
func (h *Host) ExportPickFiles() (string, error) {
	return encodeBinding(h.pickExportFiles())
}

// ExportStart masters (when req.master is true) and encodes the picked files as a job and answers it; it refuses a
// path that was not picked, a request with no items, or a second export while one runs.
func (h *Host) ExportStart(req ExportRequest) (string, error) {
	return encodeBinding(h.startExport(req))
}

// ExportState answers the export job: idle, running with real progress, or how it ended with every file's result.
func (h *Host) ExportState() (string, error) {
	return encodeBinding(h.exportState(), nil)
}

// ExportCancel stops a running export; files already prepared keep their results. With none running it changes
// nothing.
func (h *Host) ExportCancel() (string, error) {
	return encodeBinding(h.cancelExport(), nil)
}

// PackageStart opens the operating system's folder picker, then assembles the chosen profile's package from an
// export's own encoded files as a job, and answers it. It refuses a path that was not encoded in this session, no
// items, an unknown profile, or a second package build while one runs. Closing the picker without choosing a folder
// answers the current (unstarted) state rather than an error.
func (h *Host) PackageStart(req PackageRequest) (string, error) {
	return encodeBinding(h.startPackage(req))
}

// PackageState answers the package job: idle, running, or how it ended with the manifest and checklist it built.
func (h *Host) PackageState() (string, error) {
	return encodeBinding(h.packageState(), nil)
}

// PackageCancel stops a running package build. With none running it changes nothing.
func (h *Host) PackageCancel() (string, error) {
	return encodeBinding(h.cancelPackage(), nil)
}

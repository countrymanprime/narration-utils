package main

// UpdateStatus is the running version, the update channel, when the last check was and whether the newest release on the channel is
// newer than the running version. It answers from what the last check remembered and makes no request.
func (h *Host) UpdateStatus() (string, error) { return encodeBinding(h.updateStatus(), nil) }

// UpdateCheck asks GitHub for the release list now (the Check now button). Whatever happens, the answer is the status: a check that
// failed says why in `failure`.
func (h *Host) UpdateCheck() (string, error) {
	return encodeBinding(h.checkForUpdate(h.updateContext()), nil)
}

// UpdateOpenNotes opens the release notes of the release the last check found in the narrator's browser. It takes no address.
func (h *Host) UpdateOpenNotes() (string, error) { return encodeBinding(nil, h.openReleaseNotes()) }

// UpdateDownload starts downloading the release the last check found, when this program can install it. It is the narrator's explicit
// action and the only thing that downloads the update; progress is polled with UpdateJobState.
func (h *Host) UpdateDownload() (string, error) { return encodeBinding(h.startUpdateDownload()) }

// UpdateJobState is the download's phase and its real bytes.
func (h *Host) UpdateJobState(jobID string) (string, error) {
	return encodeBinding(h.updateJobState(jobID))
}

// UpdateJobCancel stops the download. What was fetched is removed while the file is still arriving; a zip that had arrived and been
// verified is kept, so trying again does not fetch it a second time.
func (h *Host) UpdateJobCancel(jobID string) (string, error) {
	return encodeBinding(h.cancelUpdateJob(jobID))
}

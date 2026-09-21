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

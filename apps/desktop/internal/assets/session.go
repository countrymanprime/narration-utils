package assets

import "sync"

// The first time an asset is used in a session it is read in full (Ready), whatever the manifest says: the cost is paid once, at the
// moment the narrator has asked for the feature, and a file that was damaged since the install is found before the model loads it and
// not by the model failing to. Later uses trust the manifest again. The record is per process and keyed by install directory, so it
// survives the managers being rebuilt when a project is attached.
var (
	sessionMu sync.Mutex
	verified  = map[string]bool{}
	// locks serialise the readers and writers of one install directory: a Verify that is hashing, the swap that replaces the install, and
	// the manifest records they leave, so a Verify of the old copy cannot mark a freshly installed one damaged.
	locks = map[string]*sync.Mutex{}
)

// lockFor returns the lock of one install directory.
func lockFor(dir string) *sync.Mutex {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	lock := locks[dir]
	if lock == nil {
		lock = &sync.Mutex{}
		locks[dir] = lock
	}
	return lock
}

// Ready is the state of an asset that is about to be used: verified in full once per session (however many callers ask at once: the
// others wait for the first), then as cheap as State.
func Ready(root, provider, id, version string, files []File) string {
	dir := Dir(root, provider, id, version)
	lock := lockFor(dir)
	lock.Lock()
	defer lock.Unlock()
	sessionMu.Lock()
	done := verified[dir]
	sessionMu.Unlock()
	if done {
		return State(root, provider, id, version, files)
	}
	state := verifyLocked(dir, provider, id, version, files)
	if state == "installed" {
		sessionMu.Lock()
		verified[dir] = true
		sessionMu.Unlock()
	}
	return state
}

// Forget drops the session's memory of an asset, so its next use reads it in full again (after an install, a repair or a removal).
func Forget(root, provider, id, version string) {
	sessionMu.Lock()
	delete(verified, Dir(root, provider, id, version))
	sessionMu.Unlock()
}

// Package persist is how the host reads a file it keeps on disk without ever failing silently (ADR 0069, rule 8). A file that
// cannot be decoded is handled by the class of data in it: disposable state heals and is logged; narrator-authored data is kept
// beside the original as `<name>.corrupt-<timestamp>`, a fresh one is started, the log records it and the narrator is told; a file
// written by a newer version of the app is refused with a message and never overwritten. Nothing here reads the file's content
// into a log or a notice: manuscript text can be in it.
package persist

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Class is what a file holds, which decides what happens when it cannot be read.
type Class int

const (
	// Disposable state can be rebuilt, so a file that cannot be read is logged and replaced by the next save (recent projects,
	// the last completed comparison).
	Disposable Class = iota
	// NarratorData is the narrator's own work (notes, reader state, settings): it is kept beside the original, and the narrator is told.
	NarratorData
)

// Outcome says how a read ended.
type Outcome int

const (
	// Missing means there is no file yet.
	Missing Outcome = iota
	// Loaded means the file was read and decoded.
	Loaded
	// Healed means a disposable file could not be decoded and was logged; the caller starts empty.
	Healed
	// Quarantined means narrator data could not be decoded and was kept aside; the caller starts fresh.
	Quarantined
	// Unreadable means the file exists but could not be read at all (a permission problem, a directory in its place); it is logged
	// and left where it is.
	Unreadable
)

// Reporter carries the two ways to say what happened. Both are optional, and a nil *Reporter is a valid Reporter that only reads
// and keeps: a service built without one (a test, a failed setup) still never overwrites a corrupt file.
type Reporter struct {
	// Log writes a line to the host log.
	Log func(kind, message string)
	// Notify tells the narrator in the app.
	Notify func(text string)
	now    func() time.Time
	rename func(oldPath, newPath string) error
}

func (r *Reporter) log(kind, message string) {
	if r != nil && r.Log != nil {
		r.Log(kind, message)
	}
}

// Warn writes a line to the host log for something worth a trace that is not a corrupt file. It is safe on a nil Reporter.
func (r *Reporter) Warn(kind, message string) { r.log(kind, message) }

func (r *Reporter) notify(text string) {
	if r != nil && r.Notify != nil {
		r.Notify(text)
	}
}

func (r *Reporter) stamp() string {
	now := time.Now
	if r != nil && r.now != nil {
		now = r.now
	}
	return now().Format("20060102-150405")
}

// ReadJSON reads path and hands its bytes to decode. `what` names the file for people ("notes", "settings"). A file that is not
// there is Missing; one that decodes is Loaded; anything else is handled by class as described on the package.
func (r *Reporter) ReadJSON(path, what string, class Class, decode func([]byte) error) Outcome {
	// One reader at a time per file: two goroutines that both see a corrupt file must not both move it, and a reader working from
	// stale bytes must not move the fresh file a save wrote in between.
	unlock := lockPath(path)
	defer unlock()
	bytes, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return Missing
	}
	if err != nil {
		r.log("persisted_unreadable", fmt.Sprintf("%s file %s could not be read: %v", what, filepath.Base(path), err))
		return Unreadable
	}
	if decodeErr := decode(bytes); decodeErr == nil {
		return Loaded
	}
	if class == Disposable {
		r.log("persisted_corrupt", fmt.Sprintf("%s file %s is not valid JSON; it starts empty and the next save replaces it", what, filepath.Base(path)))
		return Healed
	}
	r.quarantine(path, what)
	return Quarantined
}

func (r *Reporter) quarantine(path, what string) {
	kept := path + ".corrupt-" + r.stamp()
	// Two corrupt files in the same second must not overwrite each other's copy.
	for attempt := 2; ; attempt++ {
		if _, err := os.Lstat(kept); err != nil {
			break
		}
		kept = fmt.Sprintf("%s.corrupt-%s-%d", path, r.stamp(), attempt)
	}
	r.log("persisted_corrupt", fmt.Sprintf("%s file %s is not valid JSON; keeping it as %s and starting a fresh one", what, filepath.Base(path), filepath.Base(kept)))
	move := os.Rename
	if r != nil && r.rename != nil {
		move = r.rename
	}
	if err := move(path, kept); err != nil {
		r.log("persisted_corrupt", fmt.Sprintf("%s file %s could not be moved aside: %v", what, filepath.Base(path), err))
		r.notify(fmt.Sprintf("Your %s file could not be read, and it could not be moved aside, so it was left where it is. Fix or remove it, then reopen the project.", what))
		return
	}
	r.notify(fmt.Sprintf("Your %s file could not be read. It was kept as %s next to the original, and a fresh one was started.", what, filepath.Base(kept)))
}

var pathLocks sync.Map

// lockPath returns with the path's mutex held and hands back its unlock; the mutex is looked up at run time, so
// checklocks cannot follow it.
// +checklocksignore
func lockPath(path string) func() {
	lock, _ := pathLocks.LoadOrStore(filepath.Clean(path), &sync.Mutex{})
	mutex, _ := lock.(*sync.Mutex)
	mutex.Lock()
	return mutex.Unlock
}

// CanOverwrite is the check a writer makes before it replaces a narrator's file: a file that is not there, or can be read, may be
// replaced; one that exists but cannot be read (a sharing violation, a permission problem) may not, because the writer would be
// working from an empty copy of it and would destroy what it could not see.
func CanOverwrite(path, what string) error {
	unlock := lockPath(path)
	defer unlock()
	if _, err := os.ReadFile(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("your %s file could not be read, so nothing was saved: %w", what, err)
	}
	return nil
}

// CheckVersion is the version policy for a file the host and the sidecars both write: a version at or below the one this host
// understands is read (a file with no version is an old one), and a newer one is refused with a message, so the file is never
// read as something it is not or overwritten by an older app.
func CheckVersion(found, supported int, what string) error {
	if found > supported {
		return fmt.Errorf("the %s data was written by a newer version of Narration Utils (schema %d, this one reads up to %d); update the app to open it", what, found, supported)
	}
	return nil
}

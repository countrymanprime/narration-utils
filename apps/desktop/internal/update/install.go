package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	// relaunchFlag is how the running program tells the copy it starts which process to wait for: the single-instance lock is held
	// until that process exits, so the new copy waits for it before it opens its window.
	relaunchFlag = "--relaunch-after"
	oldSuffix    = ".old"
	newSuffix    = ".new"
	failedSuffix = ".failed"
	// smokeTimeout bounds asking the new program its version: it prints it and exits at once.
	smokeTimeout = 20 * time.Second
	// maxProcessID bounds a process id read from an argument.
	maxProcessID = 1<<31 - 1
	// relaunchWait is how long a relaunched copy waits for the program it replaces to exit.
	relaunchWait = 30 * time.Second
	// renameAttempts and renameDelay retry a rename that fails: antivirus software holds a just-written program open for a moment, and a
	// sharing violation that would clear in a fraction of a second must not become a failed update or a failed restore.
	renameAttempts = 10
	// pendingMaxAge is how long an unconfirmed record is trusted: an older one is a leftover, not a start in progress.
	pendingMaxAge = 7 * 24 * time.Hour
)

// renameDelay is a variable so a test does not wait it out.
var renameDelay = 150 * time.Millisecond

// ErrBusy is returned by Install when work started after the narrator's click that a restart would displace.
var ErrBusy = userError("Narration Utils is busy, so the update was not installed. Finish or stop what is running (an import, a Story Bible build, a download, a comparison or a teleprompter session), then try again.")

func renameWithRetry(rename func(oldPath, newPath string) error, oldPath, newPath string) error {
	var err error
	for attempt := 0; attempt < renameAttempts; attempt++ {
		if err = rename(oldPath, newPath); err == nil {
			return nil
		}
		time.Sleep(renameDelay)
	}
	return err
}

// restoreProgram puts the program that was replaced back under its name: whatever is at the program's path (the new one) is moved
// aside as `.failed`, then `.old` takes the name. It reports whether the program is back, and when it is not, says which file to
// rename by hand.
func restoreProgram(rename func(oldPath, newPath string) error, executable string) error {
	oldPath, failedPath := executable+oldSuffix, executable+failedSuffix
	if _, err := os.Lstat(executable); err == nil {
		_ = os.Remove(failedPath)
		_ = renameWithRetry(rename, executable, failedPath)
	}
	if err := renameWithRetry(rename, oldPath, executable); err != nil {
		return userError("The previous version of Narration Utils could not be put back. Rename " + oldPath + " to " + executable + " to get it back.")
	}
	if _, err := os.Lstat(executable); err != nil {
		return userError("The previous version of Narration Utils could not be put back. Rename " + oldPath + " to " + executable + " to get it back.")
	}
	return nil
}

// ErrNotWritable is returned when the folder the program lives in cannot be written to (Program Files, a locked-down share): the
// app never asks for elevation, so the narrator replaces the program by hand.
var ErrNotWritable = userError("Narration Utils is installed where it is not allowed to replace itself. Download the update and replace the program yourself, or ask whoever manages this computer.")

// Pending records an update that has been swapped in and has not yet started successfully, so the next launch can tell an update that
// worked from one that did not.
type Pending struct {
	From       string    `json:"from"`
	To         string    `json:"to"`
	Executable string    `json:"executable"`
	StartedAt  time.Time `json:"startedAt"`
	// Attempts counts the starts of the new program that did not reach the point of confirming, and AttemptPID is the process of the
	// last one: a launch that finds that process still alive is a second instance that will forward its arguments and exit, not
	// evidence that the start failed.
	Attempts   int `json:"attempts"`
	AttemptPID int `json:"attemptPid"`
}

func readPending(path string) (Pending, bool) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return Pending{}, false
	}
	var pending Pending
	if json.Unmarshal(bytes, &pending) != nil || pending.To == "" || pending.Executable == "" {
		return Pending{}, false
	}
	return pending, true
}

func writePending(path string, pending Pending) error {
	bytes, err := json.Marshal(pending)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, bytes, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

// InstallOptions say what to install and where; the fields after Now are seams for tests and default to the real thing.
type InstallOptions struct {
	// Staged is the verified program in the update cache.
	Staged Staged
	// Executable is the path of the running program, which is replaced at that path and under that name.
	Executable string
	// Args are the arguments the running program was started with (`--project-folder`, `--session-dir`, `--daw`, and the rest); the new
	// copy is started with exactly these.
	Args []string
	PID  int
	// From and To are the running version and the one being installed.
	From, To    string
	PendingPath string
	// Dir is the working directory of the new copy; the current one when empty.
	Dir string

	Now      func() time.Time
	Writable func(dir string) error
	Free     func(path string) (uint64, error)
	// Ready is asked once more just before the swap: work that started since the narrator's click, and that a restart would displace,
	// stops the install with ErrBusy.
	Ready      func() bool
	RunVersion func(ctx context.Context, program string) (string, error)
	Spawn      func(program string, args []string, dir string) error
	Rename     func(oldPath, newPath string) error
}

func (o *InstallOptions) rename(oldPath, newPath string) error {
	if o.Rename != nil {
		return o.Rename(oldPath, newPath)
	}
	return os.Rename(oldPath, newPath)
}

// WritableDir reports nil when a file can be created, written and removed in dir.
func WritableDir(dir string) error {
	file, err := os.CreateTemp(dir, ".narration-utils-write-check-*")
	if err != nil {
		return err
	}
	name := file.Name()
	_, writeErr := file.WriteString("x")
	closeErr := file.Close()
	removeErr := os.Remove(name)
	return errors.Join(writeErr, closeErr, removeErr)
}

func runVersion(ctx context.Context, program string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, smokeTimeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, program, "--version").Output() //nolint:gosec // G204: the program is the verified copy of the update just placed beside this one
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

// Install puts the staged program in place of the running one and starts it. In order: the folder must be writable and have room; the
// staged program is copied beside the running one while it is hashed, and must match the hash it was verified with; the copy is run
// once and must report the version the release names; a record is written; the running program is renamed to `.old` (a running
// program can be renamed, not overwritten) and the copy takes its name; the copy is started with the same arguments and told to
// wait for this process to exit. Any failure before the start puts everything back as it was. The caller then closes the app.
func Install(ctx context.Context, options InstallOptions) error {
	executable, dir := options.Executable, filepath.Dir(options.Executable)
	if options.Staged.Executable == "" || executable == "" || options.To == "" {
		return userError("There is no downloaded update to install.")
	}
	writable := options.Writable
	if writable == nil {
		writable = WritableDir
	}
	if err := writable(dir); err != nil {
		return ErrNotWritable
	}
	stager := &Stager{Free: options.Free}
	if err := stager.roomFor(dir, uint64(options.Staged.ExecutableSize)+downloadHeadroom); err != nil { //nolint:gosec // G115: the size was checked against maxExecutable when it was staged
		return err
	}
	newPath, oldPath := executable+newSuffix, executable+oldSuffix
	_ = os.Remove(newPath)
	_ = os.Remove(executable + failedSuffix)
	if err := copyVerified(ctx, options.Staged, newPath); err != nil {
		_ = os.Remove(newPath)
		return err
	}
	probe := options.RunVersion
	if probe == nil {
		probe = runVersion
	}
	if reported, err := probe(ctx, newPath); err != nil || reported != options.To {
		_ = os.Remove(newPath)
		sentence := userError("The downloaded program does not report the version the release names, so it was not installed.")
		if err != nil {
			return errors.Join(sentence, err)
		}
		return sentence
	}
	if options.Ready != nil && !options.Ready() {
		_ = os.Remove(newPath)
		return ErrBusy
	}
	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	if err := writePending(options.PendingPath, Pending{From: options.From, To: options.To, Executable: executable, StartedAt: now()}); err != nil {
		_ = os.Remove(newPath)
		return userError("The update could not be recorded, so it was not installed.")
	}
	undo := func() {
		_ = os.Remove(newPath)
		_ = os.Remove(options.PendingPath)
	}
	// A leftover of an update that was never confirmed is not the program to keep: the running one is.
	_ = os.Remove(oldPath)
	if _, err := os.Lstat(oldPath); err == nil {
		undo()
		return userError("A file left by an earlier update could not be removed, so this one was not installed.")
	}
	if err := renameWithRetry(options.rename, executable, oldPath); err != nil {
		undo()
		return errors.Join(userError("The running program could not be moved aside, so it was not replaced."), err)
	}
	if err := renameWithRetry(options.rename, newPath, executable); err != nil {
		// The program's own path is empty until the old one is back; a failure to put it back keeps the record and .old.
		_ = os.Remove(newPath)
		if restoreErr := restoreProgram(options.rename, executable); restoreErr != nil {
			return errors.Join(restoreErr, err)
		}
		_ = os.Remove(options.PendingPath)
		return errors.Join(userError("The new program could not be put in place, so nothing was changed."), err)
	}
	spawn := options.Spawn
	if spawn == nil {
		spawn = SpawnDetached
	}
	workingDir := options.Dir
	if workingDir == "" {
		workingDir, _ = os.Getwd()
	}
	arguments := append([]string{relaunchFlag, strconv.Itoa(options.PID)}, options.Args...)
	if err := spawn(executable, arguments, workingDir); err != nil {
		// Put the running program back under its name before the failure is reported: the narrator keeps a working app. If that is
		// not possible the record and .old are kept and the error says which file to rename.
		if restoreErr := restoreProgram(options.rename, executable); restoreErr != nil {
			return errors.Join(restoreErr, err)
		}
		undo()
		return err
	}
	return nil
}

// copyVerified copies the staged program to destination, hashing it as it goes, and refuses it unless it is the size and the SHA-256
// it was verified with: one pass, so what was checked is what was copied.
func copyVerified(ctx context.Context, staged Staged, destination string) error {
	info, err := os.Lstat(staged.Executable)
	if err != nil || !info.Mode().IsRegular() || info.Size() != staged.ExecutableSize {
		return userError("The downloaded program is not the one that was checked, so it was not installed.")
	}
	source, err := os.Open(staged.Executable)
	if err != nil {
		return userError("The downloaded program could not be read.")
	}
	defer func() { _ = source.Close() }()                                          // read-only
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700) //nolint:gosec // G302: the program has to be executable; the path is beside the running program
	if err != nil {
		return userError("The new program could not be copied next to the running one.")
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(out, hash), &cancelReader{ctx: ctx, reader: io.LimitReader(source, staged.ExecutableSize+1)})
	syncErr := out.Sync()
	closeErr := out.Close()
	switch {
	case ctx.Err() != nil:
		return ctx.Err()
	case copyErr != nil || syncErr != nil || closeErr != nil:
		return userError("The new program could not be copied next to the running one.")
	case written != staged.ExecutableSize || hex.EncodeToString(hash.Sum(nil)) != staged.ExecutableSHA256:
		return userError("The downloaded program is not the one that was checked, so it was not installed.")
	}
	return nil
}

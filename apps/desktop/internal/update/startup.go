package update

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// samePath compares two paths to the same program as the system does: Windows ignores case.
func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// TakeRelaunchArgs removes `--relaunch-after <pid>` from the front of the arguments, where Install and the rollback put it, and
// returns the pid (0 when there was none or it is not a process id). The rest, in order, are the arguments the program was really
// started with; the flag anywhere else is an ordinary argument that the program ignores.
func TakeRelaunchArgs(arguments []string) (rest []string, pid int) {
	if len(arguments) == 0 || arguments[0] != relaunchFlag {
		return append([]string{}, arguments...), 0
	}
	if len(arguments) == 1 {
		return []string{}, 0
	}
	if parsed, err := strconv.Atoi(arguments[1]); err == nil && parsed > 0 && parsed <= maxProcessID {
		pid = parsed
	}
	return append([]string{}, arguments[2:]...), pid
}

// CurrentExecutable is the path of the running program with any links resolved: the one path every part of the update (the install,
// the record, the start and the confirmation) uses for it.
func CurrentExecutable() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(path)
}

// StartupOptions say where the program is and what state the last update left; the fields after Log are seams for tests.
type StartupOptions struct {
	Executable  string
	Args        []string
	PendingPath string
	// Version is the running version.
	Version string
	PID     int
	// Log writes a line to the host log.
	Log func(kind, message string)

	Wait   func(pid int, timeout time.Duration)
	Spawn  func(program string, args []string, dir string) error
	Rename func(oldPath, newPath string) error
	Alive  func(pid int) bool
	Now    func() time.Time
}

func (o StartupOptions) log(kind, message string) {
	if o.Log != nil {
		o.Log(kind, message)
	}
}

// StartupResult is what the program does next: run with Args, or stop because it handed over to the version it restored.
type StartupResult struct {
	Args       []string
	RolledBack bool
}

// Startup runs first in every launch, before the window and before the single-instance lock is asked for. It removes the relaunch
// arguments and waits for the program that started this one to exit. Then it looks at the record an update leaves: a record for
// this version that is on its second start means the first did not reach the point of confirming, so the program that was replaced
// is put back and started, and this one stops. Anything else starts normally.
func Startup(options StartupOptions) StartupResult {
	rest, pid := TakeRelaunchArgs(options.Args)
	if pid > 0 {
		wait := options.Wait
		if wait == nil {
			wait = WaitForExit
		}
		wait(pid, relaunchWait)
	}
	result := StartupResult{Args: rest}
	pending, ok := readPending(options.PendingPath)
	if !ok {
		return result
	}
	now := time.Now
	if options.Now != nil {
		now = options.Now
	}
	if !pending.StartedAt.IsZero() && now().Sub(pending.StartedAt) > pendingMaxAge {
		// A leftover, not a start in progress.
		_ = os.Remove(options.PendingPath)
		return result
	}
	if pending.To != options.Version || !samePath(pending.Executable, options.Executable) {
		// A record for another version or another install is not about this program (a development build or an older portable copy
		// starting must not erase the protection of the update that is in progress).
		return result
	}
	if pending.Attempts >= 1 {
		alive := options.Alive
		if alive == nil {
			alive = processAlive
		}
		if pending.AttemptPID > 0 && pending.AttemptPID != options.PID && alive(pending.AttemptPID) {
			// The previous start is still coming up, so this launch is a second instance that will forward its arguments and exit.
			return result
		}
		if rollback(options, pending, rest) {
			result.RolledBack = true
		}
		return result
	}
	pending.Attempts++
	pending.AttemptPID = options.PID
	if err := writePending(options.PendingPath, pending); err != nil {
		options.log("update_pending_unwritten", err.Error())
	}
	return result
}

// rollback puts the program that was replaced back under its name and starts it, and reports whether it did. When it cannot, the
// record is dropped and this program runs on: a working new version is better than none.
func rollback(options StartupOptions, pending Pending, arguments []string) bool {
	rename := options.Rename
	if rename == nil {
		rename = os.Rename
	}
	executable := options.Executable
	oldPath, failedPath := executable+oldSuffix, executable+failedSuffix
	giveUp := func(reason string) bool {
		options.log("update_rollback_failed", reason)
		_ = os.Remove(options.PendingPath)
		return false
	}
	if _, err := os.Lstat(oldPath); err != nil {
		return giveUp("the previous version is not there to restore")
	}
	_ = os.Remove(failedPath)
	if err := renameWithRetry(rename, executable, failedPath); err != nil {
		return giveUp("the new version could not be moved aside: " + err.Error())
	}
	if err := renameWithRetry(rename, oldPath, executable); err != nil {
		if backErr := renameWithRetry(rename, failedPath, executable); backErr != nil {
			return giveUp("the previous version could not be put back (" + err.Error() + ") and the new one could not be put back either (" + backErr.Error() + "): rename " + oldPath + " to " + executable)
		}
		return giveUp("the previous version could not be put back: " + err.Error())
	}
	_ = os.Remove(options.PendingPath)
	spawn := options.Spawn
	if spawn == nil {
		spawn = SpawnDetached
	}
	workingDir, _ := os.Getwd()
	if err := spawn(executable, append([]string{relaunchFlag, strconv.Itoa(options.PID)}, arguments...), workingDir); err != nil {
		options.log("update_rollback_failed", "the previous version was restored but could not be started: "+err.Error())
		return false
	}
	options.log("update_rolled_back", "version "+pending.To+" did not start, so version "+pending.From+" was restored")
	return true
}

// Confirm is called once the new version has started far enough to be trusted (its first Bootstrap). It removes the record and the
// program that was replaced, so the next launch is an ordinary one. It does nothing when there is no record for this version.
func Confirm(options StartupOptions) {
	pending, ok := readPending(options.PendingPath)
	if !ok || pending.To != options.Version || !samePath(pending.Executable, options.Executable) {
		return
	}
	_ = os.Remove(options.Executable + oldSuffix)
	_ = os.Remove(options.Executable + failedSuffix)
	_ = os.Remove(options.PendingPath)
	options.log("update_confirmed", "version "+pending.To+" started, replacing version "+pending.From)
}

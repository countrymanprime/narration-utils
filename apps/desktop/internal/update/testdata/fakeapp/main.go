// Command fakeapp stands in for the application in the update tests. It starts the way the real program does (the same Startup, the same
// relaunch arguments), leaves a note of how it started beside its executable, and behaves as mode.txt beside it says:
//
//	linger   run until killed (the program being replaced)
//	confirm  start, confirm the update as the real program does after its first Bootstrap, then run until killed
//	crash    start, and exit at once without confirming (a new version that does not work)
//	quit     start and exit at once, having confirmed
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/update"
)

// version is set with -ldflags "-X main.version=...", as the real program's is.
var version = "0.0.0"

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println(version)
		return
	}
	executable, _ := os.Executable()
	dir := filepath.Dir(executable)
	options := update.StartupOptions{
		Executable: executable, Args: os.Args[1:], PendingPath: os.Getenv("FAKEAPP_PENDING"), Version: version, PID: os.Getpid(),
		Log: func(kind, message string) {
			if f, err := os.OpenFile(filepath.Join(dir, "log.txt"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
				_, _ = fmt.Fprintf(f, "%s %s: %s\n", version, kind, message)
				_ = f.Close()
			}
		},
	}
	result := update.Startup(options)
	if result.RolledBack {
		return
	}
	note, _ := json.Marshal(map[string]any{"version": version, "args": result.Args, "pid": os.Getpid()})
	_ = os.WriteFile(filepath.Join(dir, "started-"+version+".json"), note, 0o600)
	mode, _ := os.ReadFile(filepath.Join(dir, "mode.txt"))
	switch strings.TrimSpace(string(mode)) {
	case "crash":
		os.Exit(3)
	case "quit":
		update.Confirm(options)
		return
	case "confirm":
		update.Confirm(options)
	}
	time.Sleep(10 * time.Minute)
}

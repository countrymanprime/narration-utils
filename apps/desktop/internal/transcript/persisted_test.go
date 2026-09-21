package transcript

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/persist"
)

func TestACorruptLastComparisonIsLoggedAndTreatedAsNone(t *testing.T) {
	service, _ := testService(t)
	var logs []string
	service.SetPersist(&persist.Reporter{Log: func(kind, message string) { logs = append(logs, kind+" "+message) }})
	if err := os.WriteFile(filepath.Join(service.config.Project, ".narration-last-comparison.json"), []byte(`{"rows": [`), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := service.LastCompleted(); got != nil {
		t.Fatalf("LastCompleted = %v, want nil for a file that cannot be read", got)
	}
	if len(logs) != 1 || !strings.Contains(logs[0], ".narration-last-comparison.json") {
		t.Fatalf("logs = %v", logs)
	}
}

package main

import "testing"

func TestServicesReturnsTheServicesTheHostIsUsing(t *testing.T) {
	host := NewHost()
	project := t.TempDir()
	next := host.config
	next.projectFolder, next.projectName, next.daw = project, "Book", "Standalone"
	if attached, reason := host.attachProjectLocked(next); !attached {
		t.Fatalf("attach failed: %s", reason)
	}

	svc := host.services()

	if svc.config != host.config {
		t.Fatalf("config = %#v, want %#v", svc.config, host.config)
	}
	if svc.manuscript != host.manuscript || svc.settings != host.settings || svc.tts != host.tts || svc.whisper != host.whisper {
		t.Fatal("snapshot does not hold the host's current manuscript, settings, tts and whisper services")
	}
	if svc.guide != host.guide || svc.transcript != host.transcript || svc.teleprompter != host.teleprompter {
		t.Fatal("snapshot does not hold the host's current guide, transcript and teleprompter services")
	}
	if svc.guide == nil || svc.transcript == nil || svc.teleprompter == nil {
		t.Fatal("an attached project must have its project-scoped services")
	}
}

// A snapshot is a set of values: a project switch that happens after it was
// taken must not change what the caller is already using, and a fresh call
// must see the new project. That is what keeps one binding call on one project.
func TestServicesSnapshotIsStableAcrossAProjectSwitch(t *testing.T) {
	host := NewHost()
	first := host.config
	first.projectFolder = t.TempDir()
	if attached, reason := host.attachProjectLocked(first); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	before := host.services()

	second := host.config
	second.projectFolder = t.TempDir()
	if attached, reason := host.attachProjectLocked(second); !attached {
		t.Fatalf("attach failed: %s", reason)
	}
	after := host.services()

	if before.guide == after.guide || before.transcript == after.transcript || before.manuscript == after.manuscript {
		t.Fatal("a project switch must build new project-scoped services")
	}
	if before.config.projectFolder != first.projectFolder || after.config.projectFolder != second.projectFolder {
		t.Fatalf("config folders = %q then %q", before.config.projectFolder, after.config.projectFolder)
	}
}

// The snapshot is copy-and-release. Holding h.mu across a service call could
// deadlock behind a queued writer, because the emit callbacks re-enter h.mu.RLock.
func TestServicesReleasesTheHostLockBeforeReturning(t *testing.T) {
	host := NewHost()
	_ = host.services()
	if !host.mu.TryLock() {
		t.Fatal("services() returned while still holding the host lock")
	}
	host.mu.Unlock()
}

func TestServicesOnAnUnconfiguredHostHoldsNoProjectServices(t *testing.T) {
	svc := (&Host{}).services()
	if svc.guide != nil || svc.transcript != nil || svc.teleprompter != nil || svc.tts != nil || svc.whisper != nil || svc.manuscript != nil || svc.settings != nil {
		t.Fatalf("zero host snapshot = %#v, want no services", svc)
	}
}

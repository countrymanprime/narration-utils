package main

import (
	"context"
	"errors"
	"testing"

	"github.com/countrymanprime/narration-utils/shell/internal/dawport"
	"github.com/countrymanprime/narration-utils/shell/internal/teleprompter"
)

type fakePuncherRole struct {
	position dawport.PlayPosition
	err      error
}

func (f fakePuncherRole) PunchTo(context.Context, float64, float64) (float64, error) { return 0, nil }
func (f fakePuncherRole) PlayPosition(context.Context) (dawport.PlayPosition, error) {
	return f.position, f.err
}

func TestPollPunchAnchorRecordsOneAnchorFromThePlayPosition(t *testing.T) {
	project := t.TempDir()
	puncher := fakePuncherRole{position: dawport.PlayPosition{Heard: 12.5}}
	pollPunchAnchor(context.Background(), puncher, project, "c1", 7, nil)

	anchors, err := teleprompter.LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(anchors) != 1 || anchors[0] != (teleprompter.Anchor{Word: 7, Position: 12.5}) {
		t.Fatalf("anchors = %+v", anchors)
	}
}

func TestPollPunchAnchorRecordsNothingWhenPlayPositionFails(t *testing.T) {
	project := t.TempDir()
	puncher := fakePuncherRole{err: errors.New("bridge is down")}
	pollPunchAnchor(context.Background(), puncher, project, "c1", 7, nil)

	anchors, err := teleprompter.LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if anchors != nil {
		t.Fatalf("anchors = %+v, want none", anchors)
	}
}

func TestPollPunchAnchorKeepsPollingAfterAFailure(t *testing.T) {
	project := t.TempDir()
	pollPunchAnchor(context.Background(), fakePuncherRole{err: errors.New("bridge is down")}, project, "c1", 3, nil)
	pollPunchAnchor(context.Background(), fakePuncherRole{position: dawport.PlayPosition{Heard: 2}}, project, "c1", 4, nil)

	anchors, err := teleprompter.LoadAnchors(project, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if len(anchors) != 1 || anchors[0] != (teleprompter.Anchor{Word: 4, Position: 2}) {
		t.Fatalf("anchors = %+v", anchors)
	}
}

// punchAnchorTick must be a safe no-op with nothing configured (no open project, no teleprompter service, no DAW port
// resolver): a bare *Host is what the app looks like before a project is attached.
func TestPunchAnchorTickIsANoOpWithNoProjectConfigured(t *testing.T) {
	host := &Host{}
	host.punchAnchorTick(context.Background())
}

func TestPunchAnchorTickIsANoOpWithNoLiveSessionToAnchor(t *testing.T) {
	project := t.TempDir()
	host := &Host{}
	host.config.projectFolder = project
	host.teleprompter = teleprompter.New(teleprompter.Config{Project: project}, nil, nil, nil)
	host.dawPortResolver = dawport.NewResolver(dawport.ResolverConfig{})

	host.punchAnchorTick(context.Background())

	anchors, err := teleprompter.LoadAnchors(project, "")
	if err != nil {
		t.Fatal(err)
	}
	if anchors != nil {
		t.Fatalf("anchors = %+v, want none: no session was running", anchors)
	}
}

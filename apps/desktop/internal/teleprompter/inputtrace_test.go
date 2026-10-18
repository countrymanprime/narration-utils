package teleprompter

import (
	"encoding/json"
	"testing"
	"time"
)

func TestTraceLineSummarisesWhatTheMicrophoneDeliveredEveryPeriod(t *testing.T) {
	at := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	s := &Service{traceNow: func() time.Time { return at }}
	type line struct {
		event string
		attrs map[string]any
	}
	var got []line
	s.SetTrace(func(event string, attrs ...any) {
		m := map[string]any{}
		for i := 0; i+1 < len(attrs); i += 2 {
			m[attrs[i].(string)] = attrs[i+1]
		}
		got = append(got, line{event, m})
	})
	send := func(kind, body string) { s.traceLine(kind, json.RawMessage(body)) }

	send("level", `{"type":"level","peak":-40,"rms":-50}`)
	send("level", `{"type":"level","peak":-12.34,"rms":-30}`)
	send("word", `{"type":"word"}`)
	send("partial", `{"type":"partial"}`)
	if len(got) != 0 {
		t.Fatalf("summarised before the period ended: %v", got)
	}
	at = at.Add(traceEvery)
	send("level", `{"type":"level","peak":-60,"rms":-70}`)
	if len(got) != 1 || got[0].event != "teleprompter.input" {
		t.Fatalf("got %v, want one teleprompter.input", got)
	}
	a := got[0].attrs
	if a["levels"] != 3 || a["words"] != 1 || a["partials"] != 1 || a["peak_db"] != -12.3 {
		t.Fatalf("summary = %v", a)
	}
}

func TestTraceLineSaysSilenceWhenNoLevelEventArrives(t *testing.T) {
	at := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	s := &Service{traceNow: func() time.Time { return at }}
	var peak any
	s.SetTrace(func(_ string, attrs ...any) { peak = attrs[5] })
	s.traceLine("position", json.RawMessage(`{"type":"position"}`))
	at = at.Add(traceEvery)
	s.traceLine("position", json.RawMessage(`{"type":"position"}`))
	if peak != float64(-120) {
		t.Fatalf("peak_db = %v, want -120 (no sound reached the host)", peak)
	}
}

func TestTraceLineWithoutATraceDoesNothing(t *testing.T) {
	(&Service{}).traceLine("level", json.RawMessage(`{"type":"level","peak":-1}`))
}

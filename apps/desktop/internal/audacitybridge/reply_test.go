package audacitybridge

import (
	"bufio"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestReadReply(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		lines   []string
		ok      bool
		wantErr error
	}{
		{"an OK with no body", "BatchCommand finished: OK\n\n", nil, true, nil},
		{"an OK with a body", "line one\nline two\nBatchCommand finished: OK\n\n", []string{"line one", "line two"}, true, nil},
		{"a Failed! with a reason", "Label 9 does not exist.\nBatchCommand finished: Failed!\n\n", []string{"Label 9 does not exist."}, false, nil},
		{"CRLF line endings", "x\r\nBatchCommand finished: OK\r\n\r\n", []string{"x"}, true, nil},
		{"a body with an empty line inside", "[\n\n]\nBatchCommand finished: OK\n\n", []string{"[", "", "]"}, true, nil},
		{"a bare empty line: no project open", "\n", nil, false, ErrNoProject},
		{"an unknown terminator", "BatchCommand finished: Maybe\n\n", nil, false, ErrProtocol},
		{"a terminator with trailing space", "BatchCommand finished: OK \n\n", nil, false, ErrProtocol},
		{"text instead of the empty line", "BatchCommand finished: OK\nstray\n", nil, false, ErrProtocol},
		{"the pipe closes before the terminator", "partial\n", nil, false, ErrProtocol},
		{"the pipe closes before the empty line", "BatchCommand finished: OK\n", nil, false, ErrProtocol},
		{"the pipe closes mid-line", "partial", nil, false, ErrProtocol},
		{"a NUL in the answer", "a\x00b\nBatchCommand finished: OK\n\n", nil, false, ErrProtocol},
		{"a line past the limit", strings.Repeat("a", maxReplyLineBytes+10) + "\nBatchCommand finished: OK\n\n", nil, false, ErrProtocol},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reply, ok, err := readReply(bufio.NewReaderSize(strings.NewReader(tc.in), 16))
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if ok != tc.ok || !reflect.DeepEqual(reply.Lines, tc.lines) {
				t.Errorf("got %q ok=%v, want %q ok=%v", reply.Lines, ok, tc.lines, tc.ok)
			}
		})
	}
}

func TestReadReplyRefusesAnEndlessAnswer(t *testing.T) {
	in := strings.Repeat(strings.Repeat("a", 1000)+"\n", maxReplyBytes/1000+2)
	_, _, err := readReply(bufio.NewReader(strings.NewReader(in)))
	if !errors.Is(err, ErrProtocol) {
		t.Fatalf("err = %v, want ErrProtocol", err)
	}
}

// Two replies back to back are read one at a time: the framing never lets one command's answer bleed into the next.
func TestReadReplyStopsAtItsOwnEmptyLine(t *testing.T) {
	r := bufio.NewReader(strings.NewReader("a\nBatchCommand finished: OK\n\nb\nBatchCommand finished: Failed!\n\n"))
	first, ok, err := readReply(r)
	if err != nil || !ok || !reflect.DeepEqual(first.Lines, []string{"a"}) {
		t.Fatalf("first = %q %v %v", first.Lines, ok, err)
	}
	second, ok, err := readReply(r)
	if err != nil || ok || !reflect.DeepEqual(second.Lines, []string{"b"}) {
		t.Fatalf("second = %q %v %v", second.Lines, ok, err)
	}
}

func TestRepairJSON(t *testing.T) {
	cases := []struct{ in, want string }{
		{`["plain"]`, `["plain"]`},
		{`["a \"quoted\" word"]`, `["a \"quoted\" word"]`},
		{`["C:\narration\take"]`, `["C:\narration\take"]`}, // \n and \t look like escapes: ambiguous, kept (the spec note)
		{`["back\slash"]`, `["back\\slash"]`},
		{"[\"tab\there\"]", `["tab\u0009here"]`},
		{`["\u00e9 ok"]`, `["\u00e9 ok"]`},
		{`["\u00zz"]`, `["\\u00zz"]`},
		{`["trailing\"]`, `["trailing\"]`},
		{`[1, 2.5, true]`, `[1, 2.5, true]`},
	}
	for _, tc := range cases {
		if got := string(repairJSON([]byte(tc.in))); got != tc.want {
			t.Errorf("repairJSON(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func lines(s string) Reply { return Reply{Lines: strings.Split(s, "\n")} }

func TestParseLabels(t *testing.T) {
	got, err := parseLabels(lines(`[
 [ 1,
  [
   [ 1.5, 1.5, "nu:f1 misread" ],
   [ 3, 4.25, "hand-typed C:\notes" ]
  ]
 ],
 [ 3, [ [ 0, 0, "" ] ] ]
]`))
	if err != nil {
		t.Fatal(err)
	}
	want := []LabelInfo{
		{Index: 0, Track: 1, Start: 1.5, End: 1.5, Text: "nu:f1 misread"},
		{Index: 1, Track: 1, Start: 3, End: 4.25, Text: `hand-typed C:` + "\n" + `otes`},
		{Index: 2, Track: 3, Start: 0, End: 0, Text: ""},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

func TestParseLabelsIsStrict(t *testing.T) {
	bad := []string{
		`{}`, `[[1]]`, `[[1, [[1, 2]]]]`, `[[1, [[1, 2, "a", 4]]]]`, `[["x", []]]`, `[[1.5, []]]`, `[[-1, []]]`,
		`[[1, [[2, 1, "ends before it starts"]]]]`, `[[1, [["a", 2, "x"]]]]`, `[[1, [[1, 2, 3]]]]`, `not json`,
	}
	for _, in := range bad {
		if _, err := parseLabels(lines(in)); !errors.Is(err, ErrProtocol) {
			t.Errorf("parseLabels(%s) err = %v, want ErrProtocol", in, err)
		}
	}
	if got, err := parseLabels(lines(`[]`)); err != nil || len(got) != 0 {
		t.Errorf("no label tracks = %v, %v", got, err)
	}
}

func TestParseTracks(t *testing.T) {
	got, err := parseTracks(lines(`[ { "name":"Chapter 1", "focused":"true", "selected":"false", "kind":"wave", "start":0, "end":12.5,
 "pan":0, "volume":1, "channels":1, "solo":"false", "mute":"false" },
 { "name":"Narration Utils", "focused":0, "selected":1, "kind":"label" } ]`))
	if err != nil {
		t.Fatal(err)
	}
	want := []TrackInfo{
		{Index: 0, Name: "Chapter 1", Kind: "wave", Focused: true, Start: 0, End: 12.5, Channels: 1, HasRange: true},
		{Index: 1, Name: "Narration Utils", Kind: "label", Selected: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	for _, in := range []string{`[{"kind":"wave"}]`, `[{"name":"x"}]`, `[{"name":"x","kind":"wave","selected":"maybe"}]`, `[{"name":"x","kind":"wave","start":"NaN","end":1}]`} {
		if _, err := parseTracks(lines(in)); !errors.Is(err, ErrProtocol) {
			t.Errorf("parseTracks(%s) err = %v, want ErrProtocol", in, err)
		}
	}
}

func TestParseClips(t *testing.T) {
	got, err := parseClips(lines(`[ { "track":0, "start":0, "end":1.25, "color":0, "name":"take 1" } ]`))
	if err != nil || !reflect.DeepEqual(got, []ClipInfo{{Track: 0, Start: 0, End: 1.25, Name: "take 1"}}) {
		t.Fatalf("got %+v, %v", got, err)
	}
	if _, err := parseClips(lines(`[ { "start":0, "end":1 } ]`)); !errors.Is(err, ErrProtocol) {
		t.Errorf("a clip with no track: err = %v, want ErrProtocol", err)
	}
}

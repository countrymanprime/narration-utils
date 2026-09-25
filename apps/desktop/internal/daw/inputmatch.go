package daw

import (
	"strings"
	"unicode"
)

// Which microphone REAPER uses (teleprompter-manuscript-integration PRD Phase 11, ADR 0250). REAPER names its open input
// device by its driver (GetAudioDeviceInfo("IDENT_IN"): "Focusrite USB ASIO" under ASIO, the Windows name under WASAPI);
// the teleprompter opens microphones by their dshow names ("Microphone (Focusrite USB Audio)"). MatchInputDevice says
// which dshow name is REAPER's device only when it can be sure, so the UI preselects it with a reason and otherwise
// leaves the full list as it is.

// The outcomes of MatchInputDevice.
const (
	InputMatched   = "matched"   // one device is REAPER's
	InputUncertain = "uncertain" // several devices fit equally well (two inputs of one interface)
	InputNoMatch   = "no_match"  // none fits, or REAPER named no device
)

// InputMatch is MatchInputDevice's answer: Device is set only when Status is matched, Candidates only when uncertain.
type InputMatch struct {
	Status     string
	Device     string
	Candidates []string
}

// inputMatchShare is how many of the REAPER name's distinctive words a device name must share to count: more than half.
const inputMatchShare = 0.5

// genericInputWords say what kind of device or driver it is, not which one, so they never make a match.
var genericInputWords = map[string]bool{
	"asio": true, "wasapi": true, "wdm": true, "ks": true, "mme": true, "driver": true, "usb": true, "audio": true, "device": true,
	"microphone": true, "mic": true, "array": true, "input": true, "inputs": true, "line": true, "in": true, "interface": true,
	"the": true, "of": true, "and": true, "r": true, "tm": true,
}

// inputWords are a name's distinctive words: lower-case letter-and-digit runs, without the generic words and without a
// lone digit (Windows numbers duplicate devices "2- Shure MV7").
func inputWords(name string) map[string]bool {
	words := map[string]bool{}
	for _, word := range strings.FieldsFunc(strings.ToLower(name), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
		if genericInputWords[word] || (len(word) == 1 && unicode.IsDigit(rune(word[0]))) {
			continue
		}
		words[word] = true
	}
	return words
}

// MatchInputDevice finds REAPER's input device among devices: the same name (case and spacing aside), or else the one
// device that shares more than half of the REAPER name's distinctive words and shares more of them than any other. A tie
// is uncertain, and a device list with no such device, or a REAPER that names no device, is no match.
func MatchInputDevice(reaper string, devices []string) InputMatch {
	wanted := strings.Join(strings.Fields(strings.ToLower(reaper)), " ")
	if wanted == "" {
		return InputMatch{Status: InputNoMatch}
	}
	for _, device := range devices {
		if strings.Join(strings.Fields(strings.ToLower(device)), " ") == wanted {
			return InputMatch{Status: InputMatched, Device: device}
		}
	}
	reaperWords := inputWords(reaper)
	if len(reaperWords) == 0 {
		return InputMatch{Status: InputNoMatch}
	}
	best, bestShare := []string(nil), 0.0
	for _, device := range devices {
		shared := 0
		for word := range inputWords(device) {
			if reaperWords[word] {
				shared++
			}
		}
		share := float64(shared) / float64(len(reaperWords))
		switch {
		case share <= inputMatchShare || share < bestShare:
		case share > bestShare:
			best, bestShare = []string{device}, share
		default:
			best = append(best, device)
		}
	}
	switch len(best) {
	case 0:
		return InputMatch{Status: InputNoMatch}
	case 1:
		return InputMatch{Status: InputMatched, Device: best[0]}
	}
	return InputMatch{Status: InputUncertain, Candidates: best}
}

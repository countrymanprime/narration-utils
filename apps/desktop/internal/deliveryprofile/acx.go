package deliveryprofile

// The built-in ACX profile (docs/research/acx-delivery-requirements.md, Phase 0 of the PRD). Every rule cites ACX's
// Audio Submission Requirements page. The help site cannot be reached from the sessions that wrote this, so a rule is
// "verified" only where the repository recorded a reading of ACX's own page, and its requirement is a paraphrase
// (Quoted false) unless that reading kept ACX's words; everything else is "to verify" with what is left to check.
// A new reading of ACX's page is a new version (a new function and ID version), never an edit of this one, so a
// project keeps judging against the version it chose (PRD P5).

// ACXID is the built-in ACX profile's id; findings carry it, not the version, so a finding keeps its ID across versions.
const ACXID = "acx"

// ACXVersion is the version of the ACX profile this build ships: the month ACX's page was read.
const ACXVersion = "2026-09"

const (
	acxTitle = "ACX Audio Submission Requirements"
	acxURL   = "https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements"
	// acxReadOn is the repository's recorded reading of ACX's page (audiobook-credits-templates.prd.md, Evidence).
	acxReadOn = "2026-09-20"
	// acxLevelsReadOn is when docs/research/reaper-automation-surface.md recorded ACX's level and format numbers from
	// the same page.
	acxLevelsReadOn = "2026-09-23"
)

func number(v float64) *float64 { return &v }

func acxSource(requirement, readOn string, quoted bool) Source {
	return Source{Title: acxTitle, URL: acxURL, Requirement: requirement, Quoted: quoted, ReadOn: readOn}
}

// ACX answers the built-in ACX profile, a fresh copy each call.
func ACX() Profile {
	return Profile{
		ID: ACXID, Version: ACXVersion, Name: "ACX", Platform: "ACX", BuiltIn: true,
		Source: Source{Title: acxTitle, URL: acxURL, ReadOn: acxReadOn},
		Rules: []Rule{
			{
				ID: "acx.rms", Label: "RMS", Scope: ScopeFile, Metric: "rms_dbfs", Unit: "dBFS", Min: number(-23), Max: number(-18),
				Level: LevelRequired, CheckedBy: CheckedMeasured,
				Source:       acxSource("Each file measures between -23 dB and -18 dB RMS.", acxLevelsReadOn, false),
				Verification: ToVerify,
				VerificationNote: "RMS definition to compare with ACX Check: the app measures the whole file, silences included, " +
					"over every channel.",
			},
			{
				ID: "acx.peak", Label: "Peak", Scope: ScopeFile, Metric: "sample_peak_dbfs", Unit: "dBFS", Max: number(-3),
				Advice: &Advice{Metric: "true_peak_dbtp", Max: -3, Unit: "dBTP", Text: "true peak above −3 dBTP may clip after MP3 encoding"},
				Level:  LevelRequired, CheckedBy: CheckedMeasured,
				Source:           acxSource("Each file has peak values no higher than -3 dB.", acxLevelsReadOn, false),
				Verification:     ToVerify,
				VerificationNote: "Sample or true peak to confirm: the app judges the sample peak and shows the true peak as advice.",
			},
			{
				ID: "acx.noise_floor", Label: "Noise floor", Scope: ScopeFile, Metric: "noise_floor_dbfs", Unit: "dBFS", Max: number(-60),
				Level: LevelRequired, CheckedBy: CheckedMeasured,
				Source:           acxSource("Each file has a noise floor no higher than -60 dB RMS.", acxLevelsReadOn, false),
				Verification:     ToVerify,
				VerificationNote: "Window definition to compare with ACX Check: the app takes the quietest 0.5 s that is not digital silence.",
			},
			{
				ID: "acx.sample_rate", Label: "Sample rate", Scope: ScopeFile, Metric: "sample_rate", Unit: "Hz", OneOf: []float64{44100},
				Level: LevelRequired, CheckedBy: CheckedMeasured,
				Source:       acxSource("Each file is sampled at 44.1 kHz.", acxLevelsReadOn, false),
				Verification: Verified,
			},
			{
				ID: "acx.file_length", Label: "File length", Scope: ScopeFile, Metric: "duration_seconds", Unit: "s", Max: number(7200),
				Level: LevelRequired, CheckedBy: CheckedMeasured,
				Source:       acxSource("Each file is no longer than 120 minutes.", acxReadOn, false),
				Verification: Verified,
			},
			{
				ID: "acx.room_tone_head", Label: "Room tone, head", Scope: ScopeFile, Metric: "head_room_tone_seconds", Unit: "s",
				Min: number(0.5), Max: number(5), Level: LevelRequired, CheckedBy: CheckedMeasured,
				Advice: &Advice{Metric: "head_digital_silence_seconds", Max: 0, Unit: "s",
					Text: "the head holds digital silence (exact zeros): ACX asks for room tone, not silence"},
				Source:       acxSource("1 to 5 seconds of room tone at the beginning of each file.", acxReadOn, false),
				Verification: Conflicting,
				VerificationNote: "ACX's page was read as 1 to 5 s; current guides say 0.5 to 1 s. Judged 0.5 to 5 s (the looser " +
					"reading) until the owner reads ACX's page.",
			},
			{
				ID: "acx.room_tone_tail", Label: "Room tone, tail", Scope: ScopeFile, Metric: "tail_room_tone_seconds", Unit: "s",
				Min: number(1), Max: number(5), Level: LevelRequired, CheckedBy: CheckedMeasured,
				Advice: &Advice{Metric: "tail_digital_silence_seconds", Max: 0, Unit: "s",
					Text: "the tail holds digital silence (exact zeros): ACX asks for room tone, not silence"},
				Source:       acxSource("1 to 5 seconds of room tone at the end of each file.", acxReadOn, false),
				Verification: Verified,
			},
			{
				ID: "acx.format", Label: "MP3 format", Scope: ScopeFile, Metric: "mp3_format", Unit: "kbps", Min: number(192),
				BoundText: "192 kbps+ CBR", Level: LevelRequired, CheckedBy: CheckedMeasured,
				Source:       acxSource("Each file is an MP3 at 192 kbps or higher, constant bit rate (CBR).", acxLevelsReadOn, false),
				Verification: Verified,
			},
			{
				ID: "acx.channels", Label: "Channels", Scope: ScopeBook, Metric: "channels", Unit: "", OneOf: []float64{1, 2},
				SameAcrossFiles: true, Level: LevelRequired, CheckedBy: CheckedMeasured,
				Source:           acxSource("Every file is mono or stereo, the same in every file.", acxReadOn, false),
				Verification:     ToVerify,
				VerificationNote: "The same-in-every-file wording and any mono preference are to read on ACX's page.",
			},
			{
				ID: "acx.one_section_per_file", Label: "One section per file", Scope: ScopeBook, Metric: "one_section_per_file",
				Level: LevelRequired, CheckedBy: CheckedListen,
				NotCheckedWhy: "Listen: each file holds one chapter or section and starts with its section header.",
				Source:        acxSource("Each file holds one chapter or section and starts with a section header.", acxReadOn, false),
				Verification:  Verified,
			},
			{
				ID: "acx.credits", Label: "Credits files", Scope: ScopeBook, Metric: "credits_files", Level: LevelRequired,
				CheckedBy: CheckedNotYet, NotCheckedWhy: "Not checked by the app yet: the book checklist comes later.",
				Source:       acxSource("Opening and closing credits should be separate files", acxReadOn, true),
				Verification: Verified,
			},
			{
				ID: "acx.retail_sample", Label: "Retail sample", Scope: ScopeBook, Metric: "retail_sample_seconds", Unit: "s",
				Max: number(300), Level: LevelRequired, CheckedBy: CheckedNotYet,
				NotCheckedWhy:    "Not checked by the app yet: the book checklist comes later.",
				Source:           acxSource("A retail audio sample of 5 minutes or less.", acxReadOn, false),
				Verification:     Verified,
				VerificationNote: "Some guides also give a 1 minute minimum; to read on ACX's page.",
			},
			{
				ID: "acx.consistency", Label: "Consistency", Scope: ScopeBook, Metric: "consistency", Level: LevelRequired,
				CheckedBy: CheckedListen, NotCheckedWhy: "Listen: consistent sound and levels across files, no extraneous sounds.",
				Source:           acxSource("Consistent in overall sound and formatting, free of extraneous sounds.", acxReadOn, false),
				Verification:     ToVerify,
				VerificationNote: "Recorded from guides; ACX's own wording is to read on its page.",
			},
		},
	}
}

// BuiltIns lists every built-in profile, newest version of each first.
func BuiltIns() []Profile {
	return []Profile{ACX()}
}

// BuiltIn finds a built-in by id and version; an empty version answers the newest.
func BuiltIn(ref Ref) (Profile, bool) {
	for _, profile := range BuiltIns() {
		if profile.ID == ref.ID && (ref.Version == "" || profile.Version == ref.Version) {
			return profile, true
		}
	}
	return Profile{}, false
}

// Default is the profile a project judges against when nothing is chosen (PRD P7): the newest ACX.
func Default() Profile {
	return ACX()
}

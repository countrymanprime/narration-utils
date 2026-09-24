package credits

// Status is a credits row's production stage, stored on the project manifest (Credits in the Chapter Table PRD, CT2/CT3):
// the same five values ManuscriptSetChapterStatus accepts (apps/desktop/internal/manuscript/reader.go's
// validChapterStatus), so the select and colours the chapter table already has can be reused as-is for a credits row.
type Status = string

const (
	StatusNotStarted Status = "not_started"
	StatusRecording  Status = "recording"
	StatusEditing    Status = "editing"
	StatusProofing   Status = "proofing"
	StatusFinalized  Status = "finalized"
)

// ValidStatus reports whether value is one of the five statuses above.
func ValidStatus(value string) bool {
	switch value {
	case StatusNotStarted, StatusRecording, StatusEditing, StatusProofing, StatusFinalized:
		return true
	}
	return false
}

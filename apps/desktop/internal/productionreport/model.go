package productionreport

// notice is the report's first words: what it is, and what it is not (mirrors internal/deliveryreport's own framing).
const notice = "A summary of this book's logged time, pace and readiness, made on the narrator's computer from the same figures the " +
	"Production page shows. It is not an invoice or a certification: the PFH and rate come only from hours the narrator logged and " +
	"audio the app measured, never an estimate presented as a fact, and a figure with no honest input is written as \"not available\"."

// Report is the whole exported report; JSON and HTML are two renderings of it.
type Report struct {
	SchemaVersion int         `json:"schema_version"`
	GeneratedAt   string      `json:"generated_at"`
	App           App         `json:"app"`
	Notice        string      `json:"notice"`
	Book          BookSummary `json:"book"`
	Deadline      *Deadline   `json:"deadline"`
	Milestones    []Milestone `json:"milestones"`
	Readiness     Readiness   `json:"readiness"`
	Rate          RateInfo    `json:"rate"`
	Privacy       Privacy     `json:"privacy"`
}

type App struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// BookSummary is the book-wide figures the KPI row shows, minus the plan (Deadline, Milestones, RateInfo cover that):
// every figure is measured or logged, never estimated. A nil BookPFH is undefined, written as "not available".
type BookSummary struct {
	Chapters          int                `json:"chapters"`
	FinalizedChapters int                `json:"finalized_chapters"`
	WordCount         int                `json:"word_count"`
	RecordedSeconds   float64            `json:"recorded_seconds"`
	MeasuredChapters  int                `json:"measured_chapters"`
	HoursLogged       float64            `json:"hours_logged"`
	HoursByStage      map[string]float64 `json:"hours_by_stage"`
	BookPFH           *float64           `json:"book_pfh"`
}

// Deadline is the book's due date and the whole days left as of GeneratedAt, negative once it has passed.
type Deadline struct {
	Date     string `json:"date"`
	DaysLeft int    `json:"days_left"`
}

// Milestone is one dated checkpoint as of GeneratedAt: DaysLeft is negative, and Overdue true, once its date has passed.
type Milestone struct {
	Name     string `json:"name"`
	DueDate  string `json:"due_date"`
	Note     string `json:"note,omitempty"`
	DaysLeft int    `json:"days_left"`
	Overdue  bool   `json:"overdue"`
}

// Readiness counts every chapter by its current-stage verdict (never recomputed here, read as the stage
// recommendations gave it): recommended, not_ready, unknown, dismissed, or none for a chapter not assessed.
type Readiness struct {
	Recommended int `json:"recommended"`
	NotReady    int `json:"not_ready"`
	Unknown     int `json:"unknown"`
	Dismissed   int `json:"dismissed"`
	None        int `json:"none"`
}

// RateInfo is the book's contracted amount and effective rate. Both are nil, and Note says why, unless the narrator
// opted in (Options.IncludeContractedAmount): financial figures are the one thing this report does not write by
// default, since a status report is often shared with someone the narrator would not otherwise tell their rate.
type RateInfo struct {
	ContractedAmount *float64 `json:"contracted_amount"`
	EffectiveRate    *float64 `json:"effective_rate"`
	Note             string   `json:"note"`
}

type Privacy struct {
	ContractedAmountIncluded bool   `json:"contracted_amount_included"`
	Note                     string `json:"note"`
}

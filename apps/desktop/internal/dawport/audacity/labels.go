package audacity

import (
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"github.com/countrymanprime/narration-utils/shell/internal/audacitybridge"
)

// A finding's identity lives in its label's text (audacity-integration PRD Question 4, ADR 0355 point 5): `[nu:<id>] <words>`, or
// `[nu:<id> reviewed] <words>` once the narrator has reviewed it. Labels are matched by that identity, never by time: GetInfo
// reports times to about six significant digits, and the narrator may move a label.
const (
	identityPrefix = "[nu:"
	reviewedSuffix = " reviewed"
	// maxLabelBytes keeps a label short enough to read in Audacity's label track and well inside one command.
	maxLabelBytes = 200
	// LabelTrackName is the label track the adapter adds its labels to, creating it when the project has none.
	LabelTrackName = "Narration Utils"
)

// validID is a finding ID the adapter will put in a label: the findings contract's IDs are short ASCII tokens, so anything else is
// refused rather than sanitized into another finding's identity.
var validID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

var labelIdentity = regexp.MustCompile(`^\[nu:([A-Za-z0-9][A-Za-z0-9._-]{0,63})( reviewed)?\](?: (.*))?$`)

// FindingLabelText is the label text for a finding: its identity, whether it is reviewed, then its words, made safe for a scripting
// command and cut to fit.
func FindingLabelText(id string, reviewed bool, words string) (string, error) {
	if !validID.MatchString(id) {
		return "", fmt.Errorf("%w: finding id %q", audacitybridge.ErrInvalidValue, id)
	}
	head := identityPrefix + id
	if reviewed {
		head += reviewedSuffix
	}
	head += "]"
	words = strings.Join(strings.Fields(audacitybridge.SanitizeText(words, 0)), " ")
	if words == "" {
		return head, nil
	}
	return audacitybridge.SanitizeText(head+" "+words, maxLabelBytes), nil
}

// ParseFindingLabel reads the identity back from a label's text. ok is false for a label the adapter did not write (the narrator's
// own labels), which the adapter never changes.
func ParseFindingLabel(text string) (id string, reviewed bool, words string, ok bool) {
	m := labelIdentity.FindStringSubmatch(text)
	if m == nil {
		return "", false, "", false
	}
	return m[1], m[2] != "", m[3], true
}

// WriteLabelFile writes labels in Audacity's own label-file format (File > Export > Export Labels): one label per line, start, end
// and text separated by tabs, times in seconds with six decimals. The narrator can import it into any Audacity with File > Import
// > Labels. A tab or line break in the text becomes a space.
func WriteLabelFile(w io.Writer, labels []audacitybridge.LabelInfo) error {
	clean := strings.NewReplacer("\t", " ", "\r", " ", "\n", " ")
	for _, l := range labels {
		line := strconv.FormatFloat(l.Start, 'f', 6, 64) + "\t" + strconv.FormatFloat(l.End, 'f', 6, 64) + "\t" + clean.Replace(l.Text) + "\n"
		if _, err := io.WriteString(w, line); err != nil {
			return err
		}
	}
	return nil
}

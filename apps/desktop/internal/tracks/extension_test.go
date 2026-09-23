package tracks

import "testing"

func TestExtensionDataOnANilChunkReturnsNil(t *testing.T) {
	if got := extensionData(nil); got != nil {
		t.Fatalf("extensionData(nil) = %#v, want nil", got)
	}
}

func TestExtensionDataOnAnEmptyChunkReturnsNil(t *testing.T) {
	empty := &node{attrs: map[string][]string{}}
	if got := extensionData(empty); got != nil {
		t.Fatalf("extensionData(empty) = %#v, want nil", got)
	}
}

func TestDecodeBinFallsBackToRawTextOnInvalidBase64(t *testing.T) {
	bin := &node{
		tag:    "BIN",
		params: []string{"some_key"},
		attrs:  map[string][]string{},
		sequence: []seqEntry{
			{key: "not-valid-base64!!!"},
		},
	}
	if got := decodeBin(bin); got != "not-valid-base64!!!" {
		t.Fatalf("decodeBin with invalid base64 = %q, want the raw text back", got)
	}
}

func TestItemActiveOnAnItemWithNoTakesReturnsTheZeroTake(t *testing.T) {
	item := Item{}
	if got := item.Active(); got.Name != "" || got.GUID != "" || got.Ext != nil {
		t.Fatalf("Active() on an item with no takes = %#v, want the zero Take", got)
	}
	item = Item{ActiveTake: 5, Takes: []Take{{Name: "only take"}}}
	if got := item.Active(); got.Name != "" {
		t.Fatalf("Active() with an out-of-range ActiveTake = %#v, want the zero Take", got)
	}
}

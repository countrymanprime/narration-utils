package assets

import (
	"os"
	"path/filepath"
	"testing"
)

// The catalog of Whisper models lists five sizes; listing them used to read every installed byte (5.3 GB for all five). This measures the
// listing with the manifest against reading everything, at the real sizes:
//
//	go test ./internal/assets -run '^$' -bench State -benchtime 3x
//
// The files are created by extending them (nothing is written), so the disk is not filled, and the hash is deliberately wrong: hashing reads
// every byte before it can say so, which is the cost being measured.
var whisperSizes = []int64{75_538_270, 145_217_532, 483_546_902, 1_528_000_000, 3_087_284_237}

func benchAssets(b *testing.B) (root string, all [][]File) {
	b.Helper()
	root = b.TempDir()
	for index, size := range whisperSizes {
		id := string(rune('a' + index))
		files := []File{{Name: "model.bin", URL: "https://example.invalid/model.bin", SHA256: "00", Size: size}}
		dir := Dir(root, "p", id, "1")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		file, err := os.Create(filepath.Join(dir, "model.bin"))
		if err != nil {
			b.Fatal(err)
		}
		if err := file.Truncate(size); err != nil {
			b.Fatal(err)
		}
		_ = file.Close()
		manifest, err := manifestFor(dir, "p", id, "1", files, nil)
		if err != nil {
			b.Fatal(err)
		}
		if err := writeManifest(dir, manifest); err != nil {
			b.Fatal(err)
		}
		all = append(all, files)
	}
	return root, all
}

func BenchmarkStateWithTheManifest(b *testing.B) {
	root, all := benchAssets(b)
	b.ResetTimer()
	for range b.N {
		for index, files := range all {
			if State(root, "p", string(rune('a'+index)), "1", files) != "installed" {
				b.Fatal("the manifest should vouch for every file")
			}
		}
	}
}

func BenchmarkStateByReadingEveryFile(b *testing.B) {
	root, all := benchAssets(b)
	b.ResetTimer()
	for range b.N {
		for index, files := range all {
			_ = hashState(Dir(root, "p", string(rune('a'+index)), "1"), files)
		}
	}
}

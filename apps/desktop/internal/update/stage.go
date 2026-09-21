package update

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/countrymanprime/narration-utils/shell/internal/assets"
)

// Phase is where an update download is: the words the UI polls for.
type Phase string

const (
	// PhaseDownloading is the file arriving; Done and Total are real bytes.
	PhaseDownloading Phase = "downloading"
	// PhaseVerifying is the SHA-256 of the whole file being checked against the release's checksum.
	PhaseVerifying Phase = "verifying"
	// PhaseUnpacking is the program being taken out of the zip.
	PhaseUnpacking Phase = "unpacking"
)

// Progress is one step of staging. Done and Total are bytes of the download while it runs; Percent is only ever real bytes over
// total bytes (ADR 0015), never an estimate.
type Progress struct {
	Phase Phase
	Done  int64
	Total int64
}

// Percent is Done over Total as a whole number, held between 0 and 100.
func (p Progress) Percent() int {
	if p.Total <= 0 || p.Done <= 0 {
		return 0
	}
	if p.Done >= p.Total {
		return 100
	}
	return int(p.Done * 100 / p.Total)
}

const (
	// windowsExecutable is the one file the Windows release zip holds (scripts/release/assets.mjs).
	windowsExecutable = "narration-utils.exe"
	// stagedProvider is the folder under the update root that holds one directory per platform and version.
	stagedProvider = "app-update"
	stagedRecord   = "staged.json"
	// defaultMaxExecutableBytes bounds what a zip may claim to unpack to: the program is about 420 MB.
	defaultMaxExecutableBytes = 1536 << 20
	// downloadHeadroom is what is kept free beyond the files themselves.
	downloadHeadroom = 64 << 20
	// unpackFactor is how many times the zip's size the unpacked program is assumed to be when the disk is checked before the download;
	// the exact size is checked again before anything is unpacked.
	unpackFactor = 3
	maxRedirects = 5
)

// userError is an error whose text is a sentence for the narrator, so it reads as one (capitalised, ending in a full stop) and is
// shown as it is.
type userError string

func (e userError) Error() string { return string(e) }

// UserError is an error whose text is a sentence for the narrator (capitalised, ending in a full stop); the host uses it for what a
// binding refuses, so it reads as one and is shown as it is.
func UserError(sentence string) error { return userError(sentence) }

// UserMessage is what a narrator reads when staging or installing failed: the sentence of an error written for them, or the fallback
// line for anything else (a network error's text names addresses and is for the log, not for them).
func UserMessage(err error, fallback string) string {
	var sentence userError
	if errors.As(err, &sentence) {
		return string(sentence)
	}
	return fallback
}

// Staged is an update that is downloaded, verified against its checksum and unpacked, ready to be installed.
type Staged struct {
	Release Release
	// Dir holds the zip, the unpacked program and the record of what was checked.
	Dir string
	// Executable is the program taken out of the zip.
	Executable       string
	ExecutableSize   int64
	ExecutableSHA256 string
	// ZipSHA256 is the checksum of the zip the program came out of, as the release published it when it was staged.
	ZipSHA256 string
}

type stagedFile struct {
	Tag              string `json:"tag"`
	ExecutableSize   int64  `json:"executableSize"`
	ExecutableSHA256 string `json:"executableSha256"`
	ZipSHA256        string `json:"zipSha256"`
}

// Stager downloads a release into a per-user cache folder, checks it and takes the program out. Nothing here touches the running
// program or anything outside Root.
type Stager struct {
	// Root is the per-user cache folder for updates (never a project folder, never the install folder).
	Root     string
	Platform Platform
	// Client makes the requests; NewDownloadClient has the redirect policy a real download needs.
	Client *http.Client
	// Free reports the free bytes on the disk that holds a path; FreeBytes when nil.
	Free func(path string) (uint64, error)
	// MaxExecutableBytes bounds what the zip may claim to unpack to; a default when zero.
	MaxExecutableBytes int64
}

func (s *Stager) free(path string) (uint64, error) {
	if s.Free != nil {
		return s.Free(path)
	}
	return FreeBytes(path)
}

func (s *Stager) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return NewDownloadClient()
}

func (s *Stager) maxExecutable() int64 {
	if s.MaxExecutableBytes > 0 {
		return s.MaxExecutableBytes
	}
	return defaultMaxExecutableBytes
}

func (s *Stager) platformDir() string { return filepath.Join(s.Root, stagedProvider, s.Platform.Key) }

func (s *Stager) dirFor(release Release) string {
	return assets.Dir(s.Root, stagedProvider, s.Platform.Key, release.Version.String())
}

// Staged reports whether the release is already staged: its program is where the record says and has the size the record says. It
// reads a few bytes and hashes nothing; the installer hashes the program again, while it copies it, against the record's hash before
// it swaps it in. That reference is the record's own, so it guards against damage and a swapped file, not against someone who can
// rewrite the whole cache folder as this user.
func (s *Stager) Staged(release Release) (Staged, bool) {
	dir := s.dirFor(release)
	bytes, err := os.ReadFile(filepath.Join(dir, stagedRecord))
	if err != nil {
		return Staged{}, false
	}
	var record stagedFile
	if json.Unmarshal(bytes, &record) != nil || record.Tag != release.Tag || record.ExecutableSHA256 == "" || record.ZipSHA256 == "" ||
		!validHexDigest(record.ExecutableSHA256) || !validHexDigest(record.ZipSHA256) {
		return Staged{}, false
	}
	executable := filepath.Join(dir, windowsExecutable)
	// Lstat: a link to a program elsewhere is not the staged program.
	info, err := os.Lstat(executable)
	if err != nil || !info.Mode().IsRegular() || info.Size() != record.ExecutableSize || record.ExecutableSize <= 0 {
		return Staged{}, false
	}
	return Staged{Release: release, Dir: dir, Executable: executable, ExecutableSize: record.ExecutableSize, ExecutableSHA256: record.ExecutableSHA256, ZipSHA256: record.ZipSHA256}, true
}

// Stage brings the release's program into the cache: the checksum first (a few bytes), then the zip with real byte progress, its
// SHA-256 against that checksum, then the one program out of the zip. It is safe to call again after a failure or a cancel: what is
// already verified is kept and only the rest is fetched. A failure leaves no unverified file where the installer would look.
func (s *Stager) Stage(ctx context.Context, release Release, onProgress func(Progress)) (Staged, error) {
	if !s.Platform.SelfReplace {
		return Staged{}, errors.New("this platform does not update itself")
	}
	if release.Asset.Size <= 0 || release.Asset.Size > MaxAssetBytes {
		return Staged{}, userError("The update's size is not one a release has, so it was not used.")
	}
	report := func(progress Progress) {
		if onProgress != nil {
			onProgress(progress)
		}
	}
	checksum, err := s.fetchChecksum(ctx, release)
	if err != nil {
		return Staged{}, err
	}
	// A program staged earlier is reused only if the release still publishes the checksum it was staged from: a release re-uploaded
	// under the same tag is downloaded again.
	if staged, ok := s.Staged(release); ok && staged.ZipSHA256 == checksum {
		s.clean(release)
		return staged, nil
	}
	file := assets.File{Name: release.Asset.Name, URL: release.Asset.URL, SHA256: checksum, Size: release.Asset.Size}
	verifying := false
	err = assets.InstallWith(ctx, s.Root, stagedProvider, s.Platform.Key, release.Version.String(), []assets.File{file}, assets.Options{
		Client: s.client(),
		OnProgress: func(_ assets.File, done int64) {
			// One byte past the declared size is read on purpose (to see a longer body); it is not progress.
			report(Progress{Phase: PhaseDownloading, Done: min(done, file.Size), Total: file.Size})
			if done >= file.Size && !verifying {
				verifying = true
				report(Progress{Phase: PhaseVerifying, Done: file.Size, Total: file.Size})
			}
		},
		Preflight: func(root string, total int64) error {
			return s.roomFor(root, uint64(total)*(1+unpackFactor)+downloadHeadroom) //nolint:gosec // G115: Stage refuses a size outside (0, MaxAssetBytes] above
		},
	})
	if err != nil {
		return Staged{}, err
	}
	if !verifying {
		// The zip was already in the cache and verified by the install check: there was nothing to download.
		report(Progress{Phase: PhaseVerifying, Done: file.Size, Total: file.Size})
	}
	report(Progress{Phase: PhaseUnpacking, Done: file.Size, Total: file.Size})
	staged, err := s.unpack(ctx, release, checksum)
	if err != nil {
		return Staged{}, err
	}
	s.clean(release)
	return staged, nil
}

// roomFor refuses when the disk holding path has less than need bytes free.
func (s *Stager) roomFor(path string, need uint64) error {
	free, err := s.free(path)
	if err != nil {
		return fmt.Errorf("could not tell how much disk space is free: %w", err)
	}
	if free < need {
		return userError(fmt.Sprintf("There is not enough free disk space for the update: it needs about %d MB and %d MB are free.", (need+(1<<20)-1)>>20, free>>20))
	}
	return nil
}

// fetchChecksum reads the release's .sha256 file, at most MaxChecksumBytes of it, and checks it names this release's zip. When GitHub
// listed a digest for the zip as well, the two must agree: they come from the same release, so a disagreement means one was changed.
func (s *Stager) fetchChecksum(ctx context.Context, release Release) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, release.Checksum.URL, nil)
	if err != nil {
		return "", errors.New("the checksum of the update could not be requested")
	}
	response, err := s.client().Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", userError("Could not download the update's checksum from GitHub.")
	}
	defer func() { _ = response.Body.Close() }() // read-only; nothing to report
	if response.StatusCode != http.StatusOK {
		return "", userError(fmt.Sprintf("The update's checksum could not be downloaded (GitHub answered with status %d).", response.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxChecksumBytes+1))
	if err != nil || len(body) > MaxChecksumBytes {
		return "", userError("The update's checksum file is not what was expected.")
	}
	sum, err := parseChecksum(string(body), release.Asset.Name)
	if err != nil {
		return "", err
	}
	if release.Asset.Digest != "" && release.Asset.Digest != sum {
		return "", userError("The checksum in the release and GitHub's own record of the file disagree, so the update was not used.")
	}
	return sum, nil
}

// parseChecksum reads `sha256sum` output: a SHA-256 in hexadecimal, and optionally the name of the file it is for, which must be
// this release's zip.
func parseChecksum(text, assetName string) (string, error) {
	invalid := userError("The update's checksum file is not what was expected.")
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	fields := strings.Fields(line)
	if len(fields) == 0 || len(fields) > 2 {
		return "", invalid
	}
	sum := strings.ToLower(fields[0])
	if len(sum) != 64 || !validHexDigest(sum) {
		return "", invalid
	}
	if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") != assetName {
		return "", userError("The update's checksum file is for a different file, so the update was not used.")
	}
	return sum, nil
}

// unpack takes the one program out of the verified zip. The zip must hold exactly that file under exactly that name, and claim no
// more than the program can be; the copy is bounded again by what it claimed, and the result is renamed into place only when whole.
func (s *Stager) unpack(ctx context.Context, release Release, zipSum string) (Staged, error) {
	dir := s.dirFor(release)
	reader, err := zip.OpenReader(filepath.Join(dir, release.Asset.Name))
	if err != nil {
		return Staged{}, userError("The downloaded update could not be opened.")
	}
	defer func() { _ = reader.Close() }() // read-only
	if len(reader.File) != 1 {
		return Staged{}, userError("The downloaded update does not hold exactly the program, so it was not used.")
	}
	entry := reader.File[0]
	if entry.Name != windowsExecutable || entry.FileInfo().IsDir() || !entry.Mode().IsRegular() {
		return Staged{}, userError("The downloaded update does not hold the program under the expected name, so it was not used.")
	}
	if entry.UncompressedSize64 == 0 {
		return Staged{}, userError("The downloaded update holds an empty program, so it was not used.")
	}
	if entry.UncompressedSize64 > uint64(s.maxExecutable()) { //nolint:gosec // G115: maxExecutable is a positive constant or a positive setting
		return Staged{}, userError("The downloaded update holds a program larger than any release, so it was not used.")
	}
	size := int64(entry.UncompressedSize64)                               //nolint:gosec // G115: bounded by maxExecutable just above
	if err := s.roomFor(dir, uint64(size)+downloadHeadroom); err != nil { //nolint:gosec // G115: size is bounded by maxExecutable above
		return Staged{}, err
	}
	partial := filepath.Join(dir, windowsExecutable+".partial")
	final := filepath.Join(dir, windowsExecutable)
	// "A record exists" has to mean "the program beside it is whole": the old record goes first.
	_ = os.Remove(filepath.Join(dir, stagedRecord))
	_ = os.Remove(final)
	_ = os.Remove(partial)
	sum, err := copyBounded(ctx, entry, partial, size)
	if err != nil {
		_ = os.Remove(partial)
		return Staged{}, err
	}
	if err := os.Rename(partial, final); err != nil {
		_ = os.Remove(partial)
		return Staged{}, userError("The update's program could not be put in place.")
	}
	record, _ := json.Marshal(stagedFile{Tag: release.Tag, ExecutableSize: size, ExecutableSHA256: sum, ZipSHA256: zipSum})
	if err := os.WriteFile(filepath.Join(dir, stagedRecord), record, 0o600); err != nil {
		_ = os.Remove(final)
		return Staged{}, userError("The update could not be recorded.")
	}
	return Staged{Release: release, Dir: dir, Executable: final, ExecutableSize: size, ExecutableSHA256: sum, ZipSHA256: zipSum}, nil
}

// copyBounded writes the entry to path, reading no more than size bytes (one more is read on purpose, so a longer body is seen as
// one), checking for a cancel as it goes, and returns the SHA-256 of what was written. The zip reader checks the entry's CRC.
func copyBounded(ctx context.Context, entry *zip.File, path string, size int64) (string, error) {
	source, err := entry.Open()
	if err != nil {
		return "", userError("The downloaded update could not be read.")
	}
	defer func() { _ = source.Close() }() // read-only
	// O_EXCL: the path was removed just before, so anything already there was put there since and is not written through.
	out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o700) //nolint:gosec // G302: the program has to be executable; the path is inside the update cache
	if err != nil {
		return "", userError("The update could not be unpacked.")
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(out, hash), &cancelReader{ctx: ctx, reader: io.LimitReader(source, size+1)})
	closeErr := out.Close()
	switch {
	case ctx.Err() != nil:
		return "", ctx.Err()
	case copyErr != nil || closeErr != nil:
		return "", userError("The update could not be unpacked.")
	case written != size:
		return "", userError("The downloaded update does not unpack to the size it says, so it was not used.")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type cancelReader struct {
	ctx    context.Context
	reader io.Reader
}

func (c *cancelReader) Read(buffer []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.reader.Read(buffer)
}

// clean removes what earlier updates left in the cache: every other version, and any download that never finished.
func (s *Stager) clean(keep Release) {
	entries, err := os.ReadDir(s.platformDir())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.Name() != keep.Version.String() {
			_ = os.RemoveAll(filepath.Join(s.platformDir(), entry.Name()))
		}
	}
}

// releaseHosts are the hosts a release download may be redirected to: github.com and the hosts GitHub serves release assets from (not
// the rest of githubusercontent.com, which also serves raw files, gists and avatars that anyone can publish).
var releaseHosts = map[string]struct{}{
	"github.com":                            {},
	"objects.githubusercontent.com":         {},
	"release-assets.githubusercontent.com":  {},
	"github-releases.githubusercontent.com": {},
}

// DownloadRedirectPolicy follows a redirect only to GitHub over HTTPS: github.com and its release-asset hosts, on the standard port, with no user information, and at most a few in a row. A release download is a
// redirect from github.com to one of those, and nothing else is followed.
func DownloadRedirectPolicy(request *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errors.New("too many redirects")
	}
	target := request.URL
	host := strings.ToLower(target.Hostname())
	_, allowed := releaseHosts[host]
	if target.Scheme != "https" || !allowed || target.User != nil || (target.Port() != "" && target.Port() != "443") {
		return errors.New("the download was redirected somewhere that is not GitHub")
	}
	return nil
}

// NewDownloadClient is the client an update download uses: GitHub only, and a bound on waiting for a server to answer. The body has
// no overall timeout (a 200 MB download on a slow line is legitimate); the narrator cancels it.
func NewDownloadClient() *http.Client {
	transport := &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 30 * time.Second, TLSHandshakeTimeout: 15 * time.Second, ForceAttemptHTTP2: true}
	return &http.Client{Transport: transport, CheckRedirect: DownloadRedirectPolicy}
}

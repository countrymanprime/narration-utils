# EBU loudness test set: expected values and how to run the check

`expected.json` is the committed expected-value table for `TestEBULoudnessTestSet` in `../../ebu_test.go`: every test case of EBU Tech 3341 Table 1 (cases 1 to 23) and EBU Tech 3342 Table 1 (cases 1 to 6), with the published expected value and tolerance, or the reason `measure` does not measure that case. The values are from the November 2023 editions of both documents. The result of the last run is recorded in [delivery-measurement-validation.md](../../../../../../docs/architecture/delivery-measurement-validation.md).

## The audio files are never committed

The EBU's terms of use for its audio test sequences (July 2019, version 1.0) allow use only to assess audio equipment and systems in internal research and development. They also forbid copying, publishing or distributing the sequences. So the WAV files stay outside the repository and outside CI. Only this table of published numbers is committed. When you report a result, credit the files as "© EBU", as the terms ask.

## Get the files

Download them by hand in a browser. The EBU site puts downloads behind a browser check that scripts cannot pass, and downloading the files means accepting the EBU's terms, which a person must do.

1. Open <https://tech.ebu.ch/publications/ebu_loudness_test_set> and read the "Terms of Use for these sequences" linked there.
2. Download `ebu-loudness-test-setv05.zip` (version 5.0, about 87 MB, 70 WAV files).
3. Unzip it to a folder **outside** this repository, for example `%USERPROFILE%\ebu-loudness-test-set`.

## Run the check

From `apps/desktop`:

```sh
NARRATION_EBU_DIR="$HOME/ebu-loudness-test-set" go test ./internal/measure -run TestEBULoudnessTestSet -v
```

In PowerShell:

```powershell
$env:NARRATION_EBU_DIR = "$HOME\ebu-loudness-test-set"; go test ./internal/measure -run TestEBULoudnessTestSet -v
```

The folder is searched recursively, so the zip's own sub-folder is fine. Files are matched to a case by name (`seq-3341-<case>-…`, `seq-3342-<case>-…`). Files without a case number, such as the calibration tones, are ignored. Without the variable, the test is skipped. `pnpm check` never runs it.

For each case, the test does one of three things:

- **Measured.** Integrated loudness (cases 1 to 5, 7 and 8) or true peak (cases 15 to 23) must be inside the published tolerance. With `-v`, each file logs one line: the measured value, the expected value and the tolerance.
- **Refused.** Case 6 is a 5.0-channel file. `measure` supports mono and stereo only ([ADR 0025](../../../../../../docs/adr/0025-delivery-measurements-in-go-profiles-deferred.md)), so the file must be refused with an error rather than measured.
- **Skipped, with the reason.** `measure` has no momentary, short-term or loudness-range meter, so Tech 3341 cases 9 to 14 and every Tech 3342 case are skipped.

A measured case with no file fails, so an incomplete set cannot pass.

## Record the result

Paste the `-v` log lines into [delivery-measurement-validation.md](../../../../../../docs/architecture/delivery-measurement-validation.md), with the date, the commit and the zip version. If a case fails, record the measured value there and open an issue for it. Don't widen the tolerance in `expected.json`: the numbers must stay the ones the EBU published.

# 0355. Audacity is driven over its scripting pipe, built from the published spec and verified by the owner's pass

**Status:** Proposed (the owner's verification pass is pending on #510, D65; which Audacity versions to support is the owner's call, below)
**Date:** 2026-09-28

## Context

The [Audacity integration PRD](../prds/audacity-integration.prd.md) gated its pipe client (Phase 4) and everything after it on the owner's spike session S-A1/S-A2, run against a real Audacity 3.x. On 2026-09-28 the owner reversed that order: build the Audacity hookups now, **for Audacity 4**, from the published specs, and turn the spike session into the verification pass, the way REAPER works ([ADR 0066](0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md): the logic is proven against a fake, and the real behaviour is checked by the owner and recorded as pending).

The research for this ([Audacity 4 scripting spec](../research/audacity-4-scripting-spec.md), 2026-09-28, from Audacity's source, release notes, issues and the manual's source) found:

- **Audacity 4 has no scripting interface.** The 4.0.0 release notes list "Macro Manager and the scripting pipe" among the Audacity 3 features "not available in Audacity 4.0". No 4.0.1 or 4.1 is released. The `mod-script-pipe` source is still in the tree but is not built, and master has no pipe or IPC server. 4.1's planned "script host" (audacity/audacity#11734) has no written protocol.
- **The only published spec is Audacity 3's `mod-script-pipe`.** Two named pipes on Windows, one command per line, a reply framed by a terminator and an empty line, and a command set whose names and parameters the manual lists.
- **That protocol has quirks a client must design around.** Values are un-escaped in an order that makes no escaping safe. Each command must fit a 1024-byte read. GetInfo's JSON escapes only the double quote and quotes its booleans. With no project open, the reply is a bare empty line. `Export2` picks its exporter by extension, and one exporter (`CL`) runs a command line. `TogglePlayRegion` misbehaves when scripted.

So "build for Audacity 4 from its published spec" has no spec to build against. The one we can build and test is Audacity 3's protocol.

## Decision

1. **The client speaks `mod-script-pipe`, as Audacity publishes it, behind a `Transport` interface.** `apps/desktop/internal/audacitybridge` holds:
   - the protocol: `Command`, `Client`, the strict reply parser and the typed commands;
   - `PipeTransport()`, the Windows named-pipe transport over `golang.org/x/sys/windows`. The pipe names `\\.\pipe\ToSrvPipe` and `\\.\pipe\FromSrvPipe` are fixed in code.

   An Audacity 4.0 install has no pipe, so every request reports `ErrNotReachable`, the same answer as Audacity being closed. When an Audacity 4.x release publishes its script host, supporting it is a new `Transport`, and possibly a new command dialect, under a new ADR. No caller changes.
2. **Every value is data, and a value the syntax cannot carry is refused, not escaped.**
   - Text may not contain a double quote, a backslash, a control character or a line separator. `SanitizeText` replaces these in label text the host builds.
   - A path must be absolute on a local drive and is written with forward slashes. A UNC or device path is refused (D72: the narrator's audio does not leave the machine through this channel), and so is a `..` element.
   - Names and enumerated choices must be plain identifiers.
   - A line longer than 1020 bytes is refused.
   - `Export` accepts only `.wav`, `.flac`, `.mp3`, `.ogg`, `.aiff` and `.aif`, and `Import` accepts only audio. `OpenProject` accepts only `.aup3`.
   - There is no shell and no program start anywhere in the package.
3. **Replies are parsed strictly.**
   - The terminator must be exactly `BatchCommand finished: OK` or `BatchCommand finished: Failed!`, followed by an empty line. A reply is bounded to 1 MiB per line and 8 MiB in all, and a NUL byte is refused.
   - A broken frame is a `*ProtocolError`, and `Failed!` is a `*CommandError` carrying Audacity's reason. A bare empty line is `ErrNoProject`.
   - A request that has no complete reply within 5 s is `ErrTimeout`. The client closes the connection, which cancels the blocked pipe read, and the next request reconnects, so a late answer is never read as the next command's.
   - Requests are serialised, one conversation per pipe.
4. **The Audacity adapter keeps every capability it builds `Experimental`** until the owner's pass confirms it (`internal/dawport/audacity`). Everything it does not build keeps [ADR 0144](0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md)'s "not available yet" sentence. It builds:
   - the port's `navigate` role: a time in the project, looped with `SelectTime` then `PlayAtSpeedLooped`, never with the stateful `TogglePlayRegion`;
   - the `markers` role: a label, added once per name;
   - the Audacity-only operations the PRD needs and the port has no capability for yet: import findings as labels, read them back, mark one reviewed, export a chapter's audio and write a hand-off label file. Adding them to the port's catalog is lane K's change; it is requested on #509.
5. **A finding's identity is in its label's text** (PRD Question 4): `[nu:<finding id>]`, or `[nu:<finding id> reviewed]` once it is reviewed, then the finding's words. Labels are matched by that identity, never by time: GetInfo reports only about six significant digits. Re-importing adds no second label for a finding, and marking one reviewed rewrites it in place.
6. **The fake is the spec, and the owner's pass is the check.**
   - `audacitybridgetest` is an in-memory pipe server. It parses commands as Audacity does (the wxWidgets split, then `Unescape`), keeps a small project, answers with the documented replies, and misbehaves on demand: hang, garbage, a missing empty line, hang-up, `Failed!` and no project. Every command and the parser have table-driven tests, run with `-race`.
   - What only a real Audacity can show is the owner's verification pass (`docs/operations/audacity-verification-pass.md`, added with the adapter): the pipe itself, the escaping, where `AddLabel` puts a label, the loop, and the export. It runs unattended against a scratch project. Each difference it finds corrects the fake, with a test, as with REAPER.

## Consequences

- The Audacity code is built, tested and ready for the day scripting reaches the narrator's Audacity: today, on Audacity 3.x with `mod-script-pipe` enabled. On Audacity 4.0 it honestly reports "not reachable". The pass records the installed version first, so a 4.0 result is read as "no pipe", not as a bug.
- **Needs the owner (on #510):** Audacity 4 cannot be supported until Audacity ships a scripting interface. The choice is either to support narrators on Audacity 3.x now (the PRD's 2026-09-23 decision, which this build serves as is), or to wait for 4.1's script host and add its transport then. Until the owner answers, both paths stay open: the client is 3.x-shaped, and the transport is swappable.
- Refusing rather than escaping means that a label cannot show a double quote or a backslash exactly as the finding had them; they appear as `”` and `∖`. A project folder on a network share cannot be exported to through Audacity.
- The pipe is a new local IPC boundary. Anyone running as the narrator can already write to it and make Audacity read and write files (the manual says Audacity "does not police or sanitize" pipe input). The app adds no new reach: it only writes the commands above, from narrator actions ([threat model](../architecture/threat-model.md) section 10, `SECURITY.md`).
- To support Audacity 4's script host, drop the pipe, or promote a capability to Supported, write an ADR that supersedes the relevant point here. Promoting a capability is a declaration change in `internal/dawport/audacity`, made in the PR that records the owner's pass.

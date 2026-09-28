<#
.SYNOPSIS
  Phase 0 spike for docs/prds/app-navigation-and-zoom-controls.prd.md: verifies today's zoom and
  back/forward behaviour on the real packaged Windows build (Wails v3), scripted, with no REAPER
  and no owner. Throwaway research tooling (like apps/desktop/cmd/spike-globalhotkeys before it):
  not wired into the shipped binary, not run by any always-on CI job.

.DESCRIPTION
  Launches the self-contained narration-utils.exe with an isolated app-data folder (so nothing here
  reads or writes the owner's real settings or recent-projects list) and WebView2's remote debugging
  port enabled, then:
    - confirms the packaged GUI actually opens a window on a hosted windows-latest runner at all
      (apps/desktop/smoke.go's own comment says a CI job "cannot start it and look at a window";
      this spike's first job is finding out whether that is still true for an interactive launch,
      not just Wails' own non-interactive --smoke mode);
    - drives real OS-level input (Win32 SendInput, not CDP-synthesized input, since the whole
      question is what the OS message loop and WebView2 do with it before the page ever sees it)
      for Ctrl+wheel, Ctrl+=/-/0, Alt+Left/Right and the mouse's back/forward buttons;
    - reads WebView2's own state back over its Chrome DevTools Protocol port (window.devicePixelRatio,
      location.href), never by clicking anything the app renders, so none of this needs a project
      attached (apps/ui/src/App.tsx:381 gates the whole router behind one) or REAPER;
    - quits and relaunches against the same isolated profile folder to check zoom persistence.

  Touchpad pinch and a physical side-button mouse are not simulated: Win32 has no supported way to
  synthesize either from a script, so those two rows stay owner-pending on #510 exactly as the PRD's
  own Phase 0 scope says.

.OUTPUTS
  Writes a JSON report to -ReportPath (default .\app-nav-zoom-p0-report.json) and prints a
  human-readable line per check to stdout.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,
    [string]$ReportPath = "$PSScriptRoot\app-nav-zoom-p0-report.json",
    [int]$DebugPort = 9333
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --- Win32 P/Invoke: SendInput (keyboard, wheel, X-buttons) and window lookup -----------------------------------
# All top-level types in one namespace (not nested inside a wrapper class), so PowerShell type literals stay
# plain dotted names ([NavZoomSpike.Win32], [NavZoomSpike.RECT]) instead of the "+"-nested-type syntax that
# Add-Type -MemberDefinition's implicit wrapper class would otherwise require.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace NavZoomSpike {
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public IntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public INPUTUNION u;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    public static class Win32 {
        public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_XDOWN = 0x0080, MOUSEEVENTF_XUP = 0x0100;
        public const uint XBUTTON1 = 0x0001, XBUTTON2 = 0x0002;
        public const int VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LEFT = 0x25, VK_RIGHT = 0x27;
        public const int VK_OEM_PLUS = 0xBB, VK_OEM_MINUS = 0xBD, VK_0 = 0x30, VK_NUMPAD0 = 0x60;
        public const int WHEEL_DELTA = 120;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);

        public static INPUT Key(int vk, bool up) {
            var inp = new INPUT { type = INPUT_KEYBOARD };
            inp.u.ki = new KEYBDINPUT { wVk = (ushort)vk, wScan = 0, dwFlags = up ? KEYEVENTF_KEYUP : 0, time = 0, dwExtraInfo = IntPtr.Zero };
            return inp;
        }
        public static INPUT Wheel(int delta) {
            var inp = new INPUT { type = INPUT_MOUSE };
            inp.u.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = unchecked((uint)delta), dwFlags = MOUSEEVENTF_WHEEL, time = 0, dwExtraInfo = IntPtr.Zero };
            return inp;
        }
        public static INPUT XButton(uint which, bool up) {
            var inp = new INPUT { type = INPUT_MOUSE };
            inp.u.mi = new MOUSEINPUT { dx = 0, dy = 0, mouseData = which, dwFlags = up ? MOUSEEVENTF_XUP : MOUSEEVENTF_XDOWN, time = 0, dwExtraInfo = IntPtr.Zero };
            return inp;
        }
        public static void Send(INPUT[] inputs) {
            var rc = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (rc != inputs.Length) throw new InvalidOperationException("SendInput accepted " + rc + " of " + inputs.Length + " events (GetLastError=" + Marshal.GetLastWin32Error() + ")");
        }
    }
}
'@

function Send-KeyChord {
    param([int[]]$Modifiers, [int]$Key)
    $down = @(); foreach ($m in $Modifiers) { $down += [NavZoomSpike.Win32]::Key($m, $false) }
    $down += [NavZoomSpike.Win32]::Key($Key, $false)
    $down += [NavZoomSpike.Win32]::Key($Key, $true)
    for ($i = $Modifiers.Count - 1; $i -ge 0; $i--) { $down += [NavZoomSpike.Win32]::Key($Modifiers[$i], $true) }
    [NavZoomSpike.Win32]::Send($down)
}

function Send-CtrlWheel {
    param([int]$Notches)
    $ctrlDown = [NavZoomSpike.Win32]::Key([NavZoomSpike.Win32]::VK_CONTROL, $false)
    $wheel = [NavZoomSpike.Win32]::Wheel([NavZoomSpike.Win32]::WHEEL_DELTA * $Notches)
    $ctrlUp = [NavZoomSpike.Win32]::Key([NavZoomSpike.Win32]::VK_CONTROL, $true)
    [NavZoomSpike.Win32]::Send(@($ctrlDown, $wheel, $ctrlUp))
}

function Send-XButton {
    param([uint32]$Which)
    [NavZoomSpike.Win32]::Send(@(
            [NavZoomSpike.Win32]::XButton($Which, $false),
            [NavZoomSpike.Win32]::XButton($Which, $true)
        ))
}

function Focus-AppWindow {
    param([System.Diagnostics.Process]$Proc)
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $Proc.Refresh()
        if ($Proc.MainWindowHandle -ne [IntPtr]::Zero -and [NavZoomSpike.Win32]::IsWindowVisible($Proc.MainWindowHandle)) {
            [NavZoomSpike.Win32]::SetForegroundWindow($Proc.MainWindowHandle) | Out-Null
            $rect = New-Object NavZoomSpike.RECT
            [NavZoomSpike.Win32]::GetWindowRect($Proc.MainWindowHandle, [ref]$rect) | Out-Null
            $cx = [int](($rect.Left + $rect.Right) / 2)
            $cy = [int](($rect.Top + $rect.Bottom) / 2)
            [NavZoomSpike.Win32]::SetCursorPos($cx, $cy) | Out-Null
            Start-Sleep -Milliseconds 300
            return $Proc.MainWindowHandle
        }
        Start-Sleep -Milliseconds 250
    }
    return [IntPtr]::Zero
}

# --- Chrome DevTools Protocol client (WebView2 exposes the same protocol) --------------------------------------
function Get-DebuggerWsUrl {
    param([int]$Port, [int]$TimeoutSeconds = 30)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3
            $page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
            if ($page) { return $page.webSocketDebuggerUrl }
        }
        catch { Start-Sleep -Milliseconds 500 }
    }
    throw "WebView2's DevTools port $Port never answered within ${TimeoutSeconds}s"
}

class CdpClient {
    [System.Net.WebSockets.ClientWebSocket]$Socket
    [int]$NextId = 1

    CdpClient([string]$Url) {
        $this.Socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $this.Socket.ConnectAsync([Uri]$Url, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    }

    [object] Send([string]$Method, [hashtable]$Params) {
        $id = $this.NextId++
        $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 10 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
        $this.Socket.SendAsync([ArraySegment[byte]]$bytes, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
        $buffer = New-Object byte[] 65536
        while ($true) {
            $sb = New-Object System.Text.StringBuilder
            do {
                $seg = [ArraySegment[byte]]$buffer
                $result = $this.Socket.ReceiveAsync($seg, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
                $sb.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)) | Out-Null
            } while (-not $result.EndOfMessage)
            $msg = $sb.ToString() | ConvertFrom-Json
            if ($msg.id -eq $id) { return $msg }
            # else: an unrelated CDP event notification; keep reading for our reply.
        }
        return $null
    }

    [object] Eval([string]$Expression) {
        $reply = $this.Send('Runtime.evaluate', @{ expression = $Expression; returnByValue = $true })
        if ($reply.result.exceptionDetails) { throw "JS evaluate failed: $($reply.result.exceptionDetails.text)" }
        return $reply.result.result.value
    }

    [void] Close() {
        try { $this.Socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() } catch {}
    }
}

# --- Report plumbing ---------------------------------------------------------------------------------------------
$script:Checks = @()
function Add-Check {
    param([string]$Name, [string]$Result, [string]$Detail, [string]$Confidence = 'high')
    $entry = [ordered]@{ name = $Name; result = $Result; detail = $Detail; confidence = $Confidence }
    $script:Checks += $entry
    Write-Host "[$Result] $Name — $Detail"
}

function Start-App {
    param([string]$ProfileDir)
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $env:APPDATA = $ProfileDir
    $env:LOCALAPPDATA = $ProfileDir
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$DebugPort"
    return Start-Process -FilePath $ExePath -PassThru
}

# ===================================================================================================================
# Run
# ===================================================================================================================
$profileDir = Join-Path $env:RUNNER_TEMP 'navzoom-profile'
if (-not $env:RUNNER_TEMP) { $profileDir = Join-Path ([IO.Path]::GetTempPath()) 'navzoom-profile' }

try {
    $proc = Start-App -ProfileDir $profileDir
}
catch {
    Add-Check -Name 'launch' -Result 'error' -Detail "narration-utils.exe could not even be started: $_"
    $script:Checks | ConvertTo-Json -Depth 10 | Set-Content -Path $ReportPath
    exit 1
}

$hwnd = Focus-AppWindow -Proc $proc
if ($hwnd -eq [IntPtr]::Zero) {
    Add-Check -Name 'launch' -Result 'fail' -Detail 'The process started but no visible main window appeared within 20s on this hosted runner (apps/desktop/smoke.go already assumes a CI job cannot open one; this is that assumption holding for an interactive launch too, not only --smoke). Nothing below this line was exercised for real.'
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $script:Checks | ConvertTo-Json -Depth 10 | Set-Content -Path $ReportPath
    exit 0
}
Add-Check -Name 'launch' -Result 'pass' -Detail "A visible window opened on the hosted windows-latest runner (hwnd=$hwnd). A CI job CAN open and drive this GUI interactively, contrary to smoke.go's comment about non-interactive builds only." -Confidence 'high (directly observed)'

try {
    $wsUrl = Get-DebuggerWsUrl -Port $DebugPort
    $cdp = [CdpClient]::new($wsUrl)
}
catch {
    Add-Check -Name 'devtools-port' -Result 'fail' -Detail "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS's remote debugging port never came up: $_. Every check below is skipped."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $script:Checks | ConvertTo-Json -Depth 10 | Set-Content -Path $ReportPath
    exit 0
}
Add-Check -Name 'devtools-port' -Result 'pass' -Detail 'Connected to WebView2 over CDP; the rest of this run reads state through it, never by clicking rendered UI (no project is attached, so only ProjectPicker exists to click).'

$baselineRatio = $cdp.Eval('window.devicePixelRatio')
Add-Check -Name 'baseline-zoom' -Result 'info' -Detail "window.devicePixelRatio at first paint: $baselineRatio"

# --- Ctrl+wheel (Q: does zoom control stay on with Windows options set, per the ZoomControlEnabled trap?) ------
Send-CtrlWheel -Notches 6
Start-Sleep -Milliseconds 800
$afterWheelRatio = $cdp.Eval('window.devicePixelRatio')
if ($afterWheelRatio -gt $baselineRatio) {
    Add-Check -Name 'ctrl-wheel-zoom' -Result 'pass' -Detail "devicePixelRatio moved $baselineRatio -> $afterWheelRatio after 6 Ctrl+wheel notches up. Confirms mainWindowOptions()'s ZoomControlEnabled: true keeps this on, as the PRD's Evidence predicted from source."
}
else {
    Add-Check -Name 'ctrl-wheel-zoom' -Result 'fail' -Detail "devicePixelRatio did not increase ($baselineRatio -> $afterWheelRatio) after a synthetic Ctrl+wheel. Either SendInput's synthetic wheel isn't accepted the way real hardware input is, or zoom control is off in this build; needs a real machine to disambiguate (SendInput-synthesized input is occasionally treated differently from hardware by some input stacks)." -Confidence 'medium (synthetic input, see detail)'
}

# --- Ctrl+=, Ctrl+-, Ctrl+0: WebView2's browser accelerator keys are off (frontend disables them unconditionally
#     on v2; Phase 2 of this PRD is what will make the page itself handle these, and it is not built yet) ------
$preAccelRatio = $cdp.Eval('window.devicePixelRatio')
Send-KeyChord -Modifiers @([NavZoomSpike.Win32]::VK_CONTROL) -Key ([NavZoomSpike.Win32]::VK_OEM_MINUS)
Start-Sleep -Milliseconds 400
Send-KeyChord -Modifiers @([NavZoomSpike.Win32]::VK_CONTROL) -Key ([NavZoomSpike.Win32]::VK_0)
Start-Sleep -Milliseconds 400
$postAccelRatio = $cdp.Eval('window.devicePixelRatio')
if ($postAccelRatio -eq $preAccelRatio) {
    Add-Check -Name 'ctrl-accelerator-keys-noop' -Result 'pass' -Detail "devicePixelRatio unchanged ($preAccelRatio) across Ctrl+-, Ctrl+0 with no app-level handler installed (Phase 2 not built): today, on Wails v3, these keys do nothing at the OS/WebView2 layer, exactly as PutAreBrowserAcceleratorKeysEnabled(false) predicts from source (main.go / v3's webview_window_windows.go)."
}
else {
    Add-Check -Name 'ctrl-accelerator-keys-noop' -Result 'fail' -Detail "devicePixelRatio moved ($preAccelRatio -> $postAccelRatio) from Ctrl+-/Ctrl+0 alone, with no page-level handler present. Contradicts the PRD's source-based prediction; re-check whether v3 still disables browser accelerator keys the same way v2 did."
}

# --- Zoom persistence across relaunch: is this WebView2's own per-profile behaviour, independent of app code? --
# Chromium's zoom-level map is written to the profile's Preferences file on a commit timer, not synchronously on
# every Ctrl+wheel notch, so this waits well past that before the process is killed - otherwise a false "it does
# not persist" would really just mean "the write hadn't landed yet when this script forced the process closed."
$prePersistRatio = $cdp.Eval('window.devicePixelRatio')
$cdp.Close()
Start-Sleep -Seconds 12
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$proc2 = Start-App -ProfileDir $profileDir   # same profile dir: this is the persistence test
$hwnd2 = Focus-AppWindow -Proc $proc2
if ($hwnd2 -eq [IntPtr]::Zero) {
    Add-Check -Name 'zoom-persists-relaunch' -Result 'error' -Detail 'The relaunch (same isolated profile) never opened a window; persistence could not be checked.'
}
else {
    try {
        $wsUrl2 = Get-DebuggerWsUrl -Port $DebugPort
        $cdp2 = [CdpClient]::new($wsUrl2)
        $relaunchRatio = $cdp2.Eval('window.devicePixelRatio')
        if ([Math]::Abs($relaunchRatio - $prePersistRatio) -lt 0.01) {
            Add-Check -Name 'zoom-persists-relaunch' -Result 'pass' -Detail "devicePixelRatio was $prePersistRatio before quitting and $relaunchRatio on relaunch against the same profile folder: WebView2 restores the last Ctrl+wheel level on its own, with no app code involved. The PRD's Q4/Phase 3 work (an explicit saved 'Zoom' startup option) is about controlling this deliberately and app-wide, not about the underlying persistence not existing."
        }
        else {
            Add-Check -Name 'zoom-persists-relaunch' -Result 'fail' -Detail "devicePixelRatio was $prePersistRatio before quitting (after a 12s wait for Chromium's preference-commit timer) and reset to $relaunchRatio on relaunch: WebView2 does NOT restore the level on its own here. Phase 3 cannot rely on an implicit WebView2 behaviour and must actively call Window.SetZoom before first paint, as its Scope already plans. (The 12s wait rules out the obvious false negative - the write not having landed before the process was killed - but a forced Stop-Process is still not the same shutdown path a narrator's own window-close would take; worth one confirmation on a real machine before fully relying on this.)"
        }
        $cdp2.Close()
    }
    catch {
        Add-Check -Name 'zoom-persists-relaunch' -Result 'error' -Detail "Reconnecting to the relaunched window's DevTools port failed: $_"
    }
    Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue
}

# --- Mouse buttons 4/5 and Alt+Left/Right vs WebView2's OWN back/forward handling, isolated from any app code --
# ProjectPicker has no router (App.tsx gates it out entirely without a project attached), so there is no Phase 1
# JS listener mounted here to confound the answer: two history entries are pushed directly with the History API
# (harmless same-page anchors, not real app routes) purely so there is somewhere for a native back/forward to go.
$proc3 = Start-App -ProfileDir (Join-Path $env:RUNNER_TEMP 'navzoom-profile-nav')
$hwnd3 = Focus-AppWindow -Proc $proc3
if ($hwnd3 -eq [IntPtr]::Zero) {
    Add-Check -Name 'os-level-back-forward' -Result 'error' -Detail 'The window for the navigation checks never appeared.'
}
else {
    $wsUrl3 = Get-DebuggerWsUrl -Port $DebugPort
    $cdp3 = [CdpClient]::new($wsUrl3)
    $cdp3.Eval("history.pushState(null, '', location.pathname + '#a')") | Out-Null
    $cdp3.Eval("history.pushState(null, '', location.pathname + '#b')") | Out-Null
    $atB = $cdp3.Eval('location.href')

    Send-XButton -Which ([NavZoomSpike.Win32]::XBUTTON1)   # the mouse's back button
    Start-Sleep -Milliseconds 500
    $afterXButton = $cdp3.Eval('location.href')
    if ($afterXButton -ne $atB -and $afterXButton.EndsWith('#a')) {
        Add-Check -Name 'mouse-xbutton1-navigates' -Result 'notable' -Detail "WebView2 itself moved from '#b' to '#a' on a synthetic XBUTTON1 press, with no page-level listener installed to cause it. This means WebView2 DOES wire the mouse's back/forward buttons to browser history even with PutAreBrowserAcceleratorKeysEnabled(false) (that setting is documented as covering keyboard accelerators; this suggests it does not cover the chrome mouse buttons). Phase 1's own mousedown/mouseup preventDefault matters for real: without it, WebView2's native back would run *in addition to* the app's guarded back, double-moving or bypassing the Settings/Proofing guards." -Confidence 'high (directly observed, isolated from app code)'
    }
    else {
        Add-Check -Name 'mouse-xbutton1-navigates' -Result 'notable' -Detail "location stayed at '$afterXButton' after a synthetic XBUTTON1 press (expected '...#a'). WebView2 does NOT act on the mouse's back button by itself here; Phase 1's mousedown preventDefault is defensive, not load-bearing, for this specific path. (Caveat: a real physical side-button mouse still needs the owner to confirm — SendInput's XBUTTON path is not guaranteed identical to a hardware device's, see #510.)" -Confidence 'medium (synthetic input; a real device is the stronger test)'
    }

    # Re-arm two entries and repeat with a mousedown-capturing preventDefault installed, mirroring Phase 1's own
    # App.tsx listener, to check whether preventDefault is actually sufficient to stop WebView2's native handling.
    $cdp3.Eval("history.pushState(null, '', location.pathname + '#c')") | Out-Null
    $cdp3.Eval("window.__navSpikeBlocked = 0; document.addEventListener('mousedown', function(e){ if (e.button === 3 || e.button === 4) { e.preventDefault(); window.__navSpikeBlocked++; } }, true);") | Out-Null
    $beforeGuarded = $cdp3.Eval('location.href')
    Send-XButton -Which ([NavZoomSpike.Win32]::XBUTTON1)
    Start-Sleep -Milliseconds 500
    $afterGuarded = $cdp3.Eval('location.href')
    $blockedCount = $cdp3.Eval('window.__navSpikeBlocked')
    if ($afterGuarded -eq $beforeGuarded) {
        Add-Check -Name 'preventdefault-stops-xbutton' -Result 'pass' -Detail "With a capturing mousedown listener calling preventDefault() (blocked count=$blockedCount), the synthetic XBUTTON1 no longer changed location.href ($beforeGuarded unchanged). This validates Phase 1's App.tsx comment ('mousedown, to stop WebView2 acting first') as effective, at least against this synthetic input."
    }
    else {
        Add-Check -Name 'preventdefault-stops-xbutton' -Result 'fail' -Detail "Despite a capturing mousedown preventDefault (blocked count=$blockedCount), location still moved $beforeGuarded -> $afterGuarded. If this reproduces on real hardware, Phase 1's guard can be bypassed by the mouse's own back button: worth a Proposed ADR and a #510 item for the owner to confirm on their own mouse."
    }

    # Alt+Left / Alt+Right, same isolated page, no app listener for the first probe.
    $cdp3.Eval("history.pushState(null, '', location.pathname + '#d'); document.removeEventListener !== undefined;") | Out-Null
    $beforeAlt = $cdp3.Eval('location.href')
    Send-KeyChord -Modifiers @([NavZoomSpike.Win32]::VK_MENU) -Key ([NavZoomSpike.Win32]::VK_LEFT)
    Start-Sleep -Milliseconds 500
    $afterAlt = $cdp3.Eval('location.href')
    if ($afterAlt -ne $beforeAlt) {
        Add-Check -Name 'alt-left-navigates' -Result 'notable' -Detail "Alt+Left moved location from '$beforeAlt' to '$afterAlt' with no app-level handler present: WebView2/Windows itself treats Alt+Left as browser-back here, unlike the PRD's inference. Needs Phase 1's own keydown handler (which does preventDefault) re-checked the same way for double-handling."
    }
    else {
        Add-Check -Name 'alt-left-navigates' -Result 'pass' -Detail "location stayed at '$afterAlt': Alt+Left does nothing at the OS/WebView2 layer today (confirms the PRD Evidence's inference from PutAreBrowserAcceleratorKeysEnabled(false) and WebView2's documented accelerator-key list, which names Alt+Left/Right)."
    }

    $cdp3.Close()
    Stop-Process -Id $proc3.Id -Force -ErrorAction SilentlyContinue
}

$script:Checks | ConvertTo-Json -Depth 10 | Set-Content -Path $ReportPath
Write-Host "Report written to $ReportPath"

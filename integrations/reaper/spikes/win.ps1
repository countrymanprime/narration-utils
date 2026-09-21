Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class W3 { public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
 public static List<string> ForPid(uint pid) { var l = new List<string>(); EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) { var t = new StringBuilder(256); GetWindowText(h, t, 256); var c = new StringBuilder(256); GetClassName(h, c, 256); if (IsWindowVisible(h)) l.Add(h.ToInt64().ToString() + " class=" + c + " title='" + t + "'"); } return true; }, IntPtr.Zero); return l; } }
"@
function Get-ReaperWindows($procId) { [W3]::ForPid([uint32]$procId) }
function Get-DialogText($hwnd) {
  $el = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { "  $($_.Current.ControlType.ProgrammaticName) '$($_.Current.Name)' id=$($_.Current.AutomationId)" }
}

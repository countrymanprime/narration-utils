using System.Runtime.InteropServices;
using System.Text.Json;
using Photino.NET;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("NarrationUtilsHub.Tests")]

namespace NarrationUtilsHub;

internal static class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    private const uint MB_ICONERROR = 0x10;
    private const int StartupTimeoutSeconds = 15;

    // WebView2's async initialization is COM-driven and requires an STA
    // message pump on the hosting thread. A plain console/WinExe Main is MTA
    // by default (unlike WPF/WinForms templates, which apply this for you) -
    // without it, Photino creates a real, responding native window but the
    // WebView2 control never actually finishes initializing: no navigation,
    // no script execution, no WebMessageReceived callbacks ever arrive, with
    // no exception to catch anywhere. Confirmed via an isolated minimal
    // repro before landing this fix - it is the entire root cause, not a
    // deeper Photino reliability problem.
    [STAThread]
    private static void Main(string[] args)
    {
        var options = ParseArgs(args);
        Config.RepoRoot = FindRepoRoot();
        var diagnostics = new SessionDiagnostics(options.SessionDir);
        var uiDistDir = Path.GetFullPath(Path.Combine(Config.RepoRoot, "shared", "ui", "dist"));

        if (options.SmokeTest)
        {
            RunSmokeTest(options, diagnostics);
            return;
        }

        if (!File.Exists(Path.Combine(uiDistDir, "index.html")))
        {
            FailStartup(diagnostics, "Narration Utils UI assets are missing.\n\nRun scripts\\Quickstart.ps1 from this checkout, then launch it again.");
            return;
        }

        foreach (var seed in options.Seed)
        {
            var parts = seed.Split('|', 3);
            if (parts.Length == 3) Config.SeedGlobalIfMissing(parts[0], new Dictionary<string, string> { [parts[1]] = parts[2] });
        }

        var hub = new Hub(options.ToHubArgs(), diagnostics);

        var window = new PhotinoWindow();
        window.SetTitle("Narration Utils");
        window.SetUseOsDefaultSize(false);
        window.SetSize(new System.Drawing.Size(1180, 780));
        window.SetMinSize(760, 560);

        hub.ShowOpenDocxDialog = () =>
        {
            var selected = window.ShowOpenFile("Choose manuscript", null, false, new[] { ("Word documents", new[] { "docx" }) });
            return selected is { Length: > 0 } ? selected[0] : null;
        };

        var startupLock = new object();
        var startupResolved = false;

        void WriteStartupReady()
        {
            lock (startupLock) { if (startupResolved) return; startupResolved = true; }
            File.WriteAllText(Path.Combine(options.SessionDir, "startup.ready"), "OK\n");
        }

        void WriteStartupFailure(string message)
        {
            lock (startupLock) { if (startupResolved) return; startupResolved = true; }
            diagnostics.Event("startup_failure_written", new Dictionary<string, object?> { ["message"] = message });
            File.WriteAllText(Path.Combine(options.SessionDir, "startup.failure"), message + "\n");
        }

        // No native "page loaded" event exists on PhotinoWindow (confirmed
        // against its source) - readiness is instead the app-level ready()
        // RPC round trip actually succeeding, which is arguably a better
        // signal than pywebview's old events.loaded ever was (that only
        // proved the DOM had loaded, not that the JS<->native bridge worked).
        var startupTimer = new Timer(
            _ => WriteStartupFailure($"Narration Utils could not finish initializing its desktop API within {StartupTimeoutSeconds}s. See {diagnostics.Path}"),
            null, TimeSpan.FromSeconds(StartupTimeoutSeconds), Timeout.InfiniteTimeSpan);

        window.WebMessageReceived += (_, message) =>
        {
            JsonElement idElement = default;
            try
            {
                using var doc = JsonDocument.Parse(message);
                var root = doc.RootElement;
                idElement = root.GetProperty("id");
                var method = root.GetProperty("method").GetString() ?? "";
                var argsElement = root.TryGetProperty("args", out var a) ? a : default;
                var rpcArgs = argsElement.ValueKind == JsonValueKind.Array ? argsElement.EnumerateArray().ToArray() : Array.Empty<JsonElement>();

                object? result;
                Dictionary<string, object?> response;
                try
                {
                    result = RpcDispatcher.Dispatch(hub, method, rpcArgs);
                    if (method == "ready") { startupTimer.Dispose(); WriteStartupReady(); }
                    response = new Dictionary<string, object?> { ["id"] = idElement.GetInt32(), ["result"] = result };
                }
                catch (Exception ex)
                {
                    diagnostics.Exception("rpc_call_failed_" + method, ex);
                    response = new Dictionary<string, object?> { ["id"] = idElement.GetInt32(), ["error"] = ex.Message };
                }
                window.SendWebMessage(JsonSerializer.Serialize(response));
            }
            catch (Exception ex)
            {
                diagnostics.Exception("rpc_message_unparseable", ex);
            }
        };

        window.WindowClosing += (_, _) => { hub.Close(); return false; };

        // Photino.Load() against a plain file:// URL was tried first and
        // silently failed: Chromium (WebView2) refuses to execute Vite's
        // <script type="module"> tags when the page origin is file://
        // (treated as cross-origin for module scripts), so nothing in the
        // bundle ever ran and ready() never fired. Photino's custom-scheme
        // handler was tried next and never received a single request either
        // (its native WebView2 backend does not appear to wire it up the way
        // its docs imply) - so this serves the prebuilt shared/ui/dist bundle
        // over a real loopback HTTP server instead, the same fix pywebview's
        // http_server=True flag existed to provide.
        var localServer = new LocalStaticServer(uiDistDir);
        var baseUrl = localServer.Start();
        diagnostics.Event("local_server_started", new Dictionary<string, object?> { ["url"] = baseUrl });

        diagnostics.Event("webview_window_creating");
        window.Load(new Uri(baseUrl + "index.html"));
        diagnostics.Event("webview_starting");
        window.WaitForClose();
        diagnostics.Event("webview_stopped");
        localServer.Stop();
    }

    private static void RunSmokeTest(LaunchOptions options, SessionDiagnostics diagnostics)
    {
        var missing = Hub.PublicApiMethods.Where(name => !RpcDispatcher.IsKnownMethod(name)).ToList();
        if (missing.Count > 0) throw new InvalidOperationException("Host API contract is incomplete: " + string.Join(", ", missing));
        var hub = new Hub(options.ToHubArgs(), diagnostics);
        var bootstrap = hub.Bootstrap();
        if ((int)(bootstrap["apiVersion"] ?? -1) != Hub.ApiVersion) throw new InvalidOperationException("Bootstrap API version mismatch");
        diagnostics.Event("smoke_test_passed", new Dictionary<string, object?> { ["methods"] = Hub.PublicApiMethods });
        Console.WriteLine("OK");
    }

    private static void FailStartup(SessionDiagnostics diagnostics, string message)
    {
        diagnostics.Event("startup_error_shown", new Dictionary<string, object?> { ["message"] = message });
        try { File.WriteAllText(Path.Combine(diagnostics.SessionDir, "startup.failure"), message + "\n"); } catch (IOException) { }
        MessageBoxW(IntPtr.Zero, message, "Narration Utils setup required", MB_ICONERROR);
    }

    internal static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "shared", "ui")) && Directory.Exists(Path.Combine(dir.FullName, "shared", "reaper")))
                return dir.FullName;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("Could not locate the Narration Utils repo root from " + AppContext.BaseDirectory);
    }

    private sealed class LaunchOptions
    {
        public required string SessionDir { get; init; }
        public string ProjectFolder { get; init; } = "";
        public string ProjectName { get; init; } = "";
        public string ManuscriptPython { get; init; } = "";
        public string ManuscriptBackend { get; init; } = "";
        public string ComparePython { get; init; } = "";
        public string CompareBackend { get; init; } = "";
        public List<string> Seed { get; init; } = new();
        public bool SmokeTest { get; init; }

        public HubArgs ToHubArgs() => new()
        {
            SessionDir = SessionDir, ProjectFolder = ProjectFolder, ProjectName = ProjectName,
            ManuscriptPython = ManuscriptPython, ManuscriptBackend = ManuscriptBackend,
            ComparePython = ComparePython, CompareBackend = CompareBackend, Seed = Seed,
        };
    }

    private static LaunchOptions ParseArgs(string[] args)
    {
        string? sessionDir = null, projectFolder = null, projectName = null;
        string? manuscriptPython = null, manuscriptBackend = null, comparePython = null, compareBackend = null;
        var seed = new List<string>();
        var smokeTest = false;

        for (var i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"Missing value for {args[i]}");
            switch (args[i])
            {
                case "--session-dir": sessionDir = Next(); break;
                case "--project-folder": projectFolder = Next(); break;
                case "--project-name": projectName = Next(); break;
                case "--manuscript-python": manuscriptPython = Next(); break;
                case "--manuscript-backend": manuscriptBackend = Next(); break;
                case "--compare-python": comparePython = Next(); break;
                case "--compare-backend": compareBackend = Next(); break;
                case "--seed": seed.Add(Next()); break;
                case "--smoke-test": smokeTest = true; break;
            }
        }

        if (sessionDir is null) throw new ArgumentException("--session-dir is required");
        return new LaunchOptions
        {
            SessionDir = sessionDir, ProjectFolder = projectFolder ?? "", ProjectName = projectName ?? "",
            ManuscriptPython = manuscriptPython ?? "", ManuscriptBackend = manuscriptBackend ?? "",
            ComparePython = comparePython ?? "", CompareBackend = compareBackend ?? "",
            Seed = seed, SmokeTest = smokeTest,
        };
    }
}

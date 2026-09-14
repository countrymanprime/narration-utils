using System.Runtime.InteropServices;
using Photino.NET;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("NarrationUtilsHub.Tests")]

namespace NarrationUtilsHub;

internal static class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    private const uint MB_ICONERROR = 0x10;

    // WebView2's async initialization is COM-driven and requires an STA
    // message pump on the hosting thread. A plain console/WinExe Main is MTA
    // by default (unlike WPF/WinForms templates, which apply this for you) -
    // without it, Photino creates a real, responding native window but the
    // WebView2 control never actually finishes initializing: no navigation,
    // no script execution ever happens, with no exception to catch anywhere.
    // Confirmed via an isolated minimal repro before landing this fix - it is
    // the entire root cause, not a deeper Photino reliability problem. This
    // requirement is specific to window/WebView2 creation; it does NOT extend
    // to the Kestrel API host below, which runs its own thread pool and is
    // deliberately kept off this thread (see StaDialog.cs for the one place a
    // native call still needs an STA thread of its own).
    [STAThread]
    private static void Main(string[] args)
    {
        var options = ParseArgs(args);
        Config.RepoRoot = FindRepoRoot();
        var diagnostics = new SessionDiagnostics(options.SessionDir);
        var uiDistDir = Path.GetFullPath(Path.Combine(Config.RepoRoot, "shared", "ui", "dist"));

        if (options.SmokeTest)
        {
            RunSmokeTest(options, diagnostics, uiDistDir);
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

        var audioDir = !string.IsNullOrEmpty(options.ProjectFolder) ? Path.Combine(options.ProjectFolder, "ManuscriptGuide", "audio") : null;
        var audioBaseUrlPlaceholder = ""; // resolved to a real base URL once the Kestrel host has an assigned port, below
        var hub = new Hub(options.ToHubArgs(audioBaseUrlPlaceholder), diagnostics);

        var window = new PhotinoWindow();
        window.SetTitle("Narration Utils");
        window.SetUseOsDefaultSize(false);
        window.SetSize(new System.Drawing.Size(1180, 780));
        window.SetMinSize(760, 560);

        // Native file-open dialogs must run on their own STA thread now that
        // HTTP requests (including this one) arrive on Kestrel thread-pool
        // threads rather than Photino's single native message-pump thread -
        // see StaDialog.cs.
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

        // Serve the UI bundle, API, and transcript event stream over loopback HTTP.
        var webApp = HubWebApp.Build(hub, uiDistDir, audioDir);
        string baseUrl;
        try
        {
            webApp.StartAsync().GetAwaiter().GetResult();
            baseUrl = webApp.Urls.First();
        }
        catch (Exception ex)
        {
            WriteStartupFailure($"Narration Utils could not start its desktop API: {ex.Message}");
            throw;
        }
        if (audioDir != null)
        {
            hub.GuideAudioBaseUrl = baseUrl.TrimEnd('/') + "/audio/";
            diagnostics.Event("audio_server_started", new Dictionary<string, object?> { ["url"] = hub.GuideAudioBaseUrl });
        }
        diagnostics.Event("local_server_started", new Dictionary<string, object?> { ["url"] = baseUrl });

        // Kestrel having finished starting (webApp.StartAsync already
        // returned, above) is itself the readiness signal - no need to poll
        // our own /api/health over loopback HTTP to find out what we already
        // know. This fires immediately instead of waiting up to 250ms for
        // the next poll tick.
        WriteStartupReady();

        window.WindowClosing += (_, _) => { hub.Close(); webApp.StopAsync().GetAwaiter().GetResult(); return false; };

        diagnostics.Event("webview_window_creating");
        window.Load(new Uri(baseUrl));
        diagnostics.Event("webview_starting");
        window.WaitForClose();
        diagnostics.Event("webview_stopped");
    }

    private static void RunSmokeTest(LaunchOptions options, SessionDiagnostics diagnostics, string uiDistDir)
    {
        var hub = new Hub(options.ToHubArgs(), diagnostics);
        var bootstrap = hub.Bootstrap();
        if ((int)(bootstrap["apiVersion"] ?? -1) != Hub.ApiVersion) throw new InvalidOperationException("Bootstrap API version mismatch");
        using var app = HubWebApp.Build(hub, uiDistDir, null);
        app.StartAsync().GetAwaiter().GetResult();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
            var health = client.GetAsync("/api/health").GetAwaiter().GetResult();
            if (!health.IsSuccessStatusCode) throw new InvalidOperationException("Smoke test could not reach /api/health.");
        }
        finally { app.StopAsync().GetAwaiter().GetResult(); }
        diagnostics.Event("smoke_test_passed");
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
        public string Daw { get; init; } = "";
        public string ManuscriptPython { get; init; } = "";
        public string ManuscriptBackend { get; init; } = "";
        public string ComparePython { get; init; } = "";
        public string CompareBackend { get; init; } = "";
        public List<string> Seed { get; init; } = new();
        public bool SmokeTest { get; init; }

        public HubArgs ToHubArgs(string audioBaseUrl = "") => new()
        {
            SessionDir = SessionDir, ProjectFolder = ProjectFolder, ProjectName = ProjectName, Daw = Daw,
            ManuscriptPython = ManuscriptPython, ManuscriptBackend = ManuscriptBackend,
            ComparePython = ComparePython, CompareBackend = CompareBackend, Seed = Seed,
            AudioBaseUrl = audioBaseUrl,
        };
    }

    private static LaunchOptions ParseArgs(string[] args)
    {
        string? sessionDir = null, projectFolder = null, projectName = null, daw = null;
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
                case "--daw": daw = Next(); break;
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
            SessionDir = sessionDir, ProjectFolder = projectFolder ?? "", ProjectName = projectName ?? "", Daw = daw ?? "",
            ManuscriptPython = manuscriptPython ?? "", ManuscriptBackend = manuscriptBackend ?? "",
            ComparePython = comparePython ?? "", CompareBackend = compareBackend ?? "",
            Seed = seed, SmokeTest = smokeTest,
        };
    }
}

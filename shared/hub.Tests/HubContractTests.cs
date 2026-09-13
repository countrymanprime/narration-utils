using System.Text.Json;

namespace NarrationUtilsHub.Tests;

/// <summary>Mirrors the contract check formerly in
/// shared/python/tests/test_ui_bridge_and_config.py's HostContractTests
/// (deleted alongside narration_hub.py) - the dispatcher must recognize every
/// name the frontend requires (shared/ui/src/state.ts's REQUIRED_API_METHODS),
/// and Bootstrap() must return the documented shape.</summary>
public sealed class HubContractTests
{
    private static HubArgs NewArgs(string sessionDir) => new()
    {
        SessionDir = sessionDir, ProjectFolder = "", ProjectName = "",
        ManuscriptPython = "", ManuscriptBackend = "", ComparePython = "", CompareBackend = "",
    };

    [Fact]
    public void DispatcherKnowsEveryPublicApiMethod()
    {
        var missing = Hub.PublicApiMethods.Where(name => !RpcDispatcher.IsKnownMethod(name)).ToList();
        Assert.Empty(missing);
    }

    [Fact]
    public void BootstrapReturnsDocumentedShapeAndDiagnosticsRecordLifecycleEvents()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        var session = Path.Combine(Path.GetTempPath(), "narration-utils-hub-tests-" + Guid.NewGuid());
        try
        {
            var diagnostics = new SessionDiagnostics(session);
            var hub = new Hub(NewArgs(session), diagnostics);

            var ready = hub.Ready();
            Assert.Equal(Hub.ApiVersion, ready["apiVersion"]);

            var bootstrap = hub.Bootstrap();
            Assert.Equal(Hub.ApiVersion, bootstrap["apiVersion"]);
            Assert.Equal(new DirectoryInfo(session).Name, bootstrap["diagnosticId"]);

            hub.Close();

            var records = File.ReadAllLines(diagnostics.Path)
                .Select(line => JsonDocument.Parse(line).RootElement.GetProperty("event").GetString())
                .ToList();
            Assert.Contains("bootstrap_completed", records);
            Assert.Contains("hub_close_requested", records);
        }
        finally { if (Directory.Exists(session)) Directory.Delete(session, recursive: true); }
    }
}

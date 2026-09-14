using System.Net.Http.Json;
using System.Text.Json;

namespace NarrationUtilsHub.Tests;

/// <summary>Exercises the live HTTP API contract end to end.</summary>
/// <remarks>Each test binds Kestrel to loopback and uses a real <see cref="HttpClient"/>.</remarks>
public sealed class HubContractTests
{
    private static HubArgs NewArgs(string sessionDir) => new()
    {
        SessionDir = sessionDir,
        ProjectFolder = "",
        ProjectName = "",
        ManuscriptPython = "",
        ManuscriptBackend = "",
        ComparePython = "",
        CompareBackend = "",
    };

    private static async Task<(Hub Hub, WebApplication App, HttpClient Client, string Session)> StartAsync()
    {
        Config.RepoRoot = Program.FindRepoRoot();
        var session = Path.Combine(Path.GetTempPath(), "narration-utils-hub-tests-" + Guid.NewGuid());
        var diagnostics = new SessionDiagnostics(session);
        var hub = new Hub(NewArgs(session), diagnostics);
        var app = HubWebApp.Build(hub, uiDistDir: Path.Combine(Path.GetTempPath(), "nonexistent-ui-dist-" + Guid.NewGuid()), audioDir: null);
        await app.StartAsync();
        var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };
        return (hub, app, client, session);
    }

    [Fact]
    public async Task HealthAndBootstrapReturnDocumentedShapeOverRealHttp()
    {
        var (hub, app, client, session) = await StartAsync();
        try
        {
            var health = await client.GetFromJsonAsync<JsonElement>("/api/health");
            Assert.Equal(Hub.ApiVersion, health.GetProperty("apiVersion").GetInt32());

            var bootstrap = await client.GetFromJsonAsync<JsonElement>("/api/bootstrap");
            Assert.Equal(Hub.ApiVersion, bootstrap.GetProperty("apiVersion").GetInt32());
            Assert.Equal(new DirectoryInfo(session).Name, bootstrap.GetProperty("diagnosticId").GetString());
            Assert.Equal("REAPER", bootstrap.GetProperty("daw").GetString());

            hub.Close();
            var records = File.ReadAllLines(hub.Diagnostics.Path)
                .Select(line => JsonDocument.Parse(line).RootElement.GetProperty("event").GetString())
                .ToList();
            Assert.Contains("bootstrap_completed", records);
            Assert.Contains("hub_close_requested", records);
        }
        finally { await app.StopAsync(); if (Directory.Exists(session)) Directory.Delete(session, recursive: true); }
    }

    [Fact]
    public async Task UnknownRouteReturnsNotFoundRatherThanSilentlySucceeding()
    {
        var (_, app, client, session) = await StartAsync();
        try
        {
            var response = await client.GetAsync("/api/does-not-exist");
            Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
        }
        finally { await app.StopAsync(); if (Directory.Exists(session)) Directory.Delete(session, recursive: true); }
    }
}

namespace NarrationUtilsHub;

/// <summary>Builds the Kestrel host for the API, UI, and preview audio.</summary>
public static class HubWebApp
{
    public static WebApplication Build(Hub hub, string uiDistDir, string? audioDir, string urls = "http://127.0.0.1:0")
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls(urls);
        builder.Logging.ClearProviders();
        var app = builder.Build();

        // Return a JSON error body the UI can display.
        app.Use(async (context, next) =>
        {
            try { await next(context); }
            catch (Exception ex)
            {
                hub.Diagnostics.Exception("api_request_failed_" + context.Request.Path, ex);
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsJsonAsync(new { error = ex.Message });
            }
        });

        if (Directory.Exists(uiDistDir))
        {
            var uiProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(uiDistDir);
            app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = uiProvider, RequestPath = "" });
            app.UseStaticFiles(new StaticFileOptions { FileProvider = uiProvider, RequestPath = "" });
        }

        if (!string.IsNullOrEmpty(audioDir))
        {
            Directory.CreateDirectory(audioDir);
            var audioProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(audioDir);
            app.UseStaticFiles(new StaticFileOptions { FileProvider = audioProvider, RequestPath = "/audio" });
        }

        app.MapHubApi(hub);

        return app;
    }
}

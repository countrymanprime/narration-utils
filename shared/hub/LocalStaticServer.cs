using System.Net;
using System.Net.Sockets;

namespace NarrationUtilsHub;

/// <summary>
/// Serves shared/ui/dist over loopback-only HTTP so WebView2 sees a real
/// http:// origin instead of file:// - Chromium refuses to execute Vite's
/// `&lt;script type="module"&gt;` bundle when loaded from file:// (treated as
/// cross-origin), which otherwise leaves the whole UI dark with no JS ever
/// running. This mirrors what pywebview's `http_server=True` option did for
/// the previous Python host.
/// </summary>
public sealed class LocalStaticServer
{
    private readonly string _rootDir;
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;

    public LocalStaticServer(string rootDir) => _rootDir = rootDir;

    /// <summary>Starts listening on an OS-assigned loopback port and returns
    /// the base URL (with a trailing slash).</summary>
    public string Start()
    {
        var port = ReserveLoopbackPort();
        var prefix = $"http://127.0.0.1:{port}/";
        _listener = new HttpListener();
        _listener.Prefixes.Add(prefix);
        _listener.Start();
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _ = Task.Run(() => AcceptLoop(_listener, token), token);
        return prefix;
    }

    public void Stop()
    {
        _cts?.Cancel();
        try { _listener?.Stop(); } catch (ObjectDisposedException) { }
        _listener?.Close();
    }

    private static int ReserveLoopbackPort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    private async Task AcceptLoop(HttpListener listener, CancellationToken token)
    {
        while (!token.IsCancellationRequested && listener.IsListening)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().ConfigureAwait(false); }
            catch (Exception) { return; } // listener stopped/disposed
            _ = Task.Run(() => Serve(context), token);
        }
    }

    private void Serve(HttpListenerContext context)
    {
        try
        {
            var requestedPath = context.Request.Url?.AbsolutePath.TrimStart('/') ?? "";
            if (string.IsNullOrEmpty(requestedPath)) requestedPath = "index.html";
            var fullPath = Path.GetFullPath(Path.Combine(_rootDir, requestedPath));
            if (!fullPath.StartsWith(_rootDir, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
            {
                context.Response.StatusCode = 404;
                context.Response.Close();
                return;
            }
            var bytes = File.ReadAllBytes(fullPath);
            context.Response.ContentType = ContentTypeFor(fullPath);
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.OutputStream.Close();
        }
        catch (Exception) { try { context.Response.Close(); } catch (Exception) { } }
    }

    private static string ContentTypeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html",
        ".js" => "text/javascript",
        ".css" => "text/css",
        ".json" => "application/json",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        _ => "application/octet-stream",
    };
}

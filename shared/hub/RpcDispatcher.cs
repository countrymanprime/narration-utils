using System.Text.Json;

namespace NarrationUtilsHub;

/// <summary>
/// Turns Photino's raw WebMessageReceived string channel into calls against
/// Hub's method surface. Photino has no per-method RPC binding (unlike
/// pywebview's js_api or Wails' generated bindings) - see
/// shared/ui/src/photinoBridge.ts for the matching frontend half of this
/// {id, method, args} protocol.
/// </summary>
public static class RpcDispatcher
{
    public static object? Dispatch(Hub hub, string method, JsonElement[] args)
    {
        switch (method)
        {
            case "ready": return hub.Ready();
            case "bootstrap": return hub.Bootstrap();
            case "poll": return hub.Poll(args.Length > 0 ? args[0].GetInt32() : 0);
            case "selectManuscript": return hub.SelectManuscript();
            case "saveSettings": return hub.SaveSettings(args[0].GetString()!, args[1].GetString()!, ToNullableStringDict(args[2]));
            case "guideBuild": return hub.GuideBuild();
            case "guideIndex": return hub.GuideIndex();
            case "guideEdit": hub.GuideEdit(args[0].GetString()!, ToStringDict(args[1]), ToStringList(args[2])); return null;
            case "guideExport": return hub.GuideExport();
            case "guidePreview": return hub.GuidePreview(args[0].GetString()!);
            case "transcriptStart": hub.TranscriptStart(ToStringDict(args[0])); return null;
            case "transcriptCancel": hub.TranscriptCancel(); return null;
            case "transcriptAddEquivalence": return hub.TranscriptAddEquivalence(args[0].GetString()!);
            case "transcriptJump": hub.TranscriptJump(args[0].GetString()!); return null;
            case "transcriptSuggestHints": return hub.TranscriptSuggestHints();
            case "reportClientDiagnostic": hub.ReportClientDiagnostic(args.Length > 0 ? args[0].GetString() ?? "" : "", args.Length > 1 ? args[1].GetString() ?? "" : ""); return null;
            default: throw new InvalidOperationException($"Unknown method: {method}");
        }
    }

    public static bool IsKnownMethod(string method) => Hub.PublicApiMethods.Contains(method);

    private static Dictionary<string, string> ToStringDict(JsonElement element)
    {
        var result = new Dictionary<string, string>();
        foreach (var prop in element.EnumerateObject())
            result[prop.Name] = prop.Value.ValueKind is JsonValueKind.String ? prop.Value.GetString()! : prop.Value.ToString();
        return result;
    }

    private static Dictionary<string, string?> ToNullableStringDict(JsonElement element)
    {
        var result = new Dictionary<string, string?>();
        foreach (var prop in element.EnumerateObject())
            result[prop.Name] = prop.Value.ValueKind == JsonValueKind.Null ? null : prop.Value.GetString();
        return result;
    }

    private static List<string> ToStringList(JsonElement element) => element.EnumerateArray().Select(e => e.GetString() ?? "").ToList();
}

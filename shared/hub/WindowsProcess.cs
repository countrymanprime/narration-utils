using System.Diagnostics;

namespace NarrationUtilsHub;

/// <summary>
/// Every launch of the Manuscript Guide / Transcript Compare tool venvs'
/// python.exe goes through here. This is the direct fix for the original
/// complaint: narration_hub.py shelled out to python.exe (not pythonw.exe)
/// via plain subprocess.run/Popen with no CREATE_NO_WINDOW, so a console
/// flashed on screen for every guide/transcript action. CreateNoWindow=true
/// here is the .NET equivalent, applied uniformly instead of patched on.
/// </summary>
public static class WindowsProcess
{
    private static ProcessStartInfo HiddenStartInfo(string fileName, IEnumerable<string> arguments, string? workingDirectory = null)
    {
        var info = new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (!string.IsNullOrEmpty(workingDirectory)) info.WorkingDirectory = workingDirectory;
        foreach (var arg in arguments) info.ArgumentList.Add(arg);
        return info;
    }

    /// <summary>Blocking run with captured output - mirrors subprocess.run(..., capture_output=True).
    /// Reads both streams concurrently before WaitForExit to avoid the classic
    /// deadlock where a child fills one pipe's buffer while the parent blocks
    /// reading the other.</summary>
    public static (int ExitCode, string StdOut, string StdErr) Run(string fileName, IEnumerable<string> arguments, string? workingDirectory = null)
    {
        using var process = Process.Start(HiddenStartInfo(fileName, arguments, workingDirectory))!;
        var stdOutTask = process.StandardOutput.ReadToEndAsync();
        var stdErrTask = process.StandardError.ReadToEndAsync();
        Task.WaitAll(stdOutTask, stdErrTask);
        process.WaitForExit();
        return (process.ExitCode, stdOutTask.Result, stdErrTask.Result);
    }

    /// <summary>Detached, long-running child whose own output is discarded - mirrors
    /// subprocess.Popen(..., stdout=DEVNULL, stderr=DEVNULL). Output is drained
    /// asynchronously (not left unread) so a chatty child (e.g. tqdm progress on
    /// stderr during a long Whisper transcription) can't deadlock on a full pipe.</summary>
    public static Process StartDetachedSilently(string fileName, IEnumerable<string> arguments, string? workingDirectory = null)
    {
        var process = new Process { StartInfo = HiddenStartInfo(fileName, arguments, workingDirectory), EnableRaisingEvents = true };
        process.OutputDataReceived += (_, _) => { };
        process.ErrorDataReceived += (_, _) => { };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return process;
    }
}

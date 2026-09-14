using System.Diagnostics;

namespace NarrationUtilsHub;

/// <summary>Starts Python subprocesses without creating a console window.</summary>
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

    /// <summary>Runs a process and captures standard output and error.</summary>
    /// <remarks>Both streams are read concurrently to avoid pipe-buffer deadlock.</remarks>
    public static (int ExitCode, string StdOut, string StdErr) Run(string fileName, IEnumerable<string> arguments, string? workingDirectory = null)
    {
        using var process = Process.Start(HiddenStartInfo(fileName, arguments, workingDirectory))!;
        var stdOutTask = process.StandardOutput.ReadToEndAsync();
        var stdErrTask = process.StandardError.ReadToEndAsync();
        Task.WaitAll(stdOutTask, stdErrTask);
        process.WaitForExit();
        return (process.ExitCode, stdOutTask.Result, stdErrTask.Result);
    }

    /// <summary>Starts a detached process and drains its output.</summary>
    /// <remarks>Draining both streams prevents pipe-buffer deadlock.</remarks>
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

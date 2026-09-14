namespace NarrationUtilsHub;

/// <summary>
/// Runs a native common-dialog call (e.g. PhotinoWindow.ShowOpenFile) on a
/// dedicated STA thread. Needed because HTTP requests are now handled on
/// Kestrel thread-pool (MTA) threads instead of Photino's single native
/// message-pump thread that used to service every WebMessageReceived call -
/// Win32/COM file dialogs throw ThreadStateException off an MTA thread. This
/// spins up one throwaway STA thread per call rather than routing through the
/// main window thread, since the dialog only needs *an* STA thread plus the
/// owner HWND (already captured in the closure passed in), not specifically
/// the thread that created the window. See Program.cs's [STAThread] comment
/// for the earlier, related WebView2-initialization STA lesson this mirrors.
/// </summary>
public static class StaDialog
{
    public static T Run<T>(Func<T> showDialog)
    {
        T result = default!;
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try { result = showDialog(); }
            catch (Exception ex) { error = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error != null) throw error;
        return result;
    }
}

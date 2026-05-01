using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    private const int SW_RESTORE = 9;
    private const int SW_MINIMIZE = 6;

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            return 1;
        }

        var action = (args[0] ?? string.Empty).Trim().ToLowerInvariant();
        int processId;
        if (!int.TryParse(args[1], out processId) || processId <= 0)
        {
            return 1;
        }

        var focus = args.Length >= 3 && (args[2] == "1" || string.Equals(args[2], "true", StringComparison.OrdinalIgnoreCase));
        var handle = WaitForMainWindow(processId);
        if (handle == IntPtr.Zero)
        {
            return 1;
        }

        switch (action)
        {
            case "show":
                ShowWindowAsync(handle, SW_RESTORE);
                if (focus)
                {
                    SetForegroundWindow(handle);
                }
                return 0;

            case "hide":
                ShowWindowAsync(handle, SW_MINIMIZE);
                return 0;

            default:
                return 1;
        }
    }

    private static IntPtr WaitForMainWindow(int processId)
    {
        for (var i = 0; i < 20; i += 1)
        {
            try
            {
                var process = Process.GetProcessById(processId);
                if (process.MainWindowHandle != IntPtr.Zero)
                {
                    return process.MainWindowHandle;
                }
            }
            catch
            {
                return IntPtr.Zero;
            }

            Thread.Sleep(20);
        }

        return IntPtr.Zero;
    }
}

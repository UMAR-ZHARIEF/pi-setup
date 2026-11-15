using System;
using System.Diagnostics;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Git Bash")]
[assembly: AssemblyProduct("Git Bash")]
[assembly: AssemblyVersion("1.3.0.0")]

static class Program {
    [STAThread]
    static void Main() {
        var psi = new ProcessStartInfo(@"C:\Program Files\Git\usr\bin\mintty.exe") {
            Arguments = @"--nodaemon --Title ""Git Bash"" -i ""C:\Program Files\Git\mingw64\share\git\git-for-windows.ico"" /usr/bin/bash --login -i",
            UseShellExecute = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        var p = Process.Start(psi);
        var f = new Form { Text = "Git Bash", ShowInTaskbar = false, WindowState = FormWindowState.Minimized, Opacity = 0 };
        f.Load += (s, e) => { f.Hide(); };
        var t = new Timer { Interval = 2000 };
        t.Tick += (s, e) => { if (p.HasExited) f.Close(); };
        t.Start();
        Application.Run(f);
    }
}

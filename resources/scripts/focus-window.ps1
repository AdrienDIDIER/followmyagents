# Met au premier plan une fenêtre de premier niveau appartenant à un processus
# donné (par défaut VS Code : Code.exe) et dont le titre contient un texte.
# Contourne la protection anti-vol de focus de Windows (touche ALT simulée).
#
# Usage : powershell -NoProfile -ExecutionPolicy Bypass -File focus-window.ps1 -Process Code -TitleContains "MonProjet"
# Sortie : "FOCUSED <titre>" ou "NOTFOUND".
param([string]$Process = "Code", [string]$TitleContains = "")
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class FmaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static List<KeyValuePair<IntPtr,string>> List(HashSet<uint> pids) {
    var r = new List<KeyValuePair<IntPtr,string>>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length > 0) r.Add(new KeyValuePair<IntPtr,string>(h, sb.ToString()));
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
Get-Process -Name $Process -ErrorAction SilentlyContinue | ForEach-Object { [void]$pids.Add([uint32]$_.Id) }
$wins = [FmaWin]::List($pids)
$target = $null
if ($TitleContains -ne "") { $target = $wins | Where-Object { $_.Value -like "*$TitleContains*" } | Select-Object -First 1 }
if (-not $target) { $target = $wins | Select-Object -First 1 }
if (-not $target) { Write-Output "NOTFOUND"; exit 1 }
$h = $target.Key
if ([FmaWin]::IsIconic($h)) { [void][FmaWin]::ShowWindow($h, 9) }
[FmaWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[FmaWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[void][FmaWin]::SetForegroundWindow($h)
Write-Output ("FOCUSED " + $target.Value)

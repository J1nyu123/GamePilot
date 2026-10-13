$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class GPWindow {
 public string id, title, processName, identity;
 public bool minimized, foreground;
 public int width, height;
}
public static class GPWindows {
 delegate bool EnumProc(IntPtr h, IntPtr p);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 public static bool Focus(long handle, string identity) {
  var w=Info(handle); if(w==null || w.identity!=identity || w.minimized) return false;
  return SetForegroundWindow(new IntPtr(handle));
 }
 public static GPWindow Info(long handle) {
  var h=new IntPtr(handle);
  if(!IsWindow(h)||!IsWindowVisible(h)) return null;
  var text=new StringBuilder(1024); GetWindowText(h,text,text.Capacity);
  if(text.Length==0) return null;
  uint pid; GetWindowThreadProcessId(h,out pid);
  string processName="unknown", started="unknown";
  try { using(var p=Process.GetProcessById((int)pid)) { processName=p.ProcessName; started=p.StartTime.ToUniversalTime().Ticks.ToString(); } } catch { return null; }
  Rect r; GetWindowRect(h,out r);
  return new GPWindow {id="window:"+handle+":0",title=text.ToString(),processName=processName,
   identity=handle+":"+pid+":"+started,minimized=IsIconic(h),foreground=GetForegroundWindow()==h,width=r.right-r.left,height=r.bottom-r.top};
 }
 public static GPWindow[] List() {
  var result=new List<GPWindow>();
  EnumWindows((h,p)=>{try {var w=Info(h.ToInt64());if(w!=null) result.Add(w);}catch{}return true;},IntPtr.Zero);
  return result.ToArray();
 }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
    try {
        $req = $line | ConvertFrom-Json
        if ($req.op -eq 'list') { $value = @([GPWindows]::List()) }
        elseif ($req.op -eq 'info' -and [string]$req.handle -match '^\d+$') { $value = [GPWindows]::Info([long]$req.handle) }
        elseif ($req.op -eq 'focus' -and [string]$req.handle -match '^\d+$') { $value = [GPWindows]::Focus([long]$req.handle, [string]$req.identity) }
        else { throw 'Unsupported window query' }
        [Console]::WriteLine((@{ id=$req.id; ok=$true; value=$value } | ConvertTo-Json -Compress -Depth 5))
    } catch { [Console]::WriteLine((@{ id=$req.id; ok=$false; error='Window query failed' } | ConvertTo-Json -Compress)) }
}

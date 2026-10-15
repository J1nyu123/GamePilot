$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
public static class GPKeyboard {
 [StructLayout(LayoutKind.Sequential)] struct Input { public uint type; public Union data; }
 [StructLayout(LayoutKind.Explicit)] struct Union { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
 [StructLayout(LayoutKind.Sequential)] struct Keyboard { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct Mouse { public int x,y; public uint data, flags, time; public UIntPtr extra; }
 [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
 [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 static void Key(ushort vk, bool up) {
  var input = new Input { type=1, data=new Union { keyboard=new Keyboard { scan=(ushort)MapVirtualKey(vk,0), flags=(uint)(8 | (up?2:0) | (vk>=37 && vk<=40?1:0)) } } };
  if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1) throw new Exception("SendInput rejected (check game/app privilege levels)");
 }
 static bool Valid(IntPtr h, string identity) {
  uint pid; GetWindowThreadProcessId(h,out pid);
  try { using(var p=Process.GetProcessById((int)pid)) return identity==h.ToInt64()+":"+pid+":"+p.StartTime.ToUniversalTime().Ticks && !IsIconic(h) && GetForegroundWindow()==h; } catch { return false; }
 }
 public static void Run(long handle, string identity, ushort[] keys, int duration) {
  if(duration<20 || duration>1000 || keys.Length<1 || keys.Length>3) throw new Exception("Invalid action");
  var h=new IntPtr(handle);
  var canceled=Task.Run(()=>Console.ReadLine());
  var held=new System.Collections.Generic.List<ushort>();
  try {
   if(canceled.Wait(20)) throw new Exception("Canceled before input");
   foreach(var k in keys) { if(!Valid(h,identity) || canceled.IsCompleted) throw new Exception("Game focus lost or canceled"); held.Add(k); Key(k,false); }
   var clock=Stopwatch.StartNew();
   while(clock.ElapsedMilliseconds<duration) { if(canceled.IsCompleted || !Valid(h,identity)) throw new Exception("Game focus lost or canceled"); Thread.Sleep(10); }
  } finally { Exception failure=null; foreach(var k in held) { try { Key(k,true); } catch(Exception e) { failure=e; } } if(failure!=null) throw failure; }
 }
}
'@
try {
 $req = [Console]::ReadLine() | ConvertFrom-Json
 $map = @{ W=87; A=65; S=83; D=68; E=69; F=70; Q=81; R=82; SPACE=32; SHIFT=16; ESC=27; ENTER=13; UP=38; DOWN=40; LEFT=37; RIGHT=39 }
 $keys = @($req.keys | ForEach-Object { if (!$map.ContainsKey($_)) { throw 'Invalid key' }; [uint16]$map[$_] })
 [GPKeyboard]::Run([long]$req.handle, [string]$req.identity, [uint16[]]$keys, [int]$req.durationMs)
 [Console]::WriteLine('{"ok":true,"released":true,"backend":"win32-sendinput"}')
} catch { [Console]::WriteLine((@{ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress)) }

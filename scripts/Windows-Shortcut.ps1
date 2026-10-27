# Explicit Unicode IShellLink persistence also works on non-Chinese Windows.
function Initialize-ThemeShortcut {
    if(-not ('ArkWorkspace.ShortcutsV2.UnicodeShortcut' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
namespace ArkWorkspace.ShortcutsV2 {
 [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLinkClass {}
 [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IShellLinkW {
  void GetPath([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder text,int length,IntPtr data,uint flags);
  void GetIDList(out IntPtr id);
  void SetIDList(IntPtr id);
  void GetDescription([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder text,int length);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetWorkingDirectory([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder text,int length);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetArguments([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder text,int length);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetHotkey(out short value);
  void SetHotkey(short value);
  void GetShowCmd(out int value);
  void SetShowCmd(int value);
  void GetIconLocation([Out,MarshalAs(UnmanagedType.LPWStr)] StringBuilder text,int length,out int index);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string text,int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string text,uint flags);
  void Resolve(IntPtr window,uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string text);
 }
 public class ShortcutData { public string TargetPath; public string Arguments; public string WorkingDirectory; public string Description; public string IconLocation; }
 public static class UnicodeShortcut {
  public static ShortcutData Read(string file) {
   object value=new ShellLinkClass();
   try {
    ((IPersistFile)value).Load(Path.GetFullPath(file),0);IShellLinkW link=(IShellLinkW)value;
    StringBuilder target=new StringBuilder(32768),args=new StringBuilder(32768),directory=new StringBuilder(32768),description=new StringBuilder(4096),icon=new StringBuilder(32768);int index;
    link.GetPath(target,target.Capacity,IntPtr.Zero,4);link.GetArguments(args,args.Capacity);link.GetWorkingDirectory(directory,directory.Capacity);link.GetDescription(description,description.Capacity);link.GetIconLocation(icon,icon.Capacity,out index);
    return new ShortcutData {TargetPath=Environment.ExpandEnvironmentVariables(target.ToString()),Arguments=args.ToString(),WorkingDirectory=directory.ToString(),Description=description.ToString(),IconLocation=icon.ToString()+","+index};
   } finally { Marshal.FinalReleaseComObject(value); }
  }
  public static void Save(string file,string target,string args,string directory,string description,string icon) {
   file=Path.GetFullPath(file);Directory.CreateDirectory(Path.GetDirectoryName(file));
   object value=new ShellLinkClass();
   try {
    IShellLinkW link=(IShellLinkW)value;link.SetPath(target);link.SetArguments(args??"");
    link.SetWorkingDirectory(directory??"");link.SetDescription(description??"");link.SetShowCmd(1);
    if(!String.IsNullOrEmpty(icon))link.SetIconLocation(icon,0);
    ((IPersistFile)value).Save(file,true);
   } finally { Marshal.FinalReleaseComObject(value); }
  }
 }
}
'@
    }
}
function Save-ThemeShortcut {
    param([string]$Path,[string]$TargetPath,[string]$Arguments,[string]$WorkingDirectory,[string]$Description,[string]$IconPath)
    Initialize-ThemeShortcut
    [ArkWorkspace.ShortcutsV2.UnicodeShortcut]::Save($Path,$TargetPath,$Arguments,$WorkingDirectory,$Description,$IconPath)
}
function Get-ThemeShortcut {
    param([string]$Path)
    Initialize-ThemeShortcut
    [ArkWorkspace.ShortcutsV2.UnicodeShortcut]::Read($Path)
}

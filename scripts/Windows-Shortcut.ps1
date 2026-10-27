# Explicit Unicode IShellLink persistence also works on non-Chinese Windows.
function Save-ThemeShortcut {
    param([string]$Path,[string]$TargetPath,[string]$Arguments,[string]$WorkingDirectory,[string]$Description,[string]$IconPath)
    if(-not ('ArkWorkspace.UnicodeShortcut' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
namespace ArkWorkspace {
 [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLinkClass {}
 [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface IShellLinkW {
  void GetPath(IntPtr text,int length,IntPtr data,uint flags);
  void GetIDList(out IntPtr id);
  void SetIDList(IntPtr id);
  void GetDescription(IntPtr text,int length);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetWorkingDirectory(IntPtr text,int length);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetArguments(IntPtr text,int length);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
  void GetHotkey(out short value);
  void SetHotkey(short value);
  void GetShowCmd(out int value);
  void SetShowCmd(int value);
  void GetIconLocation(IntPtr text,int length,out int index);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string text,int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string text,uint flags);
  void Resolve(IntPtr window,uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)] string text);
 }
 public static class UnicodeShortcut {
  public static void Save(string file,string target,string args,string directory,string description,string icon) {
   file=Path.GetFullPath(file);Directory.CreateDirectory(Path.GetDirectoryName(file));
   object value=new ShellLinkClass();
   try {
    IShellLinkW link=(IShellLinkW)value;link.SetPath(target);link.SetArguments(args??"");
    link.SetWorkingDirectory(directory??"");link.SetDescription(description??"");
    if(!String.IsNullOrEmpty(icon))link.SetIconLocation(icon,0);
    ((IPersistFile)value).Save(file,true);
   } finally { Marshal.FinalReleaseComObject(value); }
  }
 }
}
'@
    }
    [ArkWorkspace.UnicodeShortcut]::Save($Path,$TargetPath,$Arguments,$WorkingDirectory,$Description,$IconPath)
}

using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace ArkWorkspace {
  public class LaunchStatus {
    public string launchId {get;set;}
    public int pid {get;set;}
    public int phase {get;set;}
    public bool themeReady {get;set;}
    public bool clientReady {get;set;}
    public bool finished {get;set;}
    public string message {get;set;}
  }
  public sealed class BootWindow : Window {
    readonly string root, id=Guid.NewGuid().ToString("N"), fixture;
    readonly bool hidden;
    readonly Stopwatch clock=Stopwatch.StartNew();
    readonly DispatcherTimer lifecycle=new DispatcherTimer {Interval=TimeSpan.FromMilliseconds(80)};
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    readonly EventWaitHandle activate;
    readonly Grid canvas=new Grid();
    readonly TextBlock fallback=new TextBlock {Text="CODEX\n正在启动工作空间…",Foreground=Brushes.White,FontSize=24,TextAlignment=TextAlignment.Center,VerticalAlignment=VerticalAlignment.Center};
    WebView2CompositionControl web;
    LaunchStatus status=new LaunchStatus {message="正在启动 Codex"};
    string resultPath,lastResult="",error="";
    bool closed,uiReady,completed,skipped,failed,fading,captured,prepared,enteredClient;
    double fadeAt=-1,finishedAt=-1,uiAt=-1;
    IntPtr target;
    object metrics;
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h,int command);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);

    public BootWindow(string projectRoot,string test,bool isHidden,EventWaitHandle activation) {
      root=projectRoot;fixture=test;hidden=isHidden;activate=activation;
      string iconPath=Path.Combine(root,"dist","ChatGPT-Launcher.ico");
      if(File.Exists(iconPath)){
        using(var stream=File.OpenRead(iconPath)){
          var decoder=new System.Windows.Media.Imaging.IconBitmapDecoder(stream,System.Windows.Media.Imaging.BitmapCreateOptions.PreservePixelFormat,System.Windows.Media.Imaging.BitmapCacheOption.OnLoad);
          Icon=decoder.Frames.OrderByDescending(frame=>frame.PixelWidth).First();
        }
      }
      Title="CODEX · 启动";Width=1280;Height=720;WindowStyle=WindowStyle.None;ResizeMode=ResizeMode.NoResize;
      AllowsTransparency=true;Background=new SolidColorBrush(Color.FromRgb(6,8,10));ShowInTaskbar=!hidden;ShowActivated=!hidden;
      Topmost=fixture==null&&!hidden;
      Deactivated+=(s,e)=>Dispatcher.BeginInvoke(new Action(()=>{
        if(closed||!Topmost)return;
        uint frontPid;GetWindowThreadProcessId(GetForegroundWindow(),out frontPid);
        try{using(var process=Process.GetProcessById((int)frontPid)){if(process.ProcessName!="ChatGPT"&&process.ProcessName!="Codex")Topmost=false;}}catch{Topmost=false;}
      }),DispatcherPriority.Background);
      WindowStartupLocation=WindowStartupLocation.CenterScreen;
      if(hidden){WindowStartupLocation=WindowStartupLocation.Manual;Left=-20000;Top=0;}
      canvas.Children.Add(fallback);Content=canvas;
      SourceInitialized+=(s,e)=>{
        if(fixture==null&&!hidden){var bounds=System.Windows.Forms.Screen.FromPoint(System.Windows.Forms.Cursor.Position).Bounds;SetWindowPos(new WindowInteropHelper(this).Handle,IntPtr.Zero,bounds.X,bounds.Y,bounds.Width,bounds.Height,0x14);}
      };
      Loaded+=(s,e)=>{BeginService();InitWeb();};
      PreviewKeyDown+=(s,e)=>{if(e.Key==Key.Escape){e.Handled=true;Skip();}};
      lifecycle.Tick+=Tick;lifecycle.Start();Closed+=(s,e)=>Cleanup();
    }
    void BeginService() {
      if(fixture!=null)return;
      try {
        resultPath=Path.Combine(root,".local","boot-result-"+id+".json");
        var info=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+Path.Combine(root,"scripts","Start-Boot-Service.ps1")+"\" -ResultFile \""+resultPath+"\" -LaunchId "+id);
        info.UseShellExecute=false;info.CreateNoWindow=true;info.WorkingDirectory=root;
        // Skipping the animation must not cancel wallpaper restoration.
        using(var child=Process.Start(info)) {}
      } catch(Exception ex){Fail(ex.Message);}
    }
    async void InitWeb() {
      try {
        web=new WebView2CompositionControl {DefaultBackgroundColor=System.Drawing.Color.FromArgb(255,6,8,10),AllowExternalDrop=false};
        canvas.Children.Add(web);
        var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,".local","boot-webview"));
        if(closed)return;
        await web.EnsureCoreWebView2Async(environment);
        if(closed)return;
        var core=web.CoreWebView2;
        core.Settings.AreDevToolsEnabled=false;core.Settings.AreDefaultContextMenusEnabled=false;core.Settings.IsStatusBarEnabled=false;
        core.Settings.AreHostObjectsAllowed=false;core.Settings.IsZoomControlEnabled=false;core.Settings.IsBuiltInErrorPageEnabled=false;
        core.SetVirtualHostNameToFolderMapping("ark-boot.local",Path.Combine(root,"launcher","ui"),CoreWebView2HostResourceAccessKind.Deny);
        core.NavigationStarting+=(s,e)=>{if(e.Uri!="https://ark-boot.local/index.html")e.Cancel=true;};
        core.NewWindowRequested+=(s,e)=>{e.Handled=true;};
        core.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};
        core.DownloadStarting+=(s,e)=>{e.Cancel=true;};
        core.ProcessFailed+=(s,e)=>Fail("动画进程退出："+e.ProcessFailedKind);
        core.WebMessageReceived+=Message;core.Navigate("https://ark-boot.local/index.html");
      } catch(Exception ex){
        if(closed)return;error="动画初始化失败："+ex.Message;
        if(web!=null){canvas.Children.Remove(web);web.Dispose();web=null;}
        fallback.Text="CODEX\n正在连接工作空间…\nEsc 跳过动画";
        // Native lifecycle also works when WebView2 cannot initialize.
      }
    }
    void Send(object data){if(uiReady&&web!=null&&!closed)try{web.CoreWebView2.PostWebMessageAsJson(json.Serialize(data));}catch(Exception ex){error=ex.Message;}}
    void SendStatus(){Send(new {type="status",launchId=id,phase=status.phase,message=status.message,ready=status.themeReady&&target!=IntPtr.Zero});}
    void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e) {
      if(closed||e.Source!="https://ark-boot.local/index.html")return;
      try {
        var data=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);string type=Convert.ToString(data["type"]);
        if(type=="ui-ready"&&!uiReady){uiReady=true;uiAt=clock.Elapsed.TotalSeconds;fallback.Visibility=Visibility.Collapsed;Send(new {type="start",launchId=id,reduced=!SystemParameters.ClientAreaAnimation});SendStatus();return;}
        if(!data.ContainsKey("launchId")||Convert.ToString(data["launchId"])!=id)return;
        if(data.ContainsKey("metrics"))metrics=data["metrics"];
        if(type=="skip")Skip();
        if(type=="handoff-start"&&status.themeReady)PrepareTarget();
        if(type=="handoff-ready"&&status.themeReady){completed=true;Fade();}
      } catch(Exception ex){error="动画消息无效："+ex.Message;}
    }
    void ReadStatus() {
      if(resultPath==null||!File.Exists(resultPath))return;
      try {
        string text=File.ReadAllText(resultPath,Encoding.UTF8).TrimStart('\uFEFF');if(text==lastResult)return;
        var next=json.Deserialize<LaunchStatus>(text);if(next==null||next.launchId!=id)return;
        lastResult=text;status=next;if(status.finished&&finishedAt<0)finishedAt=clock.Elapsed.TotalSeconds;
      } catch(IOException){} catch(ArgumentException){}
    }
    void LocateTarget() {
      if(status.pid<=0||target!=IntPtr.Zero)return;
      try{using(var process=Process.GetProcessById(status.pid)){process.Refresh();target=process.MainWindowHandle;}}catch(ArgumentException){}
    }
    void PrepareTarget() {
      if(prepared||target==IntPtr.Zero||hidden||fixture!=null)return;
      var mine=new WindowInteropHelper(this).Handle;
      // Never steal focus after the user deliberately switches to another app.
      if(GetForegroundWindow()!=mine&&GetForegroundWindow()!=target)return;
      if(IsIconic(target))ShowWindowAsync(target,4);
      // Do not insert the client after the topmost splash: Windows can promote
      // it into the topmost band and leave dialogs/other apps behind it.
      // Keep both its Z order and its owner's Z order; focus is handed off once below.
      SetWindowPos(target,IntPtr.Zero,0,0,0,0,0x257); // NOSIZE | NOMOVE | NOZORDER | NOACTIVATE | SHOWWINDOW | NOOWNERZORDER
      prepared=true;
    }
    void Skip(){if(closed||skipped)return;skipped=true;LocateTarget();Fade();}
    void Fade(){if(fading||closed)return;PrepareTarget();fading=true;fadeAt=clock.Elapsed.TotalSeconds;Send(new {type="dispose",launchId=id});}
    void Fail(string message){if(closed)return;failed=true;error=message;status.message=message+" · 即将退出启动页";status.finished=true;if(finishedAt<0)finishedAt=clock.Elapsed.TotalSeconds;fallback.Text="CODEX\n"+status.message;SendStatus();}
    async void Capture() {
      if(captured||web==null||!uiReady)return;captured=true;
      try{using(var output=File.Create(Path.Combine(root,"test-results","boot-native-"+fixture+".png")))await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,output);}catch(Exception ex){error=ex.Message;}
    }
    void Tick(object sender,EventArgs e) {
      if(closed)return;double elapsed=clock.Elapsed.TotalSeconds;
      if(activate.WaitOne(0)&&!hidden){Activate();SetForegroundWindow(new WindowInteropHelper(this).Handle);}
      if(fixture==null){ReadStatus();LocateTarget();}else{
        if(uiReady&&elapsed-uiAt>1.9)Capture();
        if(fixture=="skip"&&uiReady&&elapsed-uiAt>.7)Skip();
        if(fixture=="failure"&&uiReady&&elapsed-uiAt>1.5&&!failed)Fail("测试：素材服务不可用");
        if(fixture!="failure"&&fixture!="timeout"&&fixture!="skip"&&uiReady&&elapsed-uiAt>(fixture=="delay"?7:1)){
          status.themeReady=true;status.phase=3;status.message="壁纸已就绪 · 正在进入";status.finished=true;target=new IntPtr(1);if(finishedAt<0)finishedAt=elapsed;
        }
      }
      if(uiReady)SendStatus();
      if(status.finished&&!status.themeReady&&finishedAt>=0&&elapsed-finishedAt>3){
        enteredClient=status.clientReady&&target!=IntPtr.Zero;
        failed=!enteredClient;error=status.message??"";Fade();
      }
      if(status.themeReady&&target!=IntPtr.Zero&&!uiReady&&elapsed>4){completed=true;Fade();}
      // An occluded/stalled renderer cannot strand the native window.
      if(status.themeReady&&finishedAt>=0&&elapsed-finishedAt>9){completed=true;Fade();}
      if(elapsed>(fixture=="timeout"?7:50)){if(!failed)Fail("连接超时，Codex 将继续运行");Fade();}
      if(fading){Opacity=Math.Max(0,1-(elapsed-fadeAt)/.45);if(elapsed-fadeAt>=.45){
        if(fixture==null&&target!=IntPtr.Zero&&!hidden&&GetForegroundWindow()==new WindowInteropHelper(this).Handle)SetForegroundWindow(target);
        Close();
      }}
    }
    void Cleanup() {
      if(closed)return;closed=true;lifecycle.Stop();
      try{if(web!=null){web.Dispose();web=null;}}catch{}
      try {
        string text=json.Serialize(new {launchId=id,fixture=fixture,skipped=skipped,completed=completed,enteredClient=enteredClient||completed,failed=failed,themeReady=status.themeReady,pid=status.pid,uiReady=uiReady,uiReadySeconds=uiAt,elapsedSeconds=clock.Elapsed.TotalSeconds,error=error,metrics=metrics,webViewDisposed=true});
        File.WriteAllText(Path.Combine(root,".local",fixture==null?"launcher-last-run.json":"launcher-test-"+fixture+".json"),text,Encoding.UTF8);
      } catch{}
    }
  }
  static class Program {
    [STAThread] static int Main(string[] args) {
      string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
      string fixture=args.FirstOrDefault(x=>x.StartsWith("--test="));if(fixture!=null)fixture=fixture.Substring(7);
      if(args.Contains("--preview"))fixture="ready";
      if(args.Contains("--render"))return 2;
      if(fixture!=null&&!new[]{"ready","delay","failure","skip","timeout"}.Contains(fixture))return 2;
      string key="Local\\ArkBoot-"+System.Security.Principal.WindowsIdentity.GetCurrent().User.Value+(fixture==null?"":"-test-"+fixture);
      bool created;
      using(var mutex=new Mutex(true,key,out created))using(var activation=new EventWaitHandle(false,EventResetMode.AutoReset,key+"-activate")){
        if(!created){activation.Set();return 0;}
        try{Directory.CreateDirectory(Path.Combine(root,".local"));Directory.CreateDirectory(Path.Combine(root,"test-results"));var app=new Application();app.Run(new BootWindow(root,fixture,args.Contains("--test-hidden"),activation));return 0;}
        catch(Exception e){File.WriteAllText(Path.Combine(root,".local","launcher-error.log"),e.ToString());return 1;}
        finally{mutex.ReleaseMutex();}
      }
    }
  }
}

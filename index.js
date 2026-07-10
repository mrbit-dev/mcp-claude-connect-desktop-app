#!/usr/bin/env node

/**
 * MCP Desktop - Claude Code Desktop Interaction Tools 🖥️
 *
 * MCP server cung cấp các tool tương tác với Windows desktop
 * Giúp Claude Code mở ứng dụng, chụp màn hình, OCR, quản lý cửa sổ,
 * tìm kiếm file, điều khiển media, v.v.
 *
 * GitHub: https://github.com/mrbit-dev/mcp-claude-connect-desktop-app
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const SCREENSHOT_DIR = path.join(os.tmpdir(), "mcp-desktop-screenshots");
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ──────────────────────────────────────────────
// PowerShell helpers
// ──────────────────────────────────────────────

function runPowerShell(script, timeout = 15000) {
  const output = execSync(
    `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
    { encoding: "utf8", timeout }
  );
  return output.trim();
}

function parseJsonOrArray(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function psEscape(str) {
  return str.replace(/'/g, "''");
}

// ──────────────────────────────────────────────
// 1. CÔNG CỤ CŨ (CẢI TIẾN)
// ──────────────────────────────────────────────

function getRunningApps() {
  const raw = runPowerShell(`
    Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
    Select-Object Name, @{N='Title';E={$_.MainWindowTitle}}, @{N='PID';E={$_.Id}} |
    ConvertTo-Json -Compress
  `, 10000);
  return parseJsonOrArray(raw);
}

function getAvailableApps() {
  const raw = runPowerShell(
    `$paths = @(
      [Environment]::GetFolderPath('CommonStartMenu') + '\\Programs',
      [Environment]::GetFolderPath('StartMenu') + '\\Programs'
    );
    $apps = @();
    foreach ($p in $paths) {
      if (Test-Path $p) {
        Get-ChildItem $p -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
          ForEach-Object { $apps += @{Name = $_.BaseName; Path = $_.FullName} }
      }
    };
    Get-Command -CommandType Application -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '\\.(exe|cmd|ps1)$' } |
      ForEach-Object { $apps += @{Name = $_.Name -replace '\\.(exe|cmd|ps1)$', ''; Path = $_.Source} };
    $apps | Sort-Object Name -Unique | ConvertTo-Json -Compress`,
    15000
  );
  return parseJsonOrArray(raw);
}

function launchApp(appName, args = "") {
  const cmd = args
    ? `Start-Process "${psEscape(appName)}" -ArgumentList '${psEscape(args)}'`
    : `Start-Process "${psEscape(appName)}"`;
  runPowerShell(cmd, 10000);
  return `✅ Đã mở: ${appName}${args ? ` (${args})` : ""}`;
}

function searchFiles(query, dir = process.env.USERPROFILE || "C:\\") {
  const raw = runPowerShell(
    `Get-ChildItem -Path '${psEscape(dir)}' -Filter '*${psEscape(query)}*' -Recurse -ErrorAction SilentlyContinue |
      Where-Object { !$_.PSIsContainer } |
      Select-Object -First 30 FullName, Length, LastWriteTime |
      ForEach-Object {
        $size = if ($_.Length -gt 1MB) { '{0:N1} MB' -f ($_.Length / 1MB) }
          elseif ($_.Length -gt 1KB) { '{0:N1} KB' -f ($_.Length / 1KB) }
          else { '{0} B' -f $_.Length };
        [PSCustomObject]@{ Path = $_.FullName; Size = $size; Modified = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }
      } | ConvertTo-Json -Compress`,
    30000
  );
  return parseJsonOrArray(raw);
}

function browserSearch(query, engine = "google") {
  const searchUrls = {
    google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  };
  const url = searchUrls[engine] || searchUrls.google;
  execSync(`start chrome "${url}"`, { encoding: "utf8", timeout: 5000 });
  return `✅ Đã mở Chrome tìm kiếm: "${query}" trên ${engine}`;
}

function openUrl(url) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  execSync(`start chrome "${url}"`, { encoding: "utf8", timeout: 5000 });
  return `✅ Đã mở Chrome: ${url}`;
}

function getSystemInfo() {
  const raw = runPowerShell(
    `$os = Get-CimInstance Win32_OperatingSystem;
     $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1;
     $totalRAM = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1);
     $freeRAM = [math]::Round(($os.FreePhysicalMemory) / 1MB, 1);
     $usedRAM = [math]::Round($totalRAM - $freeRAM, 1);
     $disk = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
       ForEach-Object {
         [PSCustomObject]@{
           Drive = $_.DeviceID;
           SizeGB = [math]::Round($_.Size / 1GB, 1);
           FreeGB = [math]::Round($_.FreeSpace / 1GB, 1);
           UsedPct = [math]::Round(($_.Size - $_.FreeSpace) / $_.Size * 100, 1)
         }
       };
     $net = Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.NetEnabled } |
       Select-Object -First 1 | ForEach-Object { $_.NetConnectionID };
     $boot = $os.LastBootUpTime;
     $uptime = [math]::Round((Get-Date) - $boot | Select-Object -ExpandProperty TotalHours);
     [PSCustomObject]@{
       ComputerName = $os.CSName;
       OS = $os.Caption;
       OSVersion = $os.Version;
       CPU = $cpu.Name;
       CPUCores = $cpu.NumberOfCores;
       RAM_Total_GB = $totalRAM;
       RAM_Used_GB = $usedRAM;
       RAM_Free_GB = $freeRAM;
       RAM_UsedPct = [math]::Round($usedRAM / $totalRAM * 100, 1);
       Disks = @($disk);
       UptimeHours = $uptime;
       Network = $net
     } | ConvertTo-Json -Compress`,
    15000
  );
  try {
    return JSON.parse(raw);
  } catch {
    return { error: "Không thể lấy thông tin hệ thống" };
  }
}

function clipboardGet() {
  return runPowerShell(
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()",
    5000
  );
}

function clipboardSet(text) {
  const tmpFile = path.join(os.tmpdir(), "mcp_clipboard.txt");
  fs.writeFileSync(tmpFile, text, "utf8");
  runPowerShell(
    `$c = Get-Content '${tmpFile}' -Raw; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($c)`,
    5000
  );
  return `✅ Đã ghi vào clipboard (${text.length} ký tự)`;
}

function openFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`❌ Không tìm thấy thư mục: ${folderPath}`);
    }
    folderPath = resolved;
  }
  execSync(`explorer "${folderPath}"`, { encoding: "utf8", timeout: 5000 });
  return `✅ Đã mở thư mục: ${folderPath}`;
}

function getDisplayInfo() {
  const raw = runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms;
     $screen = [System.Windows.Forms.Screen]::PrimaryScreen;
     $bounds = $screen.Bounds;
     $all = [System.Windows.Forms.Screen]::AllScreens |
       ForEach-Object {
         [PSCustomObject]@{
           Device = $_.DeviceName;
           Width = $_.Bounds.Width;
           Height = $_.Bounds.Height;
           Primary = $_.Primary
         }
       };
     [PSCustomObject]@{
       PrimaryWidth = $bounds.Width;
       PrimaryHeight = $bounds.Height;
       WorkingWidth = $screen.WorkingArea.Width;
       WorkingHeight = $screen.WorkingArea.Height;
       AllScreens = @($all)
     } | ConvertTo-Json`,
    10000
  );
  try {
    return JSON.parse(raw);
  } catch {
    return { PrimaryWidth: 1920, PrimaryHeight: 1080 };
  }
}

function sendKeys(keys) {
  runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('${psEscape(keys)}')`,
    10000
  );
  return `✅ Đã gửi phím: ${keys}`;
}

// ──────────────────────────────────────────────
// 2. QUẢN LÝ CỬA SỔ
// ──────────────────────────────────────────────

function focusWindow(appName) {
  runPowerShell(
    `Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      using System.Diagnostics;
      public class WindowHelper {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        public static bool Focus(string name) {
          foreach (Process p in Process.GetProcessesByName(name)) {
            ShowWindowAsync(p.MainWindowHandle, 9); // SW_RESTORE
            return SetForegroundWindow(p.MainWindowHandle);
          }
          return false;
        }
      }
    '@;
    [WindowHelper]::Focus('${psEscape(appName)}')`,
    10000
  );
  return `✅ Đã focus cửa sổ: ${appName}`;
}

function resizeWindow(appName, width, height) {
  runPowerShell(
    `Add-Type @'
      using System;
      using System.Runtime.InteropServices;
      using System.Diagnostics;
      public class WindowResizer {
        [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
        public static bool Resize(string name, int w, int h) {
          foreach (Process p in Process.GetProcessesByName(name)) {
            ShowWindowAsync(p.MainWindowHandle, 9);
            return MoveWindow(p.MainWindowHandle, 100, 100, w, h, true);
          }
          return false;
        }
      }
    '@;
    [WindowResizer]::Resize('${psEscape(appName)}', ${width}, ${height})`,
    10000
  );
  return `✅ Đã resize cửa sổ "${appName}" thành ${width}x${height}`;
}

function minimizeAllWindows() {
  runPowerShell(
    `$shell = New-Object -ComObject "Shell.Application"; $shell.MinimizeAll()`,
    5000
  );
  return "✅ Đã thu nhỏ tất cả cửa sổ";
}

function showDesktop() {
  runPowerShell(
    `$shell = New-Object -ComObject "Shell.Application"; $shell.ToggleDesktop()`,
    5000
  );
  return "✅ Đã toggle desktop";
}

function closeWindow(appName) {
  runPowerShell(
    `Get-Process -Name '${psEscape(appName)}' -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null; if(!$_.HasExited) { $_.Kill() } }`,
    10000
  );
  return `✅ Đã đóng: ${appName}`;
}

// ──────────────────────────────────────────────
// 3. CHỤP MÀN HÌNH + OCR
// ──────────────────────────────────────────────

let tesseractWorker = null;

async function ensureTesseract() {
  if (!tesseractWorker) {
    const { createWorker } = require("tesseract.js");
    tesseractWorker = await createWorker("vie+eng");
    console.error("🧠 OCR worker đã sẵn sàng (Tesseract, vie+eng)");
  }
  return tesseractWorker;
}

async function takeScreenshot(fileName) {
  const savePath = path.join(SCREENSHOT_DIR, fileName || `screenshot_${Date.now()}.png`);

  // Use PowerShell to take screenshot via .NET
  runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms;
     Add-Type -AssemblyName System.Drawing;
     $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
     $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height;
     $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
     $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $screen.Size);
     $bitmap.Save('${psEscape(savePath)}', [System.Drawing.Imaging.ImageFormat]::Png);
     $graphics.Dispose(); $bitmap.Dispose()`,
    15000
  );

  if (!fs.existsSync(savePath)) {
    throw new Error("Không thể chụp màn hình");
  }

  const stats = fs.statSync(savePath);
  return {
    path: savePath,
    size: `${(stats.size / 1024).toFixed(1)} KB`,
    width: "full",
    height: "full",
  };
}

async function screenOcr(region) {
  // Take screenshot first
  const ssPath = path.join(SCREENSHOT_DIR, `ocr_${Date.now()}.png`);

  if (region) {
    // Capture specific region
    runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms;
       Add-Type -AssemblyName System.Drawing;
       $bitmap = New-Object System.Drawing.Bitmap ${region.width}, ${region.height};
       $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
       $graphics.CopyFromScreen(${region.x}, ${region.y}, 0, 0, New-Object System.Drawing.Size(${region.width}, ${region.height}));
       $bitmap.Save('${psEscape(ssPath)}', [System.Drawing.Imaging.ImageFormat]::Png);
       $graphics.Dispose(); $bitmap.Dispose()`,
      15000
    );
  } else {
    // Full screen
    runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms;
       Add-Type -AssemblyName System.Drawing;
       $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
       $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height;
       $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
       $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $screen.Size);
       $bitmap.Save('${psEscape(ssPath)}', [System.Drawing.Imaging.ImageFormat]::Png);
       $graphics.Dispose(); $bitmap.Dispose()`,
      15000
    );
  }

  if (!fs.existsSync(ssPath)) {
    throw new Error("Không thể chụp màn hình cho OCR");
  }

  const worker = await ensureTesseract();
  const { data } = await worker.recognize(ssPath);

  // Clean up screenshot
  try { fs.unlinkSync(ssPath); } catch { /* ignore */ }

  return {
    text: data.text,
    confidence: Math.round(data.confidence),
    words: data.words ? data.words.length : 0,
    blocks: data.blocks ? data.blocks.length : 0,
  };
}

// ──────────────────────────────────────────────
// 4. QUẢN LÝ PROCESS
// ──────────────────────────────────────────────

function killProcess(nameOrPid) {
  const isPid = /^\d+$/.test(nameOrPid);
  if (isPid) {
    runPowerShell(`Stop-Process -Id ${nameOrPid} -Force -ErrorAction Stop`, 10000);
    return `✅ Đã tắt process PID ${nameOrPid}`;
  } else {
    runPowerShell(`Stop-Process -Name '${psEscape(nameOrPid)}' -Force -ErrorAction Stop`, 10000);
    return `✅ Đã tắt process: ${nameOrPid}`;
  }
}

function getProcessDetails(nameOrPid) {
  let filter;
  if (/^\d+$/.test(nameOrPid)) {
    filter = `Id -eq ${nameOrPid}`;
  } else {
    filter = `Name -like '*${psEscape(nameOrPid)}*'`;
  }
  const raw = runPowerShell(
    `Get-Process | Where-Object { ${filter} } |
     Select-Object Name, Id,
       @{N='CPU_s';E={[math]::Round($_.CPU, 1)}},
       @{N='Mem_MB';E={[math]::Round($_.WorkingSet64 / 1MB, 1)}},
       @{N='Handles';E={$_.HandleCount}},
       @{N='Threads';E={($_.Threads | Measure-Object).Count}},
       @{N='StartTime';E={if($_.StartTime) { $_.StartTime.ToString('yyyy-MM-dd HH:mm') } else { 'N/A' }}},
       @{N='MainWindowTitle';E={$_.MainWindowTitle}},
       @{N='Responding';E={$_.Responding}} |
     ConvertTo-Json -Compress`,
    10000
  );
  return parseJsonOrArray(raw);
}

// ──────────────────────────────────────────────
// 5. FILE OPERATIONS NÂNG CAO
// ──────────────────────────────────────────────

function createFile(filePath, content = "") {
  const absPath = path.resolve(filePath);
  const dirName = path.dirname(absPath);
  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }
  fs.writeFileSync(absPath, content, "utf8");
  return `✅ Đã tạo file: ${absPath} (${content.length} ký tự)`;
}

function compressFolder(sourceDir, zipPath) {
  const absSource = path.resolve(sourceDir);
  if (!fs.existsSync(absSource)) {
    throw new Error(`❌ Thư mục không tồn tại: ${sourceDir}`);
  }
  const absZip = zipPath ? path.resolve(zipPath) : absSource + ".zip";
  runPowerShell(
    `Compress-Archive -Path '${psEscape(absSource)}\\*' -DestinationPath '${psEscape(absZip)}' -Force`,
    30000
  );
  const stats = fs.statSync(absZip);
  return `✅ Đã nén thành: ${absZip} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`;
}

function extractArchive(zipPath, destDir) {
  const absZip = path.resolve(zipPath);
  if (!fs.existsSync(absZip)) {
    throw new Error(`❌ File nén không tồn tại: ${zipPath}`);
  }
  const absDest = destDir ? path.resolve(destDir) : absZip.replace(/\.zip$/i, "");
  if (!fs.existsSync(absDest)) {
    fs.mkdirSync(absDest, { recursive: true });
  }
  runPowerShell(
    `Expand-Archive -Path '${psEscape(absZip)}' -DestinationPath '${psEscape(absDest)}' -Force`,
    30000
  );
  return `✅ Đã giải nén vào: ${absDest}`;
}

function openRecentFiles(count = 15) {
  const raw = runPowerShell(
    `$recent = [Environment]::GetFolderPath('Recent');
     Get-ChildItem $recent -ErrorAction SilentlyContinue |
       Sort-Object LastWriteTime -Descending |
       Select-Object -First ${count} |
       ForEach-Object {
         $target = $_.Target -replace '^.*:', '';  // lnk target
         [PSCustomObject]@{
           Name = $_.BaseName;
           Accessed = $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm');
           Shortcut = $_.FullName
         }
       } | ConvertTo-Json -Compress`,
    10000
  );
  return parseJsonOrArray(raw);
}

// ──────────────────────────────────────────────
// 6. MEDIA & NOTIFICATIONS
// ──────────────────────────────────────────────

function speakText(text, voice = "") {
  const script = voice
    ? `Add-Type -AssemblyName System.Speech;
       $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
       $s.SelectVoice('${psEscape(voice)}');
       $s.Speak('${psEscape(text)}')`
    : `Add-Type -AssemblyName System.Speech;
       $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
       $s.Speak('${psEscape(text)}')`;
  // Run async so it doesn't block
  execSync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    timeout: 30000,
  });
  return `✅ Đã đọc: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`;
}

function showNotification(title, message) {
  // Use the classic Windows toast via a PowerShell script
  const psScript = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
$textNodes = $template.GetElementsByTagName('text');
$textNodes.Item(0).AppendChild($template.CreateTextNode('${psEscape(title)}')) | Out-Null;
$textNodes.Item(1).AppendChild($template.CreateTextNode('${psEscape(message)}')) | Out-Null;
$toast = [Windows.UI.Notifications.ToastNotification]::new($template);
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('MCP Desktop').Show($toast);`;

  // Fallback to simpler notification if the fancy one fails
  try {
    runPowerShell(psScript, 10000);
  } catch {
    // Simpler fallback using .NET
    runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms;
       $notify = New-Object System.Windows.Forms.NotifyIcon;
       $notify.Icon = [System.Drawing.SystemIcons]::Information;
       $notify.BalloonTipTitle = '${psEscape(title)}';
       $notify.BalloonTipText = '${psEscape(message)}';
       $notify.Visible = $true;
       $notify.ShowBalloonTip(3000);
       Start-Sleep 3;
       $notify.Dispose()`,
      10000
    );
  }
  return `✅ Đã hiện thông báo: ${title}`;
}

function getAudioDevices() {
  const raw = runPowerShell(
    `Add-Type -AssemblyName System.Speech;
     $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
     $voices = $s.GetInstalledVoices() |
       ForEach-Object {
         $info = $_.VoiceInfo;
         [PSCustomObject]@{
           Name = $info.Name;
           Culture = $info.Culture.ToString();
           Gender = [string]$info.Gender;
           Age = [string]$info.Age
         }
       };
     $s.Dispose();
     $voices | ConvertTo-Json -Compress`,
    10000
  );
  return parseJsonOrArray(raw);
}

function setVolume(level) {
  const clamped = Math.max(0, Math.min(100, level));
  runPowerShell(
    `$obj = New-Object -ComObject WScript.Shell;
     $obj.SendKeys([char]0); # Ensure COM is ready
     for($i=0; $i -lt 50; $i++) { $obj.SendKeys([char]174) }; # Volume down 50 times
     for($i=0; $i -lt ${clamped}; $i++) { $obj.SendKeys([char]175) }`, // Volume up to target
    10000
  );
  return `✅ Đã chỉnh âm lượng: ${clamped}%`;
}

function getVolume() {
  const raw = runPowerShell(
    `$obj = New-Object -ComObject WScript.Shell;
     # Use COM to get audio endpoint volume
     # Fallback: read from AudioDeviceCmdlets or WMI
     try {
       $reg = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Internet Explorer\\Main' -ErrorAction SilentlyContinue
       'N/A (volume control requires AudioDeviceCmdlets module)'
     } catch { 'N/A' }`,
    5000
  );
  return raw.trim() || "N/A";
}

function muteUnmute(mute = true) {
  runPowerShell(
    `$obj = New-Object -ComObject WScript.Shell;
     for($i=0; $i -lt 50; $i++) { $obj.SendKeys([char]174) }`,
    5000
  );
  return mute ? "🔇 Đã tắt âm thanh" : "🔊 Đã bật âm thanh";
}

// ──────────────────────────────────────────────
// 7. QUICK ACTIONS
// ──────────────────────────────────────────────

async function quickSearch(query) {
  // Mở Chrome tìm kiếm
  browserSearch(query);
  return `✅ Đã mở Chrome tìm kiếm: "${query}"

💡 Mẹo: Dùng screen_ocr() sau đó để đọc nội dung từ kết quả tìm kiếm trên Chrome!`;
}

// ──────────────────────────────────────────────
// 8. POWER MANAGEMENT
// ──────────────────────────────────────────────

function lockWorkstation() {
  runPowerShell(`(New-Object -ComObject Shell.Application).LockWorkStation()`, 5000);
  return "✅ Đã khóa máy";
}

function sleepComputer() {
  runPowerShell(`(New-Object -ComObject Shell.Application).Sleep()`, 5000);
  return "✅ Đã chuyển máy sang chế độ sleep";
}

// ──────────────────────────────────────────────
// MCP Server
// ──────────────────────────────────────────────

const VERSION = "2.0.0";
const server = new Server(
  { name: "mcp-desktop", version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ─────────── CO BAN ───────────
    {
      name: "list_running_apps",
      description: `Liệt kê các ứng dụng đang chạy và có cửa sổ trên desktop. Trả về tên, tiêu đề cửa sổ, PID.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "list_available_apps",
      description: `Liệt kê các ứng dụng có thể mở được (từ Start Menu và PATH). Dùng khi không nhớ tên chính xác.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "launch_app",
      description: `Mở ứng dụng bất kỳ. VD: "chrome", "notepad", "code", "explorer", "calc". Có thể kèm tham số.`,
      inputSchema: {
        type: "object",
        properties: {
          appName: { type: "string", description: "Tên ứng dụng (vd: chrome, notepad, code)" },
          args: { type: "string", description: "Tham số dòng lệnh (tuỳ chọn)" },
        },
        required: ["appName"],
      },
    },
    {
      name: "browser_search",
      description: `Mở Chrome tìm kiếm Google/Bing/DuckDuckGo. Dùng khi WebSearch của Claude lỗi.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nội dung cần tìm" },
          engine: { type: "string", enum: ["google", "bing", "duckduckgo"], description: "Công cụ tìm kiếm (mặc định: google)" },
        },
        required: ["query"],
      },
    },
    {
      name: "open_url",
      description: `Mở Chrome và đi đến URL bất kỳ.`,
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL cần mở" },
        },
        required: ["url"],
      },
    },
    {
      name: "search_files",
      description: `Tìm file trên ổ cứng theo tên. Trả về 30 kết quả đầu.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Tên file cần tìm" },
          directory: { type: "string", description: "Thư mục gốc (mặc định: UserProfile)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_system_info",
      description: `Thông tin chi tiết CPU, RAM, ổ đĩa, OS, thời gian hoạt động, network.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },

    // ─────────── CLIPBOARD ───────────
    {
      name: "clipboard_get",
      description: `Đọc nội dung clipboard.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "clipboard_set",
      description: `Ghi nội dung mới vào clipboard.`,
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "Nội dung cần copy" } },
        required: ["text"],
      },
    },

    // ─────────── FOLDER & DISPLAY ───────────
    {
      name: "open_folder",
      description: `Mở thư mục trong Windows Explorer.`,
      inputSchema: {
        type: "object",
        properties: { folderPath: { type: "string", description: "Đường dẫn thư mục" } },
        required: ["folderPath"],
      },
    },
    {
      name: "get_display_info",
      description: `Thông tin màn hình: độ phân giải, vùng làm việc, tất cả màn hình.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },

    // ─────────── QUẢN LÝ CỬA SỔ ───────────
    {
      name: "focus_window",
      description: `Đưa cửa sổ ứng dụng lên foreground. Dùng để chuyển focus đến app đang chạy.`,
      inputSchema: {
        type: "object",
        properties: { appName: { type: "string", description: "Tên process (vd: chrome, notepad)" } },
        required: ["appName"],
      },
    },
    {
      name: "resize_window",
      description: `Thay đổi kích thước cửa sổ ứng dụng. Mặc định đặt ở góc (100,100).`,
      inputSchema: {
        type: "object",
        properties: {
          appName: { type: "string", description: "Tên process" },
          width: { type: "number", description: "Chiều rộng mới (px)" },
          height: { type: "number", description: "Chiều cao mới (px)" },
        },
        required: ["appName", "width", "height"],
      },
    },
    {
      name: "minimize_all_windows",
      description: `Thu nhỏ tất cả cửa sổ về taskbar (Show Desktop).`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "show_desktop",
      description: `Toggle Show Desktop (thu nhỏ/phục hồi tất cả cửa sổ).`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "close_window",
      description: `Đóng ứng dụng theo tên process. Nhẹ nhàng bằng CloseMainWindow trước, nếu không được thì Kill.`,
      inputSchema: {
        type: "object",
        properties: { appName: { type: "string", description: "Tên process cần đóng" } },
        required: ["appName"],
      },
    },

    // ─────────── CHỤP MÀN HÌNH + OCR ───────────
    {
      name: "take_screenshot",
      description: `Chụp ảnh toàn bộ màn hình chính. Lưu file PNG và trả về đường dẫn.
Dùng khi cần capture lại trạng thái desktop.`,
      inputSchema: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Tên file (tuỳ chọn, mặc định tự sinh)" },
        },
        required: [],
      },
    },
    {
      name: "screen_ocr",
      description: `Chụp màn hình + OCR để đọc chữ từ desktop.
Đây là tool quan trọng khi Claude Code cần "xem" nội dung trên màn hình (lỗi, web, app).
Hỗ trợ tiếng Việt và tiếng Anh. Có thể chụp một vùng cụ thể.`,
      inputSchema: {
        type: "object",
        properties: {
          region: {
            type: "object",
            description: "Vùng chụp cụ thể (tuỳ chọn, mặc định full màn hình)",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
          },
        },
        required: [],
      },
    },

    // ─────────── QUẢN LÝ PROCESS ───────────
    {
      name: "kill_process",
      description: `Tắt process theo tên hoặc PID. Dùng -Force để đảm bảo tắt.`,
      inputSchema: {
        type: "object",
        properties: {
          nameOrPid: { type: "string", description: "Tên process (vd: chrome) hoặc PID (vd: 1234)" },
        },
        required: ["nameOrPid"],
      },
    },
    {
      name: "get_process_details",
      description: `Xem chi tiết process: CPU, RAM, threads, handles, thời gian chạy, trạng thái.`,
      inputSchema: {
        type: "object",
        properties: {
          nameOrPid: { type: "string", description: "Tên hoặc PID" },
        },
        required: ["nameOrPid"],
      },
    },

    // ─────────── FILE OPERATIONS ───────────
    {
      name: "create_file",
      description: `Tạo file mới với nội dung text. Tự động tạo thư mục con nếu chưa có.`,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Đường dẫn file (vd: D:\\test\\hello.txt)" },
          content: { type: "string", description: "Nội dung file" },
        },
        required: ["filePath"],
      },
    },
    {
      name: "compress_folder",
      description: `Nén thư mục thành file ZIP. Dùng khi cần gửi cả thư mục đi.`,
      inputSchema: {
        type: "object",
        properties: {
          sourceDir: { type: "string", description: "Đường dẫn thư mục cần nén" },
          zipPath: { type: "string", description: "Đường dẫn file .zip (tuỳ chọn)" },
        },
        required: ["sourceDir"],
      },
    },
    {
      name: "extract_archive",
      description: `Giải nén file ZIP vào thư mục đích.`,
      inputSchema: {
        type: "object",
        properties: {
          zipPath: { type: "string", description: "Đường dẫn file .zip" },
          destDir: { type: "string", description: "Thư mục đích (tuỳ chọn)" },
        },
        required: ["zipPath"],
      },
    },
    {
      name: "open_recent_files",
      description: `Xem danh sách file đã mở gần đây (từ Recent items).`,
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "number", description: "Số lượng file (mặc định 15)" },
        },
        required: [],
      },
    },

    // ─────────── MEDIA & NOTIFICATIONS ───────────
    {
      name: "speak_text",
      description: `Đọc văn bản bằng giọng nói Windows (Text-to-Speech). Có thể chọn giọng đọc.`,
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Nội dung cần đọc" },
          voice: { type: "string", description: "Tên giọng đọc (tuỳ chọn). Xem bằng get_audio_devices" },
        },
        required: ["text"],
      },
    },
    {
      name: "show_notification",
      description: `Hiển thị thông báo Windows Toast Notification.`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Tiêu đề thông báo" },
          message: { type: "string", description: "Nội dung thông báo" },
        },
        required: ["title", "message"],
      },
    },
    {
      name: "get_audio_devices",
      description: `Xem danh sách giọng đọc Text-to-Speech khả dụng (tiếng Việt, Anh, v.v.).`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "set_volume",
      description: `Chỉnh âm lượng hệ thống (0-100%).`,
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "number", description: "Âm lượng 0-100" },
        },
        required: ["level"],
      },
    },

    // ─────────── QUICK ACTIONS ───────────
    {
      name: "quick_search",
      description: `Mở Chrome tìm kiếm nhanh. Gợi ý dùng screen_ocr sau đó để đọc kết quả.`,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nội dung cần tìm" },
        },
        required: ["query"],
      },
    },

    // ─────────── POWER ───────────
    {
      name: "lock_workstation",
      description: `Khóa máy tính ngay lập tức.`,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "send_keys",
      description: `Gửi tổ hợp phím đến ứng dụng đang active (dùng SendKeys).
Các mã phím: ^{c}=Ctrl+C, ^{v}=Ctrl+V, {ENTER}, {TAB}, %{f4}=Alt+F4, +{a}=Shift+A, {F5}.`,
      inputSchema: {
        type: "object",
        properties: {
          keys: { type: "string", description: "Chuỗi phím (vd: ^{c}, %{f4})" },
        },
        required: ["keys"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ─── CO BAN ───
      case "list_running_apps": {
        const apps = getRunningApps();
        return {
          content: [{ type: "text", text: apps.length > 0
            ? `📋 **Ứng dụng đang chạy (${apps.length}):**\n\n${apps.map((a, i) => `${i+1}. **${a.Name}** — ${a.Title} (PID: ${a.PID})`).join("\n")}`
            : "🔍 Không có ứng dụng nào đang mở cửa sổ." }],
        };
      }
      case "list_available_apps": {
        const apps = getAvailableApps();
        const show = apps.slice(0, 100);
        return {
          content: [{ type: "text", text: apps.length > 0
            ? `📦 **Ứng dụng có thể mở (${show.length}/${apps.length}):**\n\n${show.map((a, i) => `${i+1}. **${a.Name}**`).join("\n")}`
            : "🔍 Không tìm thấy ứng dụng nào." }],
        };
      }
      case "launch_app": {
        const result = launchApp(args.appName, args.args || "");
        return { content: [{ type: "text", text: result }] };
      }
      case "browser_search": {
        const result = browserSearch(args.query, args.engine);
        return { content: [{ type: "text", text: result }] };
      }
      case "open_url": {
        const result = openUrl(args.url);
        return { content: [{ type: "text", text: result }] };
      }
      case "search_files": {
        const files = searchFiles(args.query, args.directory);
        if (!files.length) {
          return { content: [{ type: "text", text: `🔍 Không tìm thấy file nào với "${args.query}"` }] };
        }
        return {
          content: [{ type: "text", text: `📁 **Kết quả tìm "${args.query}" (${files.length}):**\n\n${files.map((f, i) => `${i+1}. **${f.Path}**\n   📏 ${f.Size} | 🕐 ${f.Modified}`).join("\n")}` }],
        };
      }
      case "get_system_info": {
        const info = getSystemInfo();
        if (info.error) return { content: [{ type: "text", text: `❌ ${info.error}` }], isError: true };
        return {
          content: [{ type: "text", text:
            `🖥️ **Thông tin hệ thống**\n\n` +
            `- **Tên máy:** ${info.ComputerName}\n` +
            `- **HĐH:** ${info.OS} (${info.OSVersion})\n` +
            `- **CPU:** ${info.CPU} (${info.CPUCores} cores)\n` +
            `- **RAM:** ${info.RAM_Total_GB} GB (đã dùng ${info.RAM_Used_GB} GB - ${info.RAM_UsedPct}%, còn ${info.RAM_Free_GB} GB)\n` +
            `- **Mạng:** ${info.Network || "N/A"}\n` +
            `- **Thời gian hoạt động:** ${Math.floor(info.UptimeHours)} giờ\n\n` +
            `**Ổ đĩa:**\n` +
            (info.Disks || []).map(d => `- **${d.Drive}:** ${d.SizeGB} GB (đã dùng ${d.UsedPct}%, còn ${d.FreeGB} GB trống)`).join("\n")
          }],
        };
      }

      // ─── CLIPBOARD ───
      case "clipboard_get": {
        const text = clipboardGet();
        return { content: [{ type: "text", text: text ? `📋 **Clipboard:**\n\n${text}` : "📋 Clipboard đang trống." }] };
      }
      case "clipboard_set": {
        return { content: [{ type: "text", text: clipboardSet(args.text) }] };
      }

      // ─── FOLDER & DISPLAY ───
      case "open_folder": {
        return { content: [{ type: "text", text: openFolder(args.folderPath) }] };
      }
      case "get_display_info": {
        const display = getDisplayInfo();
        let text = `🖥️ **Thông tin màn hình**\n\n`;
        text += `- **Màn hình chính:** ${display.PrimaryWidth} x ${display.PrimaryHeight}\n`;
        text += `- **Vùng làm việc:** ${display.WorkingWidth} x ${display.WorkingHeight}\n`;
        if (display.AllScreens?.length > 1) {
          text += `\n**Tổng cộng ${display.AllScreens.length} màn hình:**\n`;
          display.AllScreens.forEach((s, i) => {
            text += `- Màn ${i+1}: ${s.Width}x${s.Height}${s.Primary ? " (Chính)" : ""}\n`;
          });
        }
        return { content: [{ type: "text", text }] };
      }

      // ─── QUẢN LÝ CỬA SỔ ───
      case "focus_window": {
        return { content: [{ type: "text", text: focusWindow(args.appName) }] };
      }
      case "resize_window": {
        return { content: [{ type: "text", text: resizeWindow(args.appName, args.width, args.height) }] };
      }
      case "minimize_all_windows": {
        return { content: [{ type: "text", text: minimizeAllWindows() }] };
      }
      case "show_desktop": {
        return { content: [{ type: "text", text: showDesktop() }] };
      }
      case "close_window": {
        return { content: [{ type: "text", text: closeWindow(args.appName) }] };
      }

      // ─── CHỤP MÀN HÌNH + OCR ───
      case "take_screenshot": {
        const shot = await takeScreenshot(args.fileName);
        return {
          content: [
            { type: "text", text: `📸 **Screenshot saved!**\n- Đường dẫn: ${shot.path}\n- Kích thước: ${shot.size}` },
          ],
        };
      }
      case "screen_ocr": {
        const ocr = await screenOcr(args.region);
        return {
          content: [{
            type: "text", text: ocr.text
              ? `📖 **OCR Result** (độ tin cậy: ${ocr.confidence}%)\n\n${ocr.text}`
              : "📖 Không đọc được chữ nào từ màn hình."
          }],
        };
      }

      // ─── QUẢN LÝ PROCESS ───
      case "kill_process": {
        return { content: [{ type: "text", text: killProcess(args.nameOrPid) }] };
      }
      case "get_process_details": {
        const details = getProcessDetails(args.nameOrPid);
        if (!details.length) {
          return { content: [{ type: "text", text: `🔍 Không tìm thấy process: ${args.nameOrPid}` }] };
        }
        return {
          content: [{ type: "text", text:
            `🔍 **Process: ${args.nameOrPid}**\n\n${details.map((p, i) =>
              `*${i+1}. ${p.Name} (PID: ${p.Id})*\n` +
              `   🖥️ CPU: ${p.CPU_s}s | 💾 RAM: ${p.Mem_MB} MB\n` +
              `   🧵 Threads: ${p.Threads} | 📎 Handles: ${p.Handles}\n` +
              `   🕐 Start: ${p.StartTime || "N/A"}\n` +
              `   📌 Cửa sổ: "${p.MainWindowTitle}"\n` +
              `   ${p.Responding ? "✅ Đang phản hồi" : "❌ Không phản hồi"}\n`
            ).join("\n")}`
          }],
        };
      }

      // ─── FILE OPERATIONS ───
      case "create_file": {
        return { content: [{ type: "text", text: createFile(args.filePath, args.content || "") }] };
      }
      case "compress_folder": {
        return { content: [{ type: "text", text: compressFolder(args.sourceDir, args.zipPath) }] };
      }
      case "extract_archive": {
        return { content: [{ type: "text", text: extractArchive(args.zipPath, args.destDir) }] };
      }
      case "open_recent_files": {
        const files = openRecentFiles(args.count || 15);
        if (!files.length) {
          return { content: [{ type: "text", text: "🔍 Không tìm thấy file gần đây." }] };
        }
        return {
          content: [{ type: "text", text:
            `🕐 **File gần đây (${files.length}):**\n\n${files.map((f, i) => `${i+1}. **${f.Name}** — ${f.Accessed}`).join("\n")}`
          }],
        };
      }

      // ─── MEDIA & NOTIFICATIONS ───
      case "speak_text": {
        return { content: [{ type: "text", text: speakText(args.text, args.voice) }] };
      }
      case "show_notification": {
        return { content: [{ type: "text", text: showNotification(args.title, args.message) }] };
      }
      case "get_audio_devices": {
        const voices = getAudioDevices();
        if (!voices.length) {
          return { content: [{ type: "text", text: "🔍 Không tìm thấy giọng đọc nào." }] };
        }
        return {
          content: [{ type: "text", text:
            `🎤 **Giọng đọc khả dụng (${voices.length}):**\n\n${voices.map((v, i) =>
              `${i+1}. **${v.Name}** — ${v.Culture} (${v.Gender})`
            ).join("\n")}`
          }],
        };
      }
      case "set_volume": {
        return { content: [{ type: "text", text: setVolume(args.level) }] };
      }

      // ─── QUICK ACTIONS ───
      case "quick_search": {
        const result = await quickSearch(args.query);
        return { content: [{ type: "text", text: result }] };
      }

      // ─── POWER ───
      case "lock_workstation": {
        return { content: [{ type: "text", text: lockWorkstation() }] };
      }

      // ─── SEND KEYS ───
      case "send_keys": {
        return { content: [{ type: "text", text: sendKeys(args.keys) }] };
      }

      default:
        throw new Error(`Tool không tồn tại: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ **Lỗi:** ${error.message}` }],
      isError: true,
    };
  }
});

// ──────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────

async function shutdown() {
  console.error("\n🛑 Đang tắt MCP Desktop server...");
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch { /* ignore */ }
    console.error("🧠 OCR worker đã dừng");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`✅ MCP Desktop server v${VERSION} đã khởi động!`);
  console.error(`📸 Screenshot dir: ${SCREENSHOT_DIR}`);
  console.error(`🛠️  ${Object.keys(handlerMap).length} tools available`);

  // Pre-warm OCR in background (don't block startup)
  ensureTesseract().then(() => {
    console.error("🧠 OCR worker đã sẵn sàng (pre-warmed)");
  }).catch((err) => {
    console.error(`⚠️ Không thể pre-warm OCR: ${err.message}`);
  });
}

// Tool handler count helper
const handlerMap = {
  list_running_apps: true,
  list_available_apps: true,
  launch_app: true,
  browser_search: true,
  open_url: true,
  search_files: true,
  get_system_info: true,
  clipboard_get: true,
  clipboard_set: true,
  open_folder: true,
  get_display_info: true,
  focus_window: true,
  resize_window: true,
  minimize_all_windows: true,
  show_desktop: true,
  close_window: true,
  take_screenshot: true,
  screen_ocr: true,
  kill_process: true,
  get_process_details: true,
  create_file: true,
  compress_folder: true,
  extract_archive: true,
  open_recent_files: true,
  speak_text: true,
  show_notification: true,
  get_audio_devices: true,
  set_volume: true,
  quick_search: true,
  lock_workstation: true,
  send_keys: true,
};

main().catch((error) => {
  console.error("❌ Lỗi khởi động MCP server:", error);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * MCP Desktop - Claude Code Desktop Interaction Tools
 *
 * MCP server cung cấp các tool tương tác với Windows desktop
 * Giúp Claude Code có thể mở ứng dụng, tìm file, tìm kiếm web, v.v.
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ──────────────────────────────────────────────
// Tool implementations
// ──────────────────────────────────────────────

/**
 * Lấy danh sách ứng dụng / cửa sổ đang chạy trên desktop
 */
function getRunningApps() {
  const output = execSync(
    `powershell -Command "
      Get-Process | Where-Object { \$_.MainWindowTitle -ne '' } |
      Select-Object Name, @{N='Title';E={\$_.MainWindowTitle}}, @{N='PID';E={\$_.Id}} |
      ConvertTo-Json -Compress
    "`,
    { encoding: "utf8", timeout: 10000 }
  );
  try {
    return JSON.parse(output.trim() || "[]");
  } catch {
    // If empty or single result, try wrapping
    const trimmed = output.trim();
    if (!trimmed) return [];
    // PowerShell returns single object as object not array
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
}

/**
 * Lấy danh sách ứng dụng có thể launch (từ Start Menu + PATH)
 */
function getAvailableApps() {
  const output = execSync(
    `powershell -Command "
      \$paths = @(
        [Environment]::GetFolderPath('CommonStartMenu') + '\\Programs',
        [Environment]::GetFolderPath('StartMenu') + '\\Programs'
      )
      \$apps = @()
      foreach (\$p in \$paths) {
        if (Test-Path \$p) {
          Get-ChildItem \$p -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
            ForEach-Object { \$apps += @{Name = \$_.BaseName; Path = \$_.FullName} }
        }
      }
      # Add common executables from PATH
      Get-Command -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { \$_.Name -match '\\\\.(exe|cmd|ps1)\$' } |
        ForEach-Object { \$apps += @{Name = \$_.Name -replace '\\\\.(exe|cmd|ps1)\$', ''; Path = \$_.Source} }
      \$apps | Sort-Object Name -Unique | ConvertTo-Json -Compress
    "`,
    { encoding: "utf8", timeout: 15000 }
  );
  try {
    const parsed = JSON.parse(output.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Launch một ứng dụng
 */
function launchApp(appName, args = "") {
  const cmd = `Start-Process "${appName}" ${args ? `-ArgumentList '${args}'` : ""}`;
  execSync(`powershell -Command "${cmd.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    timeout: 10000,
  });
  return `✅ Đã mở: ${appName}`;
}

/**
 * Tìm kiếm file trên hệ thống
 */
function searchFiles(query, dir = process.env.USERPROFILE || "C:\\") {
  const output = execSync(
    `powershell -Command "
      Get-ChildItem -Path '${dir}' -Filter '*${query}*' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { !\$_.PSIsContainer } |
        Select-Object -First 30 FullName, Length, LastWriteTime |
        ForEach-Object {
          \$size = if (\$_.Length -gt 1MB) {
            '{0:N1} MB' -f (\$_.Length / 1MB)
          } elseif (\$_.Length -gt 1KB) {
            '{0:N1} KB' -f (\$_.Length / 1KB)
          } else {
            '{0} B' -f \$_.Length
          }
          [PSCustomObject]@{
            Path = \$_.FullName
            Size = \$size
            Modified = \$_.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
          }
        } | ConvertTo-Json -Compress
    "`,
    { encoding: "utf8", timeout: 30000 }
  );
  try {
    const trimmed = output.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Mở Chrome với URL tìm kiếm
 */
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

/**
 * Mở URL trong Chrome
 */
function openUrl(url) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  execSync(`start chrome "${url}"`, { encoding: "utf8", timeout: 5000 });
  return `✅ Đã mở Chrome: ${url}`;
}

/**
 * Lấy thông tin hệ thống
 */
function getSystemInfo() {
  const output = execSync(
    `powershell -Command "
      \$os = Get-CimInstance Win32_OperatingSystem
      \$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
      \$ram = [math]::Round(\$os.TotalVisibleMemorySize / 1MB, 1)
      \$disk = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
        ForEach-Object {
          [PSCustomObject]@{
            Drive = \$_.DeviceID
            SizeGB = [math]::Round(\$_.Size / 1GB, 1)
            FreeGB = [math]::Round(\$_.FreeSpace / 1GB, 1)
            UsedGB = [math]::Round((\$_.Size - \$_.FreeSpace) / 1GB, 1)
            UsedPct = [math]::Round((\$_.Size - \$_.FreeSpace) / \$_.Size * 100, 1)
          }
        }
      [PSCustomObject]@{
        ComputerName = \$os.CSName
        OS = \$os.Caption
        OSVersion = \$os.Version
        CPU = \$cpu.Name
        CPUCores = \$cpu.NumberOfCores
        RAM_GB = \$ram
        Disks = @(\$disk)
        Uptime = [math]::Round((Get-Date) - \$os.LastBootUpTime | Select-Object -ExpandProperty TotalHours)
      } | ConvertTo-Json -Compress
    "`,
    { encoding: "utf8", timeout: 15000 }
  );
  try {
    return JSON.parse(output.trim());
  } catch {
    return { error: "Không thể lấy thông tin hệ thống" };
  }
}

/**
 * Đọc / ghi clipboard
 */
function clipboardGet() {
  const output = execSync(
    `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()"`,
    { encoding: "utf8", timeout: 5000 }
  );
  return output.trim();
}

function clipboardSet(text) {
  // Write to a temp file and use PowerShell to set clipboard
  const tmpFile = path.join(os.tmpdir(), "mcp_clipboard.txt");
  fs.writeFileSync(tmpFile, text, "utf8");
  execSync(
    `powershell -Command "\$c = Get-Content '${tmpFile}' -Raw; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText(\$c)"`,
    { encoding: "utf8", timeout: 5000 }
  );
  return `✅ Đã ghi vào clipboard (${text.length} ký tự)`;
}

/**
 * Mở folder trong Explorer
 */
function openFolder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    // Try to resolve relative paths
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`❌ Không tìm thấy thư mục: ${folderPath}`);
    }
    folderPath = resolved;
  }
  execSync(`explorer "${folderPath}"`, { encoding: "utf8", timeout: 5000 });
  return `✅ Đã mở thư mục: ${folderPath}`;
}

/**
 * Lấy thông tin màn hình
 */
function getDisplayInfo() {
  const output = execSync(
    `powershell -Command "
      Add-Type -AssemblyName System.Windows.Forms
      \$screen = [System.Windows.Forms.Screen]::PrimaryScreen
      \$bounds = \$screen.Bounds
      [PSCustomObject]@{
        Width = \$bounds.Width
        Height = \$bounds.Height
        WorkingWidth = \$screen.WorkingArea.Width
        WorkingHeight = \$screen.WorkingArea.Height
        Scaling = \$screen.Bounds.Width / [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width
      } | ConvertTo-Json
    "`,
    { encoding: "utf8", timeout: 10000 }
  );
  try {
    return JSON.parse(output.trim());
  } catch {
    return { width: 1920, height: 1080 };
  }
}

/**
 * Gõ phím / tự động hóa cơ bản (dùng SendKeys)
 * Các phím đặc biệt: ^{c}=Ctrl+C, {ENTER}, {TAB}, %{f4}=Alt+F4, ...
 */
function sendKeys(keys) {
  execSync(
    `powershell -Command "
      Add-Type -AssemblyName System.Windows.Forms
      Start-Sleep -Milliseconds 300
      [System.Windows.Forms.SendKeys]::SendWait('${keys.replace(/'/g, "''")}')
    "`,
    { encoding: "utf8", timeout: 10000 }
  );
  return `✅ Đã gửi phím: ${keys}`;
}

// ──────────────────────────────────────────────
// MCP Server
// ──────────────────────────────────────────────

const server = new Server(
  { name: "mcp-desktop", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_running_apps",
      description: `Liệt kê các ứng dụng đang chạy và có cửa sổ trên desktop.
Thường dùng để kiểm tra ứng dụng nào đang mở, hoặc tìm PID của ứng dụng.`,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "list_available_apps",
      description: `Liệt kê các ứng dụng có thể mở được trên máy tính (từ Start Menu và PATH).
Dùng khi không biết tên chính xác của app để launch.`,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "launch_app",
      description: `Mở một ứng dụng trên máy tính desktop.
Có thể kèm tham số dòng lệnh nếu cần.
Ví dụ: launch_app("chrome"), launch_app("notepad"), launch_app("code", "C:\\project")`,
      inputSchema: {
        type: "object",
        properties: {
          appName: {
            type: "string",
            description: "Tên ứng dụng (vd: chrome, notepad, code, excel, v.v.)",
          },
          args: {
            type: "string",
            description: "Tham số dòng lệnh (nếu có)",
          },
        },
        required: ["appName"],
      },
    },
    {
      name: "browser_search",
      description: `Mở Chrome và tìm kiếm trên Google (hoặc công cụ tìm kiếm khác).
Tool này fallback khi WebSearch/WebFetch mặc định của Claude Code bị lỗi.`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nội dung cần tìm kiếm",
          },
          engine: {
            type: "string",
            description: "Công cụ tìm kiếm: google (mặc định), bing, duckduckgo",
            enum: ["google", "bing", "duckduckgo"],
          },
        },
        required: ["query"],
      },
    },
    {
      name: "open_url",
      description: `Mở Chrome và đi đến một URL cụ thể.`,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL cần mở (vd: https://example.com)",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "search_files",
      description: `Tìm kiếm file trên ổ cứng theo tên.
Trả về tối đa 30 kết quả kèm đường dẫn, kích thước và ngày sửa.`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Tên file cần tìm (hỗ trợ wildcard)",
          },
          directory: {
            type: "string",
            description: "Thư mục gốc để tìm (mặc định: UserProfile)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_system_info",
      description: `Lấy thông tin chi tiết về máy tính: CPU, RAM, ổ cứng, OS, thời gian hoạt động.`,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "clipboard_get",
      description: `Đọc nội dung hiện tại trong clipboard.`,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "clipboard_set",
      description: `Ghi nội dung mới vào clipboard.`,
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Nội dung cần ghi vào clipboard",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "open_folder",
      description: `Mở thư mục trong Windows Explorer.`,
      inputSchema: {
        type: "object",
        properties: {
          folderPath: {
            type: "string",
            description: "Đường dẫn thư mục (vd: C:\\Users\\Name\\Documents)",
          },
        },
        required: ["folderPath"],
      },
    },
    {
      name: "get_display_info",
      description: `Lấy thông tin màn hình: độ phân giải, kích thước làm việc.`,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "send_keys",
      description: `Gửi tổ hợp phím đến ứng dụng đang active (dùng SendKeys).
Các phím đặc biệt: {ENTER}, {TAB}, ^{c}=Ctrl+C, %{f4}=Alt+F4, +{a}=Shift+A.`,
      inputSchema: {
        type: "object",
        properties: {
          keys: {
            type: "string",
            description: "Chuỗi phím gửi đi (vd: ^{c} để copy, %{f4} đóng cửa sổ)",
          },
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
      case "list_running_apps": {
        const apps = getRunningApps();
        return {
          content: [
            {
              type: "text",
              text:
                apps.length > 0
                  ? `📋 **Ứng dụng đang chạy (${apps.length}):**\n\n${apps
                      .map(
                        (a, i) =>
                          `${i + 1}. **${a.Name}** — ${a.Title} (PID: ${a.PID})`
                      )
                      .join("\n")}`
                  : "🔍 Không tìm thấy ứng dụng nào đang mở cửa sổ.",
            },
          ],
        };
      }

      case "list_available_apps": {
        const apps = getAvailableApps();
        return {
          content: [
            {
              type: "text",
              text:
                apps.length > 0
                  ? `📦 **Ứng dụng có thể mở (${Math.min(apps.length, 100)}/${apps.length}):**\n\n${apps
                      .slice(0, 100)
                      .map(
                        (a, i) =>
                          `${i + 1}. **${a.Name}**`
                      )
                      .join("\n")}`
                  : "🔍 Không tìm thấy ứng dụng nào.",
            },
          ],
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
        if (files.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `🔍 Không tìm thấy file nào với tên "${args.query}"`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `📁 **Kết quả tìm "${args.query}" (${files.length}):**\n\n${files
                .map(
                  (f, i) =>
                    `${i + 1}. **${f.Path}**\n   📏 ${f.Size} | 🕐 ${f.Modified}`
                )
                .join("\n")}`,
            },
          ],
        };
      }

      case "get_system_info": {
        const info = getSystemInfo();
        return {
          content: [
            {
              type: "text",
              text: `🖥️ **Thông tin hệ thống**\n\n` +
                `- **Tên máy:** ${info.ComputerName}\n` +
                `- **HĐH:** ${info.OS} (${info.OSVersion})\n` +
                `- **CPU:** ${info.CPU} (${info.CPUCores} cores)\n` +
                `- **RAM:** ${info.RAM_GB} GB\n` +
                `- **Thời gian hoạt động:** ${Math.floor(info.Uptime)} giờ\n\n` +
                `**Ổ đĩa:**\n` +
                (info.Disks || [])
                  .map(
                    (d) =>
                      `- **${d.Drive}:** ${d.UsedGB}/${d.SizeGB} GB (${d.UsedPct}%) — còn ${d.FreeGB} GB trống`
                  )
                  .join("\n"),
            },
          ],
        };
      }

      case "clipboard_get": {
        const text = clipboardGet();
        return {
          content: [
            {
              type: "text",
              text: text
                ? `📋 **Clipboard:**\n\n${text}`
                : "📋 Clipboard đang trống.",
            },
          ],
        };
      }

      case "clipboard_set": {
        const result = clipboardSet(args.text);
        return { content: [{ type: "text", text: result }] };
      }

      case "open_folder": {
        const result = openFolder(args.folderPath);
        return { content: [{ type: "text", text: result }] };
      }

      case "get_display_info": {
        const display = getDisplayInfo();
        return {
          content: [
            {
              type: "text",
              text:
                `🖥️ **Thông tin màn hình**\n\n` +
                `- **Độ phân giải:** ${display.Width} x ${display.Height}\n` +
                `- **Vùng làm việc:** ${display.WorkingWidth} x ${display.WorkingHeight}\n`,
            },
          ],
        };
      }

      case "send_keys": {
        const result = sendKeys(args.keys);
        return { content: [{ type: "text", text: result }] };
      }

      default:
        throw new Error(`Tool không tồn tại: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `❌ **Lỗi:** ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ MCP Desktop server đã khởi động!");
}

main().catch((error) => {
  console.error("❌ Lỗi khởi động MCP server:", error);
  process.exit(1);
});

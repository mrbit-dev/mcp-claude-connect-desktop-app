# 🖥️ MCP Claude Connect Desktop App

**MCP server cho phép Claude Code tương tác trực tiếp với máy tính Windows desktop — chụp màn hình, OCR, quản lý cửa sổ, process, file, media, v.v.**

Khi các tool mặc định của Claude Code (WebSearch, WebFetch...) gặp lỗi, MCP này fallback dùng trình duyệt và ứng dụng trên máy thật để làm việc — nhanh hơn, ít lỗi hơn.

---

## ✨ Tổng quan Tools

### 🖥️ Cơ bản
| Tool | Mô tả |
|---|---|
| `list_running_apps` | Liệt kê ứng dụng đang chạy trên desktop |
| `list_available_apps` | Liệt kê ứng dụng có thể mở (Start Menu + PATH) |
| `launch_app` | Mở ứng dụng (Chrome, Notepad, VS Code...) |
| `browser_search` | Mở Chrome tìm kiếm Google/Bing/DuckDuckGo |
| `open_url` | Mở URL trong Chrome |
| `search_files` | Tìm file trên ổ cứng |
| `get_system_info` | Thông tin CPU, RAM, ổ đĩa, OS (kèm % sử dụng) |

### 📋 Clipboard
| Tool | Mô tả |
|---|---|
| `clipboard_get` | Đọc nội dung clipboard |
| `clipboard_set` | Ghi nội dung vào clipboard |

### 📂 Thư mục & Màn hình
| Tool | Mô tả |
|---|---|
| `open_folder` | Mở thư mục trong Windows Explorer |
| `get_display_info` | Thông tin màn hình (kể cả multi-monitor) |

### 🪟 Quản lý cửa sổ
| Tool | Mô tả |
|---|---|
| `focus_window` | Đưa cửa sổ ứng dụng lên foreground |
| `resize_window` | Thay đổi kích thước cửa sổ |
| `minimize_all_windows` | Thu nhỏ tất cả cửa sổ về taskbar |
| `show_desktop` | Toggle Show Desktop |
| `close_window` | Đóng ứng dụng |

### 📸 Chụp màn hình & OCR
| Tool | Mô tả |
|---|---|
| `take_screenshot` | Chụp ảnh màn hình lưu file PNG |
| `screen_ocr` | Chụp màn hình + đọc chữ (hỗ trợ tiếng Việt + Anh) |

### 🔌 Quản lý Process
| Tool | Mô tả |
|---|---|
| `kill_process` | Tắt process theo tên hoặc PID |
| `get_process_details` | Xem chi tiết CPU, RAM, threads, handles |

### 🗂️ File Operations
| Tool | Mô tả |
|---|---|
| `create_file` | Tạo file mới với nội dung text |
| `compress_folder` | Nén thư mục thành ZIP |
| `extract_archive` | Giải nén file ZIP |
| `open_recent_files` | Xem file đã mở gần đây |

### 🔊 Media & Notifications
| Tool | Mô tả |
|---|---|
| `speak_text` | Đọc văn bản bằng giọng nói (Text-to-Speech) |
| `show_notification` | Hiển thị Toast Notification trên Windows |
| `get_audio_devices` | Danh sách giọng đọc khả dụng |
| `set_volume` | Chỉnh âm lượng hệ thống (0-100%) |

### ⚡ Quick Actions
| Tool | Mô tả |
|---|---|
| `quick_search` | Mở Chrome tìm kiếm + gợi ý dùng OCR đọc kết quả |

### 🔐 Power & Keyboard
| Tool | Mô tả |
|---|---|
| `lock_workstation` | Khóa máy tính |
| `send_keys` | Gửi tổ hợp phím (Ctrl+C, Alt+F4, Enter...) |

---

## 📦 Cài đặt

### Yêu cầu
- [Node.js](https://nodejs.org/) (v16 trở lên)
- Windows 10/11

### 1. Clone repo

```bash
git clone https://github.com/mrbit-dev/mcp-claude-connect-desktop-app.git
cd mcp-claude-connect-desktop-app
npm install
```

### 2. Cấu hình Claude Code

Thêm vào file `.claude/settings.json` trong project của anh (hoặc `%APPDATA%\Claude\claude_desktop_config.json` nếu dùng Claude Desktop):

```json
{
  "mcpServers": {
    "mcp-desktop": {
      "command": "node",
      "args": ["D:\\path\\to\\mcp-claude-connect-desktop-app\\index.js"]
    }
  }
}
```

### 3. Khởi động lại Claude Code

Sau khi cấu hình, khởi động lại Claude Code là có thể sử dụng các tool ngay.

---

## 🚀 Sử dụng

Khi Claude Code cần tương tác với desktop, nó sẽ tự động gọi các tool từ MCP này.

Ví dụ:
- *"Mở Chrome tìm kiếm Google cho tôi"*
- *"Chụp màn hình cho tôi"*
- *"Đọc chữ trên màn hình giúp tôi"*
- *"Cho tôi xem danh sách ứng dụng đang chạy"*
- *"Tìm file báo cáo trong thư mục Documents"*
- *"Mở thư mục D:\Projects"*
- *"Tắt Chrome đi"*
- *"Nén thư mục Downloads thành ZIP"*

---

## 🛠️ Phát triển

```bash
# Chạy thử MCP server
node index.js
```

---

## 📄 License

MIT

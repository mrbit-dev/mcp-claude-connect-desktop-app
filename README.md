# 🖥️ MCP Claude Connect Desktop App

**MCP server cho phép Claude Code tương tác trực tiếp với máy tính Windows desktop.**

Khi các tool mặc định của Claude Code (WebSearch, WebFetch...) gặp lỗi, MCP này sẽ fallback dùng trình duyệt và ứng dụng trên máy thật để làm việc — nhanh hơn, ít lỗi hơn.

---

## ✨ Các Tool

| Tool | Mô tả |
|---|---|
| `list_running_apps` | Liệt kê ứng dụng đang chạy trên desktop |
| `list_available_apps` | Liệt kê ứng dụng có thể mở (Start Menu + PATH) |
| `launch_app` | Mở ứng dụng (Chrome, Notepad, Excel, VS Code...) |
| `browser_search` | Mở Chrome tìm kiếm Google/Bing/DuckDuckGo |
| `open_url` | Mở URL trong Chrome |
| `search_files` | Tìm file trên ổ cứng |
| `get_system_info` | Thông tin CPU, RAM, ổ đĩa, OS |
| `clipboard_get` | Đọc nội dung clipboard |
| `clipboard_set` | Ghi nội dung vào clipboard |
| `open_folder` | Mở thư mục trong Windows Explorer |
| `get_display_info` | Thông tin màn hình (độ phân giải, vùng làm việc) |
| `send_keys` | Gửi tổ hợp phím đến ứng dụng đang active |

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

Thêm vào file `claude_desktop_config.json` (thường ở `%APPDATA%\Claude\`):

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

Hoặc thêm vào `.claude/settings.json` của project:

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

Ví dụ các câu lệnh:
- *"Mở Chrome tìm kiếm Google cho tôi"*
- *"Cho tôi xem danh sách ứng dụng đang chạy"*
- *"Tìm file báo cáo trong thư mục Documents"*
- *"Mở thư mục D:\Projects"*

---

## 🛠️ Phát triển

```bash
# Chạy thử MCP server
node index.js

# Hoặc chạy với tham số inspect
node --inspect index.js
```

---

## 📄 License

MIT

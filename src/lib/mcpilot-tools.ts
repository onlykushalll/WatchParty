/**
 * MCPilot tool registry — declarative definitions for all 90 tools.
 * The UI form renderer and the API proxy both consume this.
 *
 * Source of truth: MCPilot v3.6.0 plugin reference (mcpilot-plugin.md).
 */

export type ParamType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "string[]";

export interface ToolParam {
  name: string;
  label: string;
  type: ParamType;
  required?: boolean;
  default?: string | number | boolean | string[];
  placeholder?: string;
  options?: string[];
  help?: string;
}

export type ToolCategory =
  | "admin"
  | "web"
  | "file"
  | "terminal"
  | "system"
  | "utils";

export type ResultType = "json" | "text" | "image" | "markdown";

export interface ToolDef {
  name: string;
  category: ToolCategory;
  description: string;
  params: ToolParam[];
  resultType?: ResultType;
  dangerous?: boolean;
}

export interface CategoryMeta {
  id: ToolCategory;
  label: string;
  icon: string; // lucide icon name
  accent: string; // tailwind text/border accent class fragment
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "admin", label: "Admin & System Mode", icon: "ShieldCheck", accent: "rose" },
  { id: "web", label: "Web Scraping & Research", icon: "Globe", accent: "emerald" },
  { id: "file", label: "File System", icon: "FolderTree", accent: "amber" },
  { id: "terminal", label: "Terminal & Process", icon: "SquareTerminal", accent: "violet" },
  { id: "system", label: "System & Hardware", icon: "Cpu", accent: "fuchsia" },
  { id: "utils", label: "Utilities & Network", icon: "Wrench", accent: "slate" },
];

export const TOOLS: ToolDef[] = [
  // ─────────────────────────── ADMIN ───────────────────────────
  {
    name: "toggle_admin_mode",
    category: "admin",
    description: "Toggle Administrator elevation mode ON or OFF. When enabled, terminal and system tools run with elevated privileges.",
    dangerous: true,
    params: [
      {
        name: "enable",
        label: "Enable admin mode",
        type: "boolean",
        required: true,
        default: true,
        help: "Start-Process -Verb RunAs will be used for elevated tools.",
      },
    ],
  },
  {
    name: "check_admin_status",
    category: "admin",
    description: "Check whether MCPilot is running as an Administrator process and whether ADMIN_MODE is enabled.",
    params: [],
  },
  {
    name: "get_mcpilot_logs",
    category: "admin",
    description: "View recent system logs of MCPilot (mcpilot.log) with request history and errors.",
    params: [],
    resultType: "text",
  },

  // ─────────────────────────── WEB SCRAPING ───────────────────────────
  {
    name: "scrape",
    category: "web",
    description: "Universal Quad-Engine Web Scraping Suite. Auto-detect or explicit action mode.",
    params: [
      { name: "url", label: "URL", type: "string", required: true, placeholder: "https://example.com" },
      {
        name: "action",
        label: "Engine / action",
        type: "enum",
        options: ["auto", "hybrid", "crawl4ai", "firecrawl", "playwright", "scrapy_bulk", "antibot", "stealth_search"],
        default: "auto",
      },
      { name: "query", label: "Search query (stealth_search)", type: "string", placeholder: "best rust web frameworks 2026" },
      { name: "urls", label: "URLs (scrapy_bulk, one per line)", type: "text", placeholder: "https://a.com\nhttps://b.com" },
    ],
    resultType: "markdown",
  },
  {
    name: "deep_research_web",
    category: "web",
    description: "Autonomous multi-source deep research: web search → fetch pages → extract Markdown → synthesize a cited research report.",
    params: [
      { name: "query", label: "Research topic / question", type: "text", required: true, placeholder: "How does WebRTC handle NAT traversal?" },
      { name: "max_sources", label: "Max sources", type: "number", default: 10 },
    ],
    resultType: "markdown",
  },
  {
    name: "convert_html_to_markdown",
    category: "web",
    description: "Convert raw HTML to clean, token-efficient Markdown.",
    params: [
      { name: "html", label: "HTML", type: "text", required: true, placeholder: "<h1>Hello</h1><p>World</p>" },
    ],
    resultType: "markdown",
  },
  {
    name: "capture_web_screenshot",
    category: "web",
    description: "Capture a full headless Google Chrome screenshot of any URL to a PNG file.",
    params: [
      { name: "url", label: "URL", type: "string", required: true, placeholder: "https://example.com" },
      { name: "output_path", label: "Output PNG path", type: "string", placeholder: "C:\\Users\\Default\\shot.png" },
      { name: "full_page", label: "Full page", type: "boolean", default: true },
    ],
    resultType: "image",
  },
  {
    name: "scrape_antibot_url",
    category: "web",
    description: "Bypass anti-bot protections (Cloudflare, Turnstile, Akamai, Cloudflare Pages JS challenges) using stealth Chrome.",
    params: [
      { name: "url", label: "URL", type: "string", required: true, placeholder: "https://protected.example.com" },
    ],
    resultType: "markdown",
  },
  {
    name: "scrape_hybrid_orchestrator",
    category: "web",
    description: "Intelligent Quad-Engine Hybrid Orchestrator.",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
    ],
    resultType: "markdown",
  },
  {
    name: "scrape_crawl4ai",
    category: "web",
    description: "Token-efficient Markdown extraction for LLMs (Crawl4AI engine).",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
    ],
    resultType: "markdown",
  },
  {
    name: "scrape_firecrawl",
    category: "web",
    description: "Sitemap & recursive link discovery crawler (Firecrawl engine).",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
    ],
    resultType: "markdown",
  },
  {
    name: "scrape_playwright",
    category: "web",
    description: "JS SPA renderer & Google Chrome PNG screenshot capture (Playwright engine).",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
    ],
    resultType: "markdown",
  },
  {
    name: "scrape_scrapy_bulk",
    category: "web",
    description: "Multi-URL parallel ingestion (Scrapy engine).",
    params: [
      { name: "urls", label: "URLs (one per line)", type: "text", required: true, placeholder: "https://a.com\nhttps://b.com" },
    ],
    resultType: "markdown",
  },
  {
    name: "scrape_stealth_browser",
    category: "web",
    description: "Anti-bot web search using stealth Chrome.",
    params: [
      { name: "query", label: "Search query", type: "string", required: true, placeholder: "site:reddit.com watchparty" },
    ],
    resultType: "markdown",
  },

  // ─────────────────────────── FILE SYSTEM ───────────────────────────
  {
    name: "read_files",
    category: "file",
    description: "Read text files. Accepts a single path or an array of paths.",
    params: [
      { name: "path", label: "Path (single)", type: "string", placeholder: "C:\\Users\\Default\\file.txt" },
      { name: "paths", label: "Paths (one per line)", type: "text", placeholder: "C:\\a.txt\nC:\\b.txt" },
    ],
    resultType: "text",
  },
  {
    name: "read_file_lines",
    category: "file",
    description: "Read specific line ranges with line numbers.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
      { name: "start_line", label: "Start line", type: "number", default: 1 },
      { name: "end_line", label: "End line", type: "number", default: 100 },
    ],
    resultType: "text",
  },
  {
    name: "write_file",
    category: "file",
    description: "Write or append content to a file.",
    dangerous: true,
    params: [
      { name: "path", label: "Path", type: "string", required: true },
      { name: "content", label: "Content", type: "text", required: true },
      { name: "mode", label: "Mode", type: "enum", options: ["write", "append"], default: "write" },
    ],
  },
  {
    name: "replace_file_content",
    category: "file",
    description: "Surgical find-and-replace of a single contiguous block in a file.",
    dangerous: true,
    params: [
      { name: "path", label: "Path", type: "string", required: true },
      { name: "target", label: "Target (find)", type: "text", required: true },
      { name: "replacement", label: "Replacement", type: "text", required: true },
    ],
  },
  {
    name: "edit_block",
    category: "file",
    description: "Safe find-and-replace block editor with expected-replacement count.",
    dangerous: true,
    params: [
      { name: "file_path", label: "File path", type: "string", required: true },
      { name: "old_string", label: "Old string", type: "text", required: true },
      { name: "new_string", label: "New string", type: "text", required: true },
      { name: "expected_replacements", label: "Expected replacements", type: "number", default: 1 },
    ],
  },
  {
    name: "tree_view",
    category: "file",
    description: "Visual directory tree generator.",
    params: [
      { name: "path", label: "Path", type: "string", required: true, default: "C:\\Users\\Default" },
      { name: "max_depth", label: "Max depth", type: "number", default: 3 },
    ],
    resultType: "text",
  },
  {
    name: "create_directory",
    category: "file",
    description: "Create a folder recursively.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
    ],
  },
  {
    name: "list_directory",
    category: "file",
    description: "Recursively list files and directories.",
    params: [
      { name: "path", label: "Path", type: "string", required: true, default: "C:\\Users\\Default" },
      { name: "depth", label: "Depth", type: "number", default: 1 },
    ],
    resultType: "json",
  },
  {
    name: "move_file",
    category: "file",
    description: "Move or rename files.",
    dangerous: true,
    params: [
      { name: "source", label: "Source", type: "string", required: true },
      { name: "destination", label: "Destination", type: "string", required: true },
    ],
  },
  {
    name: "copy_file",
    category: "file",
    description: "Copy files.",
    params: [
      { name: "source", label: "Source", type: "string", required: true },
      { name: "destination", label: "Destination", type: "string", required: true },
    ],
  },
  {
    name: "delete_file",
    category: "file",
    description: "Delete a file or directory.",
    dangerous: true,
    params: [
      { name: "path", label: "Path", type: "string", required: true },
      { name: "recursive", label: "Recursive", type: "boolean", default: false },
    ],
  },
  {
    name: "get_file_info",
    category: "file",
    description: "Retrieve size, created/modified dates, permissions.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
    ],
    resultType: "json",
  },
  {
    name: "search_files",
    category: "file",
    description: "Pattern matching by name or content.",
    params: [
      { name: "path", label: "Search root", type: "string", required: true },
      { name: "pattern", label: "Pattern", type: "string", required: true, placeholder: "*.ts or TODO" },
      { name: "searchType", label: "Search type", type: "enum", options: ["name", "content"], default: "name" },
      { name: "ignoreCase", label: "Ignore case", type: "boolean", default: true },
    ],
    resultType: "json",
  },
  {
    name: "count_lines",
    category: "file",
    description: "Count lines of code categorized by file extension.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
    ],
    resultType: "json",
  },
  {
    name: "find_functions",
    category: "file",
    description: "Find function definitions in source code files.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
    ],
    resultType: "json",
  },
  {
    name: "extract_imports",
    category: "file",
    description: "Parse import statements inside a source file.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
    ],
    resultType: "json",
  },
  {
    name: "get_dependencies",
    category: "file",
    description: "Read project dependencies (package.json, requirements.txt).",
    params: [
      { name: "path", label: "Project path", type: "string", required: true },
    ],
    resultType: "json",
  },

  // ─────────────────────────── TERMINAL ───────────────────────────
  {
    name: "execute_command",
    category: "terminal",
    description: "Run a command synchronously in PowerShell/cmd.",
    dangerous: true,
    params: [
      { name: "command", label: "Command", type: "string", required: true, placeholder: "dir C:\\Users\\Default" },
      { name: "cwd", label: "Working directory", type: "string", placeholder: "C:\\Users\\Default" },
      { name: "timeout_ms", label: "Timeout (ms)", type: "number", default: 30000 },
      { name: "elevated", label: "Run elevated", type: "boolean", default: false },
    ],
    resultType: "text",
  },
  {
    name: "powershell_run",
    category: "terminal",
    description: "Run a raw PowerShell script block.",
    dangerous: true,
    params: [
      { name: "command", label: "PowerShell script", type: "text", required: true, placeholder: "Get-Process | Select-Object -First 5" },
      { name: "timeout_ms", label: "Timeout (ms)", type: "number", default: 30000 },
      { name: "elevated", label: "Run elevated", type: "boolean", default: false },
    ],
    resultType: "text",
  },
  {
    name: "start_process",
    category: "terminal",
    description: "Spawn a background command (managed PID).",
    dangerous: true,
    params: [
      { name: "command", label: "Command", type: "string", required: true },
      { name: "cwd", label: "Working directory", type: "string" },
      { name: "timeout_ms", label: "Timeout (ms)", type: "number", default: 60000 },
      { name: "elevated", label: "Run elevated", type: "boolean", default: false },
    ],
    resultType: "json",
  },
  {
    name: "read_process_output",
    category: "terminal",
    description: "Read the output stream of a managed process.",
    params: [
      { name: "pid", label: "PID", type: "number", required: true },
      { name: "timeout_ms", label: "Timeout (ms)", type: "number", default: 5000 },
    ],
    resultType: "text",
  },
  {
    name: "interact_with_process",
    category: "terminal",
    description: "Write a string to the stdin of a running managed process.",
    params: [
      { name: "pid", label: "PID", type: "number", required: true },
      { name: "input", label: "Stdin input", type: "text", required: true },
      { name: "timeout_ms", label: "Timeout (ms)", type: "number", default: 5000 },
    ],
  },
  {
    name: "force_terminate",
    category: "terminal",
    description: "Kill a background process managed by the server.",
    dangerous: true,
    params: [
      { name: "pid", label: "PID", type: "number", required: true },
    ],
  },
  {
    name: "list_sessions",
    category: "terminal",
    description: "List processes started/managed by the server.",
    params: [],
    resultType: "json",
  },
  {
    name: "list_processes",
    category: "terminal",
    description: "List active OS processes.",
    params: [
      { name: "detailed", label: "Detailed", type: "boolean", default: false },
      { name: "name", label: "Filter by name", type: "string", placeholder: "chrome" },
    ],
    resultType: "json",
  },
  {
    name: "kill_process",
    category: "terminal",
    description: "Surgical taskkill by OS PID.",
    dangerous: true,
    params: [
      { name: "pid", label: "PID", type: "number", required: true },
    ],
  },
  {
    name: "kill_port",
    category: "terminal",
    description: "Forcefully kill the process occupying a specific TCP port.",
    dangerous: true,
    params: [
      { name: "port", label: "Port", type: "number", required: true, default: 7878 },
    ],
  },
  {
    name: "shell_execute",
    category: "terminal",
    description: "Run an elevated command via the admin verb.",
    dangerous: true,
    params: [
      { name: "command", label: "Command", type: "string", required: true },
      { name: "args", label: "Arguments", type: "string" },
      { name: "elevated", label: "Run elevated", type: "boolean", default: true },
    ],
  },
  {
    name: "app_control",
    category: "terminal",
    description: "Control application lifecycles (launch, focus, close, maximize, minimize).",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["launch", "focus", "close", "maximize", "minimize"] },
      { name: "path", label: "App path", type: "string", placeholder: "C:\\Program Files\\..." },
      { name: "title", label: "Window title", type: "string" },
    ],
  },
  {
    name: "window_management",
    category: "terminal",
    description: "Move, minimize, maximize, or close windows.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["move", "minimize", "maximize", "close", "restore"] },
      { name: "title", label: "Window title", type: "string", required: true },
    ],
  },
  {
    name: "keyboard",
    category: "terminal",
    description: "Type text or trigger key combos.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["type", "keys"] },
      { name: "text", label: "Text to type", type: "text" },
      { name: "keys", label: "Key combo", type: "string", placeholder: "ctrl+c, enter, alt+tab" },
    ],
  },
  {
    name: "mouse",
    category: "terminal",
    description: "Click or drag at exact coordinates.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["click", "doubleclick", "rightclick", "drag"] },
      { name: "x", label: "X", type: "number", required: true },
      { name: "y", label: "Y", type: "number", required: true },
      { name: "button", label: "Button", type: "enum", options: ["left", "right", "middle"], default: "left" },
    ],
  },
  {
    name: "ui_tree",
    category: "terminal",
    description: "List UI elements under a specific window.",
    params: [
      { name: "window_title", label: "Window title", type: "string", required: true },
    ],
    resultType: "json",
  },
  {
    name: "ui_find",
    category: "terminal",
    description: "Find UI elements matching name/type.",
    params: [
      { name: "window_title", label: "Window title", type: "string", required: true },
      { name: "name", label: "Element name", type: "string" },
      { name: "control_type", label: "Control type", type: "string", placeholder: "Button, Edit, MenuItem" },
    ],
    resultType: "json",
  },
  {
    name: "ui_click",
    category: "terminal",
    description: "Click a UI element by name/type.",
    params: [
      { name: "window_title", label: "Window title", type: "string", required: true },
      { name: "name", label: "Element name", type: "string" },
      { name: "control_type", label: "Control type", type: "string" },
    ],
  },
  {
    name: "ui_read",
    category: "terminal",
    description: "Read text values from elements in a window.",
    params: [
      { name: "window_title", label: "Window title", type: "string", required: true },
    ],
    resultType: "json",
  },

  // ─────────────────────────── SYSTEM ───────────────────────────
  {
    name: "system_info",
    category: "system",
    description: "Hostname, CPUs, memory, OS version, admin state.",
    params: [],
    resultType: "json",
  },
  {
    name: "network_info",
    category: "system",
    description: "Local network interfaces and IP addresses.",
    params: [],
    resultType: "json",
  },
  {
    name: "disk_usage",
    category: "system",
    description: "Used/free disk space per drive letter.",
    params: [
      { name: "drive", label: "Drive letter", type: "string", placeholder: "C" },
    ],
    resultType: "json",
  },
  {
    name: "startup_items",
    category: "system",
    description: "List Windows startup programs and commands.",
    params: [],
    resultType: "json",
  },
  {
    name: "event_log",
    category: "system",
    description: "Query Windows Event Logs.",
    params: [
      { name: "log_name", label: "Log name", type: "string", default: "Application", placeholder: "Application, System, Security" },
      { name: "max_events", label: "Max events", type: "number", default: 50 },
    ],
    resultType: "json",
  },
  {
    name: "port_scan",
    category: "system",
    description: "Check open TCP ports on a target host.",
    params: [
      { name: "host", label: "Host", type: "string", required: true, default: "127.0.0.1" },
      { name: "ports", label: "Ports (comma-separated)", type: "string", placeholder: "80,443,7878,3389" },
    ],
    resultType: "json",
  },
  {
    name: "display_info",
    category: "system",
    description: "Monitor layout, primary display flags, resolution.",
    params: [],
    resultType: "json",
  },
  {
    name: "network_connections",
    category: "system",
    description: "Active TCP connections and owning PIDs.",
    params: [],
    resultType: "json",
  },
  {
    name: "wifi_list",
    category: "system",
    description: "Available WiFi networks and SSIDs.",
    params: [],
    resultType: "json",
  },
  {
    name: "bluetooth_list",
    category: "system",
    description: "Paired Bluetooth devices.",
    params: [],
    resultType: "json",
  },
  {
    name: "taskbar_control",
    category: "system",
    description: "Show or hide the Windows taskbar.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["show", "hide"] },
    ],
  },
  {
    name: "desktop_icons",
    category: "system",
    description: "List icons on the Windows Desktop.",
    params: [],
    resultType: "json",
  },
  {
    name: "battery_info",
    category: "system",
    description: "Query battery status.",
    params: [],
    resultType: "json",
  },
  {
    name: "audio_control",
    category: "system",
    description: "Volume control (get/set).",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["get", "set"] },
      { name: "volume", label: "Volume (0-100)", type: "number", placeholder: "50" },
    ],
  },
  {
    name: "registry_get",
    category: "system",
    description: "Read a Windows registry key.",
    params: [
      { name: "path", label: "Registry path", type: "string", required: true, placeholder: "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion" },
    ],
    resultType: "json",
  },
  {
    name: "registry_set",
    category: "system",
    description: "Set a Windows registry value.",
    dangerous: true,
    params: [
      { name: "path", label: "Registry path", type: "string", required: true },
      { name: "name", label: "Value name", type: "string", required: true },
      { name: "value", label: "Value", type: "string", required: true },
      { name: "type", label: "Type", type: "enum", options: ["REG_SZ", "REG_DWORD", "REG_QWORD", "REG_BINARY", "REG_EXPAND_SZ", "REG_MULTI_SZ"], default: "REG_SZ" },
    ],
  },
  {
    name: "registry_delete",
    category: "system",
    description: "Delete a Windows registry value.",
    dangerous: true,
    params: [
      { name: "path", label: "Registry path", type: "string", required: true },
      { name: "name", label: "Value name", type: "string", required: true },
    ],
  },
  {
    name: "service_list",
    category: "system",
    description: "List Windows services.",
    params: [
      { name: "name", label: "Filter by name", type: "string" },
    ],
    resultType: "json",
  },
  {
    name: "service_start",
    category: "system",
    description: "Start a Windows service.",
    dangerous: true,
    params: [
      { name: "name", label: "Service name", type: "string", required: true },
    ],
  },
  {
    name: "service_stop",
    category: "system",
    description: "Stop a Windows service.",
    dangerous: true,
    params: [
      { name: "name", label: "Service name", type: "string", required: true },
    ],
  },
  {
    name: "env_get",
    category: "system",
    description: "Get environment variables.",
    params: [
      { name: "name", label: "Variable name", type: "string", placeholder: "PATH" },
      { name: "scope", label: "Scope", type: "enum", options: ["user", "machine", "process"], default: "user" },
    ],
    resultType: "text",
  },
  {
    name: "env_set",
    category: "system",
    description: "Set an environment variable.",
    dangerous: true,
    params: [
      { name: "name", label: "Variable name", type: "string", required: true },
      { name: "value", label: "Value", type: "string", required: true },
      { name: "scope", label: "Scope", type: "enum", options: ["user", "machine", "process"], default: "user" },
    ],
  },
  {
    name: "scheduled_task_list",
    category: "system",
    description: "List scheduled tasks.",
    params: [
      { name: "task_name", label: "Task name filter", type: "string" },
    ],
    resultType: "json",
  },
  {
    name: "scheduled_task_create",
    category: "system",
    description: "Create a scheduled task.",
    dangerous: true,
    params: [
      { name: "name", label: "Task name", type: "string", required: true },
      { name: "command", label: "Command", type: "string", required: true },
      { name: "trigger", label: "Trigger", type: "string", required: true, placeholder: "daily 09:00, onstart, onlogon" },
    ],
  },
  {
    name: "installed_apps",
    category: "system",
    description: "List installed Windows programs.",
    params: [],
    resultType: "json",
  },

  // ─────────────────────────── UTILS ───────────────────────────
  {
    name: "http_request",
    category: "utils",
    description: "Send a raw HTTP/S call.",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
      { name: "method", label: "Method", type: "enum", required: true, options: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" },
      { name: "headers", label: "Headers (JSON)", type: "text", placeholder: '{\n  "Content-Type": "application/json"\n}' },
      { name: "body", label: "Body", type: "text" },
    ],
    resultType: "text",
  },
  {
    name: "download_file",
    category: "utils",
    description: "Download a file over HTTP.",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
      { name: "destination", label: "Destination path", type: "string", required: true, placeholder: "C:\\Users\\Default\\file.zip" },
    ],
  },
  {
    name: "open_url",
    category: "utils",
    description: "Open a URL in the default browser.",
    params: [
      { name: "url", label: "URL", type: "string", required: true },
    ],
  },
  {
    name: "open_file",
    category: "utils",
    description: "Launch a local file with its default application.",
    params: [
      { name: "path", label: "Path", type: "string", required: true },
    ],
  },
  {
    name: "clipboard_control",
    category: "utils",
    description: "Interact with the Windows clipboard.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["get", "set", "clear"] },
      { name: "text", label: "Text (for set)", type: "text" },
    ],
  },
  {
    name: "notification",
    category: "utils",
    description: "Spawn a native Windows message box.",
    params: [
      { name: "title", label: "Title", type: "string", required: true },
      { name: "message", label: "Message", type: "text", required: true },
    ],
  },
  {
    name: "screenshot",
    category: "utils",
    description: "Capture a primary monitor screenshot.",
    params: [
      { name: "output_path", label: "Output PNG path", type: "string", placeholder: "C:\\Users\\Default\\desktop.png" },
    ],
    resultType: "image",
  },
  {
    name: "git_control",
    category: "utils",
    description: "Inspect git repositories.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["status", "log", "branch", "diff", "remote"] },
      { name: "path", label: "Repo path", type: "string", required: true },
      { name: "limit", label: "Limit (for log)", type: "number", default: 20 },
    ],
    resultType: "text",
  },
  {
    name: "zip_create",
    category: "utils",
    description: "Compress a folder into a zip archive.",
    params: [
      { name: "source", label: "Source folder", type: "string", required: true },
      { name: "destination", label: "Destination zip", type: "string", required: true },
    ],
  },
  {
    name: "zip_extract",
    category: "utils",
    description: "Extract a zip archive.",
    params: [
      { name: "source", label: "Source zip", type: "string", required: true },
      { name: "destination", label: "Destination folder", type: "string", required: true },
    ],
  },
  {
    name: "base64_control",
    category: "utils",
    description: "Base64 encode or decode.",
    params: [
      { name: "action", label: "Action", type: "enum", required: true, options: ["encode", "decode"] },
      { name: "text", label: "Text", type: "text", required: true },
    ],
  },
  {
    name: "json_format",
    category: "utils",
    description: "Validate and format JSON strings.",
    params: [
      { name: "text", label: "JSON text", type: "text", required: true },
    ],
    resultType: "text",
  },
  {
    name: "uuid_generate",
    category: "utils",
    description: "Generate a standard v4 UUID.",
    params: [],
  },
  {
    name: "regex_test",
    category: "utils",
    description: "Test text against a regex.",
    params: [
      { name: "pattern", label: "Pattern", type: "string", required: true, placeholder: "\\b\\w+@\\w+\\.\\w+\\b" },
      { name: "text", label: "Text", type: "text", required: true },
      { name: "flags", label: "Flags", type: "string", default: "g" },
    ],
    resultType: "json",
  },
  {
    name: "ping",
    category: "utils",
    description: "Health ping check to MCPilot.",
    params: [],
  },
];

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

export function toolsByCategory(cat: ToolCategory): ToolDef[] {
  return TOOLS.filter((t) => t.category === cat);
}

export const TOTAL_TOOLS = TOOLS.length;

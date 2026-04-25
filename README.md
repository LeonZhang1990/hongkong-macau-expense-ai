# 港澳差旅报销处理系统

> 基于多模态大模型的个人差旅票据识别与汇总工具。上传高铁票 / Uber / 滴滴 截图或 PDF，AI 自动提取日期、行程、金额并生成可导出的 Excel 报销明细。

![React](https://img.shields.io/badge/React-19-61dafb?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript) ![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite) ![Tailwind](https://img.shields.io/badge/TailwindCSS-3-38bdf8?logo=tailwindcss) ![Node](https://img.shields.io/badge/Node-20+-43853d?logo=node.js) ![License](https://img.shields.io/badge/license-MIT-blue)

## 特性

- **多厂商大模型支持**：Google Gemini / OpenAI GPT / Anthropic Claude / 任何 OpenAI 兼容接口（DeepSeek、Kimi、智谱 GLM、通义千问 等）
- **Web UI 配置 API Key**：无需改代码，首次使用在"API 管理"页面选择厂商、填入 Key、一键测试连接
- **多格式支持**：图片（PNG/JPG）走视觉识别；PDF 先提取文字再交给文本模型
- **结构化输出**：AI 返回 `{日期, 类型, 行程, 金额}` 四字段，自动校准为标准格式
- **可编辑确认流**：每个文件独立卡片展示识别结果，逐条核对后再并入汇总表
- **按日期自动分组**：汇总表按日期归类，每日生成"交通费总额（不含高铁）"小计行
- **Excel 一键导出**：含合并单元格的小计行、总计行，格式可直接用于报销
- **识别历史持久化**：所有成功识别自动保存到本地 `server/history.json`，支持筛选、查看详情、删除、清空
- **本地化**：深色运营后台风格；中文文件名自动处理，无乱码

## 技术栈

| 层 | 内容 |
|----|------|
| 前端 | React 19 + TypeScript + Vite 5 + Tailwind CSS 3，纯 SVG 图标、xlsx 导出 |
| 后端 | Node.js (ES Module) + Express 5 + Multer + pdfjs-dist |
| AI 调用层 | `@google/generative-ai` / `openai` SDK / Anthropic REST API |
| 持久化 | 本地 JSON 文件（`server/config.json`、`server/history.json`） |

## 部署到 Railway（推荐 · 公网访问）

想要一个永久可访问的 URL？推荐部署到 [Railway](https://railway.com)：

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2FLeonZhang1990%2Fhongkong-macau-expense-ai)

### 操作步骤

1. 打开 <https://railway.com/new>（首次使用需登录并绑定 GitHub）
2. 选择 **Deploy from GitHub repo** → 选中 `LeonZhang1990/hongkong-macau-expense-ai`
3. 等待 Railway 自动：`npm install` → `postinstall`（构建前端）→ `npm start`
4. 部署完成后在服务页面 → **Settings → Networking → Generate Domain**，获得公网 URL（形如 `xxx.up.railway.app`）
5. 打开该 URL → **API 管理** → 填入你的 Key → 保存即可

### 可选环境变量（避免每次部署后重新填 Key）

在 Railway 的 **Variables** 中配置（重启后生效）：

| 变量 | 说明 |
|------|------|
| `LLM_PROVIDER` | `gemini` / `openai` / `anthropic` / `openai-compat` |
| `LLM_MODEL` | 模型名，例如 `gemini-2.5-flash`、`gpt-4o`、`claude-3-5-sonnet-latest` |
| `LLM_BASE_URL` | 仅 `openai-compat` / 自定义端点需要 |
| `GEMINI_API_KEY` | 使用 Gemini 时填 |
| `OPENAI_API_KEY` | 使用 OpenAI 时填 |
| `ANTHROPIC_API_KEY` | 使用 Claude 时填 |
| `LLM_API_KEY` | 通用兜底：匹配不到前三个时使用 |
| `AUTH_USER` | 登录用户名（留空=不启用鉴权） |
| `AUTH_PASS` | 登录密码（和 AUTH_USER 同时设置才生效） |

> 注意：Railway 的文件系统不持久化，`config.json` 和 `history.json` 在每次部署时会丢失。想要持久化识别历史，需要接入 Railway Volume 或外部数据库（暂未内置）。

---

## 部署到自己的 Linux 服务器（如腾讯云 Lighthouse）

### 1. 准备环境（Ubuntu/Debian 示例）

```bash
# 安装 Node 20（用 NodeSource 官方源）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 验证
node -v && npm -v
```

### 2. 拉代码 + 安装 + 构建

```bash
cd ~
git clone https://github.com/LeonZhang1990/hongkong-macau-expense-ai.git
cd hongkong-macau-expense-ai
npm install   # 自动 postinstall：装前后端依赖 + 构建前端
```

### 3. 用 PM2 常驻运行

```bash
sudo npm install -g pm2

# 启动（带登录鉴权；请自行改密码）
AUTH_USER=admin AUTH_PASS=请改成你自己的密码 pm2 start "node server/index.js" --name reimbursement

pm2 save
pm2 startup   # 按照提示再执行一条命令即可实现开机自启
```

### 4. 放开防火墙端口

- **Lighthouse 控制台** → 你的实例 → **防火墙** → 添加规则：TCP / 3001 / 来源 `0.0.0.0/0`
- 服务器内部（Ubuntu 若开了 UFW）：`sudo ufw allow 3001/tcp`

### 5. 访问

打开浏览器：`http://<你的公网IP>:3001`
浏览器会弹出登录框 → 输入你设置的 `AUTH_USER / AUTH_PASS` → 进入系统 → **API 管理** 配置 Key 即可使用。

### 常用运维命令

```bash
pm2 logs reimbursement       # 看日志
pm2 restart reimbursement    # 重启
pm2 stop reimbursement       # 停止
pm2 list                     # 查看所有服务

# 更新代码到最新版
cd ~/hongkong-macau-expense-ai
git pull
npm install
pm2 restart reimbursement
```

---

## 本地运行



### 环境要求

- Node.js **20+**（推荐 20 LTS 或更高）

### 一键安装与启动（推荐）

```bash
git clone https://github.com/LeonZhang1990/hongkong-macau-expense-ai.git
cd hongkong-macau-expense-ai
npm install          # 触发 postinstall：自动安装前后端依赖 + 构建前端
npm start            # 启动后端（同时托管前端静态页面）
```

打开浏览器访问：**`http://localhost:3001`**

### 分步安装（仅需要时）

```bash
cd app && npm install
cd ../server && npm install
cd ../app && npm run build
cd ../server && node index.js
```

### 配置 API Key（首次启动必做）

1. 左侧菜单点击 **"API 管理"**
2. 选择你要用的厂商（Gemini / OpenAI / Claude / OpenAI 兼容）
3. 填入对应 API Key、选择模型
4. 点击"测试连接"确认无误后保存

| 厂商 | 获取 Key | 典型免费配额 |
|-----|---------|------|
| Google Gemini | <https://aistudio.google.com/app/apikey> | 每分钟若干次免费调用 |
| OpenAI | <https://platform.openai.com/api-keys> | 按 token 计费 |
| Anthropic Claude | <https://console.anthropic.com/settings/keys> | 按 token 计费 |
| DeepSeek | <https://platform.deepseek.com/api_keys> | 赠送一定额度 |
| Kimi (月之暗面) | <https://platform.moonshot.cn/console/api-keys> | 赠送一定额度 |

## 开发模式（前端热更新）

前端源码修改频繁时可以单独起 vite dev server：

```bash
# 终端 1：启动后端
cd server && node index.js

# 终端 2：启动前端热更新（Vite 会自动把 /api 代理到 3001）
cd app && npm run dev
```

然后访问 Vite 输出的 `http://localhost:5173`（或自动分配的端口）。

## 项目结构

```
.
├── app/                      # 前端 React 项目
│   ├── src/
│   │   ├── App.tsx          # 主应用（深色 UI，上传/识别/汇总/历史/API 管理）
│   │   ├── main.tsx
│   │   └── index.css        # Tailwind + 全局深色主题变量
│   ├── index.html
│   ├── vite.config.ts       # 含 /api 代理配置
│   └── package.json
│
├── server/                   # 后端 Express 项目
│   ├── index.js             # 路由 + 配置/历史持久化 + 静态文件托管
│   ├── llm.js               # 多厂商 LLM 统一调用抽象层
│   ├── config.example.json  # 配置示例（真正的 config.json 会被 gitignore）
│   └── package.json
│
├── .gitignore
└── README.md
```

## API 说明

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/parse` | 上传单个文件（图片或 PDF）+ hint，返回结构化记录 |
| GET  | `/api/config` | 返回当前配置（Key 已脱敏）+ 可选厂商元信息 |
| POST | `/api/config` | 保存配置 `{provider, apiKey, model, baseURL}` |
| POST | `/api/config/test` | 用指定配置实际调用一次大模型，验证连通性 |
| GET  | `/api/history` | 返回全部识别历史（倒序） |
| DELETE | `/api/history[?id=]` | 删除单条或清空全部 |
| GET  | `/api/health` | 健康检查 |

## 数据与隐私

- **API Key 只保存在你本地的 `server/config.json`**，不会上传到任何第三方
- **识别历史只保存在本地 `server/history.json`**，最多 500 条
- 这两个文件都已加入 `.gitignore`，不会意外提交到仓库
- 上传的票据文件**仅在内存中处理**，不持久化到服务端磁盘
- 请求大模型 API 时，图片/PDF 文字会发送给你选择的厂商（请自行确认厂商隐私政策）

## 常见问题

**Q: 上传后报 "API key not valid / Forbidden"？**
A: 请在"API 管理"中重新填写 Key 并"测试连接"。不同厂商的 Key 不通用。

**Q: Gemini 返回 "model not found"？**
A: 新版 Gemini API Key 只支持 `gemini-2.x` 系列，老版 Key 才支持 `1.5-pro`，请根据测试结果挑选模型。

**Q: 滴滴 PDF 识别不出来？**
A: 该系统对 PDF 先用 `pdfjs-dist` 提取文字再交给大模型。如果是扫描版 PDF（纯图），请手动另存为截图后上传。

**Q: 想切换到第三方国内大模型？**
A: 在"API 管理"选择「OpenAI 兼容」，填写厂商的 Base URL（例如 DeepSeek 的 `https://api.deepseek.com/v1`）、Key 和模型名即可。

## License

MIT © leonlmzhang

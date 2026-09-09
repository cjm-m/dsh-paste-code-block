<div align="center">

# dsh-paste-code-block

**Cherry Studio 式的文本块/代码块粘贴效果（DeepSeek Harness Web）**

把复制的**文本块 / 代码块**粘到 DSH Web 输入框时，不再是一长串普通文字，而是收成一张**带边框、可折叠、带语言标签的代码块卡片**；发送时自动还原成真正的 ```` ```lang … ``` ```` 围栏代码块发送。

纯客户端插件（浏览器侧），PC 与手机 Web 通用，实时适配深浅主题。

`type: module` · `runtime: host` · `client: web` · MIT

**[English](./README.md) | 中文**

</div>

---

## 功能

- 📋 **智能识别**：粘贴内容已带 ``` 围栏、含换行、或是较长的缩进代码 → 收成卡片；普通短文本照常粘贴。
- 🏷️ **语言标签**：自动识别 Python / JS / JSON / YAML / SQL / bash / HTML·XML / C++ / Go / Ruby 等常见语言（可识别 shebang）。纯文本块标为 `text`。
- 📂 **可折叠卡片**：默认收起显示首行预览，点击展开完整代码（最多 260px 高可滚动）。
- ✏️ **卡片内编辑**：在详情卡片里直接编辑代码块内容，发送时使用编辑后的文本。
- 📤 **发送还原**：发出时把每个卡片还原成 ```` ```lang ``` ```` 围栏代码块；发送失败自动回填回输入框。
- 🔢 **智能编号**：代码与文本分开计数，从最小可用号分配；删除某块即释放其编号供复用。
- 📱 **全端适配**：纯客户端插件，PC 与手机 Web 通用，实时适配深浅主题。

## 安装

需要 DSH `0.1.x`（当前为开发者预览版，接口可能变化）。

已发布到 **npm**，可直接按包名安装：

```sh
dsh plugin --profile web add dsh-paste-code-block
```

也可以从本 Git 仓库或本地目录安装：

```sh
# 从 GitHub
dsh plugin --profile web add github:cjm-m/dsh-paste-code-block

# 从本地目录
dsh plugin --profile web add file:/path/to/dsh-paste-code-block
```

安装后**重启 `dsh web`** 生效。

## 使用

1. 在任意地方复制一段代码 / 一段带换行的文本。
2. 在 DSH 输入框粘贴 → 变成一张代码块卡片。
3. 可展开 / 复制 / 编辑 / 移除；回车或发送即还原为围栏代码块发出。

## 说明与边界

- 默认**追加在草稿末尾**（复用 DSH 隐藏引用按文件/上传的既有语义），保证光标/撤销稳定；短普通文本不拦截。
- 纯文本块发送时用 ```` ```text ``` ```` 围栏包裹，避免在对话里糊成一行。
- 识别阈值：**含换行 / 行数 ≥2 / 长度 ≥96 / 有缩进或围栏**其一即视为块。

## 目录结构

```
dsh-paste-code-block/
├── src/
│   ├── client.js       # Web（浏览器侧）半端 —— 粘贴拦截、徽章样式、详情卡片
│   ├── index.js        # Host（Node 侧）半端 —— 有意为空（纯 UI 插件）
│   └── parse.js        # 纯文本块解析逻辑（规范版，含单元测试）
├── tests/
│   └── parse.test.js   # node:test 单元测试（针对 src/parse.js）
├── docs/
│   └── design.md       # 设计说明（编号复用、锚点稳定、codec）
├── cordis.patch.yml    # DSH bundle patch，声明宿主插件
├── package.json        # 包与 DSH 插件清单
├── README.md           # English
└── README.zh-CN.md     # 简体中文
```

## 开发

```sh
npm run check   # 语法检查两个 JS 半端
npm test        # 运行单元测试（node:test）
```

## License

MIT — 见 [LICENSE](./LICENSE)。
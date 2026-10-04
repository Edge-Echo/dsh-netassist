# dsh-netassist

**GitHub 连不上、代理不生效的时候，一条命令说清是哪一环断了，以及该改什么。**

### 什么时候需要它

- DSH 拉不到 GitHub 或 npm，分不清问题出在 DNS、TCP 还是代理
- 系统代理配了却不生效 —— TUN 模式、路由规则，或者一条过期的 hosts 记录
- 不想自己跑 ping、nslookup、tracert，再对着四份输出自己推断

每条结论都带着它成立的前提，所以报告不会自相矛盾 —— 只有当代理确实被配置为使用某个端口时，该端口不通才会被报成问题。

![dsh-netassist](https://raw.githubusercontent.com/Edge-Echo/dsh-netassist/main/banner.svg)


[![npm version](https://img.shields.io/npm/v/dsh-netassist?color=14b8a6&logo=npm)](https://www.npmjs.com/package/dsh-netassist)
[![npm downloads](https://img.shields.io/npm/dm/dsh-netassist?color=22d3ee)](https://www.npmjs.com/package/dsh-netassist)
[![license](https://img.shields.io/npm/l/dsh-netassist?color=14b8a6)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Edge-Echo/dsh-netassist?color=22d3ee)](https://github.com/Edge-Echo/dsh-netassist)


源自真实的大陆网络痛点：GitHub 时通时断、到处是代理、hosts 冲突、TUN 模式和系统代理分不清。这个插件让 agent 一键回答「GitHub 通不通？」「系统代理是什么？」「代理端口活着吗？」，外加完整诊断链——全部只读、全部防注入。

> English docs: [README.md](README.md).


## 反馈

下载量能看出装了多少次，看不出有没有用。如果你在用，**一句话说明你拿它做什么，比点个 star 有用得多**——尤其是**没跑通**的情况，那是最不会有人主动说的：

- 你想做什么
- 它做到了吗
- 缺什么、哪里不对

[开个 issue 说一句](../../issues/new?template=usage.yml) —— 如果是明确的 bug，直接开普通 issue 就行。

## 工具

| 工具 | 回答什么问题 |
|---|---|
| `net_github_status` | GitHub 现在通不通？（DNS + TCP 443） |
| `net_proxy_status` | 系统代理配置：注册表 ProxyEnable/ProxyServer/ProxyOverride + 代理环境变量 |
| `net_proxy_probe` | 哪些常见本地代理端口活着？（默认 10808/10809/7890/7897/8888/1080） |
| `net_diag` | 任意主机完整诊断链：DNS → TCP → HTTPS 状态码 |
| `net_hosts_check` | hosts 里钉了哪些 GitHub 条目（代理冲突扫描） |

## 安装

```sh
dsh plugin --profile web add dsh-netassist
dsh web   # 重启
```

然后直接问 agent：
- 「检查 github.com 通不通」→ `net_github_status`
- 「我的系统代理是什么？」→ `net_proxy_status`
- 「我的代理在跑吗？」→ `net_proxy_probe`
- 「为什么访问不了 api.example.com:8443？」→ `net_diag` host=api.example.com port=8443
- 「hosts 里有 github 条目吗？」→ `net_hosts_check`

## 工作原理

每个工具通过 `powershell.exe -NoProfile -NonInteractive` 执行一段**只读** PowerShell 脚本。所有用户输入以 **Base64** 形式跨脚本边界——从结构上杜绝注入。不写文件、不需要管理员权限、零依赖。

- 配置：`psTimeoutMs`（默认 25000）——单次调用超时，可在 profile 的 `cordis.patch.yml` 的 `netassist` 条目下设置。
- 仅 Windows：非 Windows 平台明确报错。

## 真实示例（本机实测）

```
net_github_status → DNS: 20.205.243.166, TCP 443: OPEN
net_proxy_status  → ProxyEnable: 1, ProxyServer: 127.0.0.1:10808
net_proxy_probe   → 10808 OPEN, 10809/7890/7897/8888/1080 CLOSED
net_hosts_check   → no github entries in hosts (clean)
```

## 排错

- 报 "PowerShell failed"：多半是执行策略或杀软干扰。插件已用 `-NoProfile -NonInteractive`；可查 `Get-ExecutionPolicy`——不要求 RemoteSigned。
- 端口探测每个 5 秒连接超时，完整探测最坏约 5-10 秒。

## 链接

- npm: <https://www.npmjs.com/package/dsh-netassist>
- GitHub: <https://github.com/Edge-Echo/dsh-netassist>
- License: MIT

## 相关

属于 **dsh-toolkit 家族** —— 一组各自独立可用的小工具，面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：

- [dsh-mcp-bridge](https://github.com/Edge-Echo/dsh-mcp-bridge) —— 一条命令装好 6 个精选 MCP server，CI 逐个验证
- [dsh-win-toolkit](https://github.com/Edge-Echo/dsh-win-toolkit) —— Windows 剪贴板、通知、hosts、端口检测
- [dsh-netassist](https://github.com/Edge-Echo/dsh-netassist) —— 网络与代理诊断，直接告诉你下一步
- [dsh-driftwatch](https://github.com/Edge-Echo/dsh-driftwatch) —— 两次会话日志的行为漂移报告
- [dsh-ledger](https://github.com/Edge-Echo/dsh-ledger) —— agent 到底动了哪些文件，且记录不可篡改
- [dsh-release-evidence](https://github.com/Edge-Echo/dsh-release-evidence) —— 每次发布一个可验证的证据包
- [mcp-netassist](https://github.com/Edge-Echo/mcp-netassist) —— 同一套网络检查，做成任意 MCP 客户端可用的服务器

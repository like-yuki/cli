# cli
@like-yuki/cli

## lk-pp

合并当前分支到多个目标分支并推送远端。

首次运行会引导你配置远端名、目标分支、合并策略，并保存到全局配置文件：
`~/.config/like-yuki-cli/config.json`

配置按仓库区分存储，首次在不同仓库运行会各自初始化。

### 使用方式

```bash
lk-pp
```

### 查看当前仓库配置

```bash
lk-pp --show-config
```

### 修改配置

```bash
lk-pp --config
```

或

```bash
lk-pp --edit
```

### 修改默认配置

```bash
lk-pp --global
```

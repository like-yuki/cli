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

```bash
lk-pp -n
```

```bash
lk-pp --no-verify
```

### 计划模式

```bash
lk-pp --plan
```

仅输出将执行的命令，不做远端校验。

### 查看当前仓库配置

```bash
lk-pp --show-config
```

### 恢复执行

```bash
lk-pp --resume
```

### 修改配置

```bash
lk-pp --config
```

或

```bash
lk-pp --edit
```

## lk-gpa

扫描指定目录下的 Git 仓库并依次执行 `git pull`。

```bash
lk-gpa
```

```bash
lk-gpa 2
```

```bash
lk-gpa --detail
```

```bash
lk-gpa --skip node_modules,dist
```

```bash
lk-gpa --skip-only dist,coverage
```

```bash
lk-gpa --skip-none
```

```bash
lk-gpa --skip node_modules --skip dist
```

```bash
lk-gpa --config
```

```bash
lk-gpa --config --add node_modules,dist
```

```bash
lk-gpa --config --remove dist
```

```bash
lk-gpa --config --default
```

```bash
lk-gpa --config --none
```

```bash
lk-gpa --timeout 60000
```

```bash
lk-gpa --show-config
```

```bash
lk-gpa --resume
```

```bash
lk-gpa --resume --force
```

```bash
lk-gpa --help
```

### 修改默认配置

```bash
lk-pp --global
```

# 真实教师 / 学生双模型交互

`scripts/e2e-real-models.mjs` 用**两个真实模型角色**跑真实 Murdoku 困难题，不使用官方解脚本、不使用 mock VALID。

## 角色

- **教师**：扩展内 agent（真实模型），可调用 board_*，负责教学/操作/讲解；
- **学生**：独立真实模型（OpenAI 兼容），负责：
  - 教学：审查教师这一步，质疑或回复“接受，继续下一步。”；
  - 考试：独立读线索并给出完整落子 JSON，不向教师问答案；
- **教师考试**：只读盘面/audit，不落子、不泄露。

## 配置

```bash
cd extension
cp .env.model.example .env.model
```

填：

```bash
MODEL_BASE_URL=...
MODEL_API_KEY=...
MODEL_NAME=...

# 可选：不同学生模型
STUDENT_MODEL_BASE_URL=...
STUDENT_MODEL_API_KEY=...
STUDENT_MODEL_NAME=...
```

`.env.model` 已 gitignore；脚本不会打印 key。

`PLAYWRIGHT_CORE` / `CHROME_PATH` 复用 `extension/.env.precommit`（或进程环境）。

## 运行

```bash
node scripts/e2e-real-models.mjs
```

没有真实 key 会直接退出 2，不会回退 mock。

## 判定

- 教学：真实教师/学生多轮交互后，游戏出现 `CASE SOLVED`；
- 考试：全新 profile；真实学生模型给出完整解并落子；真实教师模型审出 `VALID`；游戏 `CASE SOLVED`。

## 注意

- 真实模型单轮 30-60 秒，整条链路可能 10 分钟以上；
- 会产生真实 API 费用；
- 这是模型能力 + 交互测试，不是 pre-commit 快速回归。

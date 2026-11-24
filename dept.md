# dept: 485

依存ライブラリが最新版からどれだけ遅れているか。最新版までに出たリリースを major / minor / patch に分けて数え、重みを掛けて足したもの([スコアの定義](https://github.com/shiroinock/dept#スコアの定義))。

- 合計 **485** = major 7 × 30 + minor 35 × 3 + patch 170 × 1
- 3 / 4 パッケージが遅れている、0.9 libyears
- ロックファイル:`./pnpm-lock.yaml`

| SCORE | PACKAGE | CURRENT | LATEST | MAJ | MIN | PAT | LIBYEAR | KIND |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 278 | `@types/node` | 22.20.5 | 26.6.7 | 3 | 29 | 101 | 0.1 | dev |
| 146 | `vite` | 6.4.6 | 8.3.8 | 2 | 6 | 68 | 0.0 | dev |
| 61 | `typescript` | 5.9.3 | 7.0.2 | 2 | 0 | 1 | 0.8 | dev |

<details>
<summary>最新の依存(1 件)</summary>

| PACKAGE | VERSION | KIND |
| --- | --- | --- |
| `vitest` | 5.1.1 | dev |

</details>

---

[dept](https://github.com/shiroinock/dept) で作成

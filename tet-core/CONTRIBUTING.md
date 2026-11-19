## Contributing

Thanks for helping build TET-Network. The repository-wide guide is the root
[`CONTRIBUTING.md`](../CONTRIBUTING.md); this page covers the Rust crates.

### Ground rules

- **No secrets**: never commit `.env`, private keys, local databases, or credentials.
- **Keep CI green**: PRs must pass the tests and the guards (`bash scripts/run_guards.sh` from the
  root runs CI's guards locally; see the root guide for what it needs). Clippy also runs in CI, but it does
  not fail the build yet, because the tree still has known warnings. CI does not check formatting.
- **Small, reviewable changes**: prefer focused PRs with clear commit messages.

### Development workflow

Run from the repository root, as CI does:

```bash
RISC0_SKIP_BUILD=1 cargo test --workspace
RISC0_SKIP_BUILD=1 cargo clippy --workspace --all-targets   # reported in CI, not yet blocking
```

Do not run `cargo fmt` over the whole tree: much of it is not formatted yet, so the diff would
touch many files you did not change. If you format a file, put that in its own commit, apart from
any change in behaviour.

### CI notes (RISC0)

CI sets `RISC0_SKIP_BUILD=1` by default to avoid requiring the guest toolchain on every runner.
If your change touches guest code, run the full guest build locally in your environment.

## コントリビュート（日本語）

TET-Network への貢献ありがとうございます。リポジトリ全体のガイドはルートの
[`CONTRIBUTING.md`](../CONTRIBUTING.md) です。このページは Rust のクレートについて書いています。

### ルール

- **シークレット禁止**: `.env`、秘密鍵、ローカルDB、認証情報はコミットしない。
- **CI を常に緑に**: テストとガードがすべて通ること（ルートで `bash scripts/run_guards.sh` を実行すると、
  CI のガードを手元で実行できます。必要なものはルートのガイドを参照）。Clippy も CI で実行されますが、既知の警告が
  残っているため、まだビルドを失敗させません。フォーマットは CI では確認していません。
- **小さくレビューしやすく**: 目的が明確な差分・コミットを優先する。

### 開発フロー

CI と同じく、リポジトリのルートで実行します。

```bash
RISC0_SKIP_BUILD=1 cargo test --workspace
RISC0_SKIP_BUILD=1 cargo clippy --workspace --all-targets   # CI では表示のみ、まだ失敗にはならない
```

ツリー全体に `cargo fmt` をかけないでください。まだフォーマットされていない部分が多く、変更していない
ファイルまで差分に入ってしまいます。ファイルをフォーマットする場合は、動作の変更とは別のコミットにしてください。

### CI 補足（RISC0）

CI は `RISC0_SKIP_BUILD=1` をデフォルトで設定し、ゲスト用ツールチェーン無しでも検証できるようにしています。
ゲスト側の変更を含む場合は、各自の環境でフルビルドも実施してください。

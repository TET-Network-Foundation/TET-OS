# Whitepaper v1.1 — Gap 分析（議論用ドラフト）

**目的:** Steve × Claude (informal CTO) が **Genesis Draft v1.0** を v1.1 に引き上げる際の論点整理。  
**正本:** [`WHITEPAPER.md`](../WHITEPAPER.md) / [`GENESIS_V1.md`](../GENESIS_V1.md)（§1–§17、2026-04-28）  
**更新:** 2026-05-18 — 本文引用・行番号を Genesis v1.0 英語版に差し替え済み。

**凡例:** 各 Gap に「v1.1 で書くべき方向性」のみ（確定解答ではない）。

---

## Gap 1 — §5.2 R(T) 式の η(Wᵢ) 測定機構が未定義

### 現状の記述（WHITEPAPER §5.2, L82–88）

```82:88:WHITEPAPER.md
### 5.2 Mathematical Model of Thermodynamic Work

The value of 1 TET is not arbitrary. It is a cryptographic proof of physical work. A node's expected reward $R$ over a time interval $T$ is calculated as:

$$R(T) = \frac{\sum_{i \in \text{verified\_tasks}(T)} \left[ \eta(W_i) \cdot C(t_i) \right]}{D(t)}$$

Where $\eta(W_i)$ is the verified thermodynamic output of task $i$, $C(t_i)$ is the network's compute price at time $t_i$, and $D(t)$ is the dynamic difficulty coefficient. This equation establishes the **Sovereign Peg** — the generation of intelligence is cryptographically bound to physical electricity.
```

**Gap:** $\eta(W_i)$、$C(t_i)$、$D(t)$ の **観測・検証・更新アルゴリズム**が本文にない。

### コード上の実装状況

```53:59:tet-core/src/vision/thermo_genesis.rs
/// Whitepaper §4.2 discrete thermodynamic reward:
///
/// **R = (C_flops / E_joules_per_flop) × Γ**
```

| 項目 | 参照 | 状況 |
|------|------|------|
| R ∝ flops/joules×Γ | `thermo_genesis.rs` L62–78, `consensus.rs` L492 | **部分実装**（env でスケール） |
| per-worker η | — | **未実装**（シンボル `η` なし） |
| CAAC hardware probe | `caac.rs` L34–48 | **指紋のみ**（η ではない） |

**注:** コードコメントは旧章番号 §4.2 — 正本は **§5.2**（`.rs` 変更は別 PR）。

### v1.1 の方向性

- **η の定義を 1 つに固定**（例: 検証可能 FLOPs / 申告 Joules、TEE 計測 Joules）。  
- **測定主体:** PoC のみ / PoR 除外 等を明記。  
- **R(T) ↔ `discrete_thermodynamic_reward_*` 対応表**を付録化。  
- **未測定時のフォールバック**（デフォルト η、cap、slash）。

---

## Gap 2 — §14.2 Hardware fingerprinting の具体例不足

### 現状の記述（WHITEPAPER §14.2, L219–221）

```219:221:WHITEPAPER.md
### 14.2 Hardware Spoofing — Sybil Attacks

A node may attempt to disguise low-tier hardware as a high-end GPU to claim larger PoC rewards. TET mitigates this through **probabilistic hardware fingerprinting** — the protocol issues non-deterministic micro-tasks that exploit timing characteristics specific to actual hardware execution. The response profile is an unforgeable cryptographic proof of the physical hardware layer. Emulation cannot reproduce the timing signature of genuine silicon.
```

**Gap:** micro-task の例、頻度、失敗時ペナルティ、PoC ロール再割当、TEE との関係が未記載。

### コード上の実装状況

```9:26:tet-core/src/vision/caac.rs
/// Assigned consensus-facing execution lane (whitepaper PoC / PoR).
pub enum NodeRelayRole { Poc, Por }

#[derive(Debug, Clone, Serialize)]
pub struct HardwareFingerprint {
    pub fingerprint_sha256_hex: String,
    pub cpu_logical_cores: u32,
    pub ram_total_bytes: u64,
    pub gpu_detected: bool,
    pub gpu_hint: String,
}
```

- 静的プローブ（CPU/RAM/GPU hint）: `caac.rs` L34–48  
- **probabilistic micro-tasks / timing profile:** **未実装**  
- **TEE attestation:** **未実装**

### v1.1 の方向性

- フィンガープリント入力列・micro-task 仕様の **normative appendix**。  
- VM / クラウド GPU 借り攻撃と緩和（ステーク + ZK-Court）。  
- `CaacProfile` JSON と WP の対応表。

---

## Gap 3 — §5.1 Optimistic challenge window / watcher incentive 未定義

### 現状の記述（WHITEPAPER §5.1 + §14.1）

```76:80:WHITEPAPER.md
### 5.1 The Sovereign Runtime

Ethereum measures computational steps with Gas — an abstract unit that prices execution without reference to external utility. TET prices execution directly in units of thermodynamic work. When a smart contract requests AI inference, the Sovereign Runtime routes the task to PoC nodes under an optimistic verification model. Nodes execute off the main thread and return a cryptographic commitment to the result. The main chain optimistically accepts the commitment during a challenge window. Disputes escalate to ZK-Court.
```

```215:217:WHITEPAPER.md
### 14.1 Lazy Evaluation — Computation Spoofing

A malicious PoC node may attempt to save power by submitting fabricated inference results without executing the task. ZK-Court defends against this. During the challenge window, any watcher can initiate a RISC Zero or SP1 zkVM execution trace against the node's submitted commitment.
```

**Gap:** **challenge window の長さ**（秒/ブロック）、**watcher / challenger の報酬**、bond サイズが本文にない（§14.3 の $S$ は別概念）。

### コード上の実装状況

```21:33:tet-core/src/vision/zk_court.rs
pub struct InferenceDisputeState {
    pub inference_id: String,
    pub worker_wallet_id: String,
    pub phase: ChallengePhase,
    pub challenge_opens_at_ms: u128,
    pub challenge_closes_at_ms: u128,
    ...
    pub challenger_bond_micro: u64,
}
```

- 状態機械・タイムスタンプ・bond フィールド: **骨格あり**  
- **デフォルト window / watcher 報酬:** **未文書化・未固定**

### v1.1 の方向性

- `T_challenge` を mainnet / testnet 表で固定。  
- §14.3 の $S = \lambda \cdot R_{\text{expected}}$（L225–227）と challenger bond の関係を整理。  
- permissionless challenge の可否。

---

## Gap 4 — §12.7 Agent-Gate の state channel security model 未定義

### 現状の記述（WHITEPAPER §12.7, L187–199 + Future Work L173–177）

```187:197:WHITEPAPER.md
### 12.7 TET Agent-Gate — The Invisible Machine-to-Machine Economy
...
2. **Micropayments via State Channels:** To avoid main-chain latency and gas overhead, autonomous AIs open probabilistic state channels (off-chain) with gatekeeper nodes. Millions of access requests and negotiations occur in milliseconds, with only their net balance settled once daily on the TET Layer-1.
```

**Gap:** force-move、不正終了、チェックポイント形式、ML-DSA 署名範囲、L1 正本順序が未定義。本文は **Future Work**（L173–177）で Phase 0/1 対象外と明記済み。

### コード上の実装状況

- `Agent-Gate` / `state channel` モジュール: **なし**  
- 近縁: `p2p_dex.rs` escrow（**別概念**）

### v1.1 の方向性

- Future Work のまま維持するか、**最小 state-channel モデル**を 1 ページ追加するか（**要 Steve 判断**）。  
- §12.5–12.7 境界の図解。

---

## Gap 5 — §12.5–12.7（World Brain / Sentient Assets / Agent-Gate）がコードに無い

### 現状の記述（WHITEPAPER L173–177, §12.5–12.7）

```173:177:WHITEPAPER.md
> ⚠️ **Future Work — Sections 12.5 through 12.7**
> ...
> Readers evaluating TET against near-term technical milestones should treat sections 12.1–12.4 as the binding scope.
```

§12.5 World Brain、§12.6 Sentient Assets、§12.7 Agent-Gate（L179–199）は **研究・長期**としてラベル済み。

### コード上の実装状況

| 概念 | モジュール |
|------|------------|
| World Brain | **該当なし** |
| Sentient Assets | `SPRINT0_ISSUES.md` のみ |
| Agent-Gate | **該当なし** |
| 近縁 | `tet-network/ui/app/os/`, `ai_local.rs`, `worker_ai.rs` |

### v1.1 の方向性

- WP は Future Work 表示で **整合** — v1.1 では MVP 定義か Research 章への降格を選択。  
- コードマップ付録（`vision/*` = CAAC / ZK-Court / thermo のみ）。

---

## Gap 6 — Tokenomics（§11）と実装（80/15/5）の不整合

### 現状の記述（WHITEPAPER §11, L135–147）

```135:147:WHITEPAPER.md
## 11. Tokenomics: Genesis Allocation and Scarcity

Maximum total supply is fixed at **10,000,000,000 TET**. ...
### 11.1 Genesis Allocation
- **25% — Founders & Core Contributors:** ...
- **50% — Resource Mining Rewards:** ... PoC and PoR nodes.
- **25% — Ecosystem Treasury:** ...
### 11.2 Deflationary Burn Mechanism
50% of all transaction fees, including AI inference costs, are permanently burned at settlement.
```

**Gap:** §11 は **supply / allocation / fee burn** のみ。**AI inference 決済の 80/15/5** は本文に無い。旧 B 版（`archive/WHITEPAPER_v0_economic.md`）の Imperial Tax / CHF peg は **deprecated**。

### コード上の実装状況

```212:217:tet-core/src/rest/handlers/enterprise.rs
    // Settle payment AFTER success using golden rule 80/15/5.
```

- `ledger.rs` `MAX_SUPPLY_MICRO` — cap **実装**  
- `settle_ai_utility_payment` — **80/15/5**（WP §11 未記載）  
- `chf_top_up_mint` — **legacy 経路**（Genesis 正本に CHF なし）

### v1.1 の方向性

- **単一 Tokenomics 表:** §11.1 配分 + §11.2 burn + **AI settlement レイヤ**（80/15/5）+ §5.2 R(T) 採掘報酬。  
- 旧経済モデルは `archive/WHITEPAPER_v0_economic.md` を Appendix B として参照のみ。  
- **要 Steve 判断:** 80/15/5 を WP に昇格するか、実装を §11.2 burn に寄せるか。

---

## 優先度（議論用・非拘束）

| 優先 | Gap | 理由 |
|------|-----|------|
| P0 | 6 | 対外説明と `enterprise.rs` / §11 の乖離 |
| P0 | 1 | R(T) と `thermo_genesis.rs` の式不一致 |
| P1 | 3 | ZK-Court 骨格はあるがパラメータ未固定 |
| P1 | 2 | CAAC 静的 probe のみ |
| P2 | 5 | Future Work ラベル済み — スコープ管理 |
| P2 | 4 | 未実装 — 書くなら短く |

---

## 次ステップ

1. ~~`GENESIS_V1.md` を `WHITEPAPER.md` にマージ~~ ✅ 完了  
2. ~~本ファイルの直接引用差し替え~~ ✅ 完了  
3. Steve + Claude セッションで P0/P1 を v1.1 目次に反映  
4. 実装追従は [`SPRINT_PLAN.md`](SPRINT_PLAN.md) と別トラック  
5. 起動レポート: [`WHITEPAPER_V1.0_LAUNCH.md`](WHITEPAPER_V1.0_LAUNCH.md)

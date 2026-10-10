# Testnet rewards experiment

Status: **built on the testnet branch, decisions below; not deployed.** It runs on the testnet only, and it decides nothing about
mainnet: mainnet supply and allocation are open and need legal advice before genesis (see the
local `docs/FUTURE_IDEAS.md`).

Testnet TET is a practice unit: it has no monetary value and cannot be bought. Everything here is
worded that way.

- **Use:** "granted", "you receive (practice)", "practice unit, can't be exchanged for money".
- **Never use:** earn, invest, price, yield or reward rate (the money guard enforces this, in
  en/ja/zh).
- **Every amount the page shows** reads like "+10 TET granted (practice unit, can't be exchanged
  for money)".

## Decisions (founder, 2026-10-10) and as built

- **"One per person" uses the open anonymity set now (option B), and it is weak:** registering in the
  set is free, so one person can register many members and claim many welcome grants. The page and
  this doc say so. Practice units only; the money guard is unchanged.
- **The switch to vouching (option C) once Shelter's vouches exist** is designed below; nothing in the
  claim format changes, only the root the proof is checked against.
- **Welcome grant, as built** (`tet-core/src/grants.rs`, `POST /grants/welcome`, `GET /grants/status`):
  - the claim is an anonymous membership proof made out to the receiver `SHA-256("tet grant welcome v1")`
    on day 0, signed by the proof's one-time key (PAE "tet grant claim v1"); one per nullifier and one per
    payout wallet; cap 1,000; the grant wallet keeps a floor of 10 TET (practice), counting grants
    still in the mempool;
  - the grant wallet sends 101.010101 so that **exactly 100 TET (practice) arrives** after the 1% transfer
    fee;
  - off unless the node has `TET_GRANT_MNEMONIC_FILE` (a separate grant wallet, never a seed's or the
    founder's);
  - checked end to end against a local node with the real prover: 0 → 100, and the same member's second
    claim, to another wallet, refused.
- **Thread grants, as built** (`tet-network/ui/app/lib/thread_grants.mjs` decides,
  `scripts/thread_grants.mjs` is the operator's rewarder, run by hand or on a timer; dry run by
  default, `--pay` pays):
  - 3 distinct repliers within 7 days, the starter excluded; named replies count by the signer the
    rewarder checks itself, anonymous ones by daily ID within a single UTC day;
  - one granted thread per person per day, 20 TET (practice) per person per day, 200 TET (practice)
    network-wide per day; never the same thread twice (a state file);
  - 10 TET (practice) halving every 1,000 vouched members, floor 0.01; until Shelter runs on the node the
    member count is 0, so the full 10;
  - **anonymous starters aren't paid yet:** they have no payout wallet; a claim flow (an anonymous
    proof naming a wallet, like the welcome claim) is the follow-up;
  - exactly the grant arrives (the transfer sends a little more, for the fee);
  - one log line per grant (board, thread, number of counted repliers, amount, recipient), no content;
  - checked end to end against a local node: a thread with 3 distinct repliers granted, one with 2
    not; a second run grants nothing.

## Switching "one per person" to vouching (option C)

When Shelter's in-person vouches are live on the node:
1. The node keeps, next to the open set, the Merkle root of **vouched** members (Shelter's member list,
   replayed from its signed record log), with the same leaf format, so the existing proving program
   works unchanged.
2. `decide_journal` accepts a welcome claim only if the proof's root is a known **vouched** root
   (`accepts_vouched_root`) instead of `accepts_anon_root`; everything else stays.
3. Nullifiers already used under option B stay used (a member who claimed under B can't claim again
   under C), and the cap counts both.
4. Thread grants' halving reads the vouched count (`/shelter/status` members), which it already does.
5. Tests: a proof against an open-set-only root is refused under C (negative control: accepting the open
   root passes it), and a vouched member's claim succeeds.
Until then, the welcome page says plainly that one person can claim more than once by registering more
than one member.

## What the experiment is for

To see whether a small, visible grant makes people:
- start conversations other people actually answer;
- vouch for real people.

It must not turn into a farm for wallets or empty threads. It's measured with counts only:
distinct people granted, threads with replies from at least 3 people, and grants refused as
duplicates.

## 1. Welcome grant: the opening 1,000 people, one per person

- **Amount:** 100 TET (practice), once per person.
- **Who:** the first 1,000 *people*, not wallets. Wallets are free to make, so "one per wallet"
  would be one per script.
- **How "one per person" is decided.** There are three options; I recommend C.

  | Option | How it works | Strength |
  |---|---|---|
  | A. Vouch | Only vouched members (Shelter's in-person vouch, at most 3 per voucher) can claim, with their member key. | Strongest; slow to reach 1,000; the claim is linked to the member key. |
  | B. Nullifier over the anonymity set | A membership proof with a grant-specific nullifier: one claim per registered member, anonymously. | Weak today: registering is free, so one person can register many members. Say so on the page. |
  | **C. Nullifier over the vouched set** | The same anonymous proof, but against the root of *vouched* members (the per-list root that polls and Shelter use). | One claim per vouched person, and the claim doesn't say which member made it. |

- **The grant nullifier.**
  - It's `SHA-256("tet-null-v1" ‖ secret ‖ grant-receiver ‖ bucket 0)`.
  - Its receiver is a dedicated grant wallet, and the day is fixed at 0 instead of today. So each
    member gets one nullifier forever, not one per day.
  - This needs no change to the proving program: the receiver and day are already inputs.
- **Paying.** The grant wallet pays by an ordinary signed transfer, on the chain, to the wallet the
  claimant names.
  - The claim proves membership without naming the member, so the receiving wallet isn't linked to
    a member key.
  - The node still sees the claimant's IP address and timing. The page says so.
- **Counting.** The node counts claims and stops at 1,000. The count is public, e.g. "438 of 1,000
  granted". A claim whose nullifier has been used is refused, with the reason given.

## 2. Thread grants: only for threads that real people answer

- **The rule.** A thread's starter receives a grant (practice) when the thread has replies from at
  least **3 distinct people** other than the starter, within 7 days of its opening post.
- **Distinct people.**
  - Named replies count by member key.
  - Anonymous replies count by daily ID, which is one per member per board per day. Two daily IDs
    on different days can be the same person, so anonymous replies count only within one day.
    Spreading the replies across days doesn't add people. (That's the weaker side; stated.)
  - The starter's own replies never count.
- **Where it works.** Only public boards. Posts are end-to-end encrypted; the node can't read any
  thread. A rewarder process reads public boards with their public invites, as any visitor can,
  and grants from there. Invite-only boards and Shelter are not eligible, because nobody outside
  can read them, the rewarder included.
- **Caps.**
  - One granted thread per person per UTC day: by member key for named starters, by daily ID for
    anonymous ones.
  - At most 20 TET (practice) granted per person per day, in total.
  - A network-wide daily total; when it runs out, the page says "today's grants are used up".
- **The grant shrinks as the network grows** (halving-style schedule):
  - grant = 10 TET (practice) ÷ 2^⌊vouched members ÷ 1,000⌋, so 10, 5, 2.5 … per granted thread;
  - with a floor of 0.01;
  - the next halving point is shown on the page.
- **Farming limits.**
  - A pair or ring of people answering each other's threads every day is limited by the
    per-person daily cap.
  - With vouching, rings are traceable through the moderation log.
  - What isn't prevented: three real people agreeing to answer each other. The grant is small and
    capped for that reason.

## 3. Showing balances

- **Where it shows:** a wallet's testnet balance appears next to its ID as
  "120 TET (practice unit, can't be exchanged for money)".
- **Grants:** each one appears in a small list: "+10 TET granted (practice unit, can't be
  exchanged for money)", with the reason ("welcome grant", "your thread got replies from 3
  people").
- **Status:** balances ship now, ahead of this experiment (with a guard).

## Wording (guarded)

- **Allowed:** granted, you receive (practice), practice unit, can't be exchanged for money.
- **Never:** earn, invest, price, buy, yield, APY, "reward rate", "make money". The money guard
  covers en, ja and zh.
- **A new check:** any amount of TET the page shows carries the practice-unit line.

## Threats and limits, said plainly

- **Sybil:** "one per person" is only as strong as vouching (option C). Option B is weak, and
  nothing here works without some identity step.
- **Collusion:** small groups can cooperate for thread grants; caps keep the effect small.
- **Operator trust:** the rewarder is run by the operator (a central testnet experiment), and its
  grants are signed transfers that anyone can check. A log line per grant records the thread's
  board, the counted reply IDs and the amount, without post content.
- **Privacy:** the welcome claim is anonymous among vouched members. Thread grants go to the
  starter's own wallet (named) or to a wallet the anonymous starter names; the node sees IPs.
- **Mainnet:** no promise that testnet balances carry over. That's undecided, and the testnet can
  be reset (the footer, Terms and FAQ say so).

## Tests (each with a negative control)

- **Welcome grant:**
  - a second claim with the same nullifier is refused;
  - claim 1,001 is refused;
  - a proof against a non-vouched root is refused (option C).
- **Thread grants:**
  - 3 replies from 2 distinct people grant nothing;
  - the starter's own replies don't count;
  - the per-person daily cap holds;
  - the halving schedule gives 10, 5, 2.5 at 0, 1,000 and 2,000 members.
- **Wording:**
  - money words are caught in en, ja and zh;
  - every TET amount on the page carries the practice line.

## Open questions for the founder

1. Option C (needs vouching, i.e. Shelter) or B (sooner, weaker)?
2. Are the amounts right: 100 welcome, 10 per thread, 20 per day per person?
3. Are 3 distinct repliers within 7 days the right bar?
4. Should the rewarder's grants come from a separate testnet "practice grants" wallet, funded once
   from genesis?

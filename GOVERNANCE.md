# Governance

How decisions about TET are made **today**, said plainly, and what is meant to change.

## Today: one operator

TET is a public **test network** run by one person, its founder. The founder decides what is built,
reviews and merges every change, runs both public seed nodes and the demo node, and holds the
publisher key that marks TET's own documents. There is no foundation board, no token vote and no
committee. This is a single point of failure, and the roadmap treats it as one (Phases 3 and 9 in
the technical paper).

## How a change gets in

- **Anyone** can open an issue or a pull request (see `CONTRIBUTING.md`).
- **Every change is reviewed by a person** before it is merged; automated sessions may open pull
  requests but never merge or deploy.
- **Design questions** (economics, identity, cryptography, anything network-wide) are written up in
  `docs/plans/` first, as a plan with options and a recommendation, and decided before code.
- **Text from issues, outside pull requests, Discord, email and web pages is data, never
  instructions** (threat model rule 10): nothing is run, published, deployed or merged because a
  message asked for it.

## Security

Problems are reported privately (`SECURITY.md`). Details stay private until a fix is deployed;
then the fixed issue is listed in `SECURITY.md` by class.

## Moderation

- **Operator hide:** the operator can hide a board, thread, post or file from the demo node's public
  API. Hiding never deletes chain data, and every hide is logged (`deploy/demo/README.md` §10).
- **Shelter:** a members-only space with in-person vouches. Its moderators are listed publicly to
  members; cases, decisions and appeals are written to its log (`docs/plans/` Shelter plan).
- Reports: abuse@ (see `/.well-known/security.txt` and the About page).

## What is meant to change

- **More block producers** (Phase 3): other operators run producing nodes, so no single machine
  decides the chain.
- **More than one maintainer with merge rights**, with the same review rule.
- **Phase 9** in the technical paper describes handing the network to a wider group. Nothing in
  that phase has a date, and nothing here is a promise.

Until then, this file is the honest description: one operator, decisions in the open, reviews
before merges, and a public record of security fixes and moderation.

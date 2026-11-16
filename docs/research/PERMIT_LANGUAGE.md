# Permits written as sentences

**Status: idea.** A sketch on /research, not a design. Nothing here is proposed, planned or reviewed.

## What the sketch is

One rule per line:

```
allow agent "shopper" to "buy" once, before block 5000
allow agent "mailer" to "send-email" once, before block 3
```

A parser in the page (`tet-network/ui/app/site/run/permit_lang.ts`) turns each line into one
one-time permit of the machine notebook (`tools/machine-notebook`, `tet_machine_permit_v1`), in that
agent's own log, signed with a test key made in the tab. It then runs the page's permit check
(`lib/machine_log.mjs`, the port of `notebook.py verify`) three times: the agent uses the permit (accepted),
uses it again (refused: already used), and every other agent named in the text tries to use it
(refused: signed by another key).

The whole language is that one sentence form. The parser refuses anything else, each with its own
reason: a rule that is not `once` ("every permit here is one-time"), a rule without an end ("a permit
needs an end"), `before block 1`, and more than 12 rules (the limit is named, never cut short).

Two choices in the sketch are worth stating because they are easy to misread:

- **A "block" is a record number in the agent's log, not a chain block.** `before block N` becomes the
  permit's `expires_seq` = N − 1. No chain is involved, and the page says so.
- **Nothing is added to the permit.** The language can only say what `tet_machine_permit_v1` can
  hold: an action, used once, up to a record number. The agent's name picks the log (and so the key);
  it is not written into the permit.

## What the sketch shows, and what it does not

It shows that a short sentence can be turned mechanically into the permit TET's notebook already
has, and checked by the same code, with no new format and no new cryptography.

It does not show that a permission language is a good idea for TET, what one should contain, or how
it would be used. It has no conditions, no groups of agents or actions, no amounts, no deny rules and
no way to combine rules. It has not been used for anything.

## Compared with Cedar and OPA

Both are mature, widely used policy languages. The comparison below is from their public
documentation as we know it; it was written without network access and not checked against their
current releases, so anything specific should be re-read before it is relied on.

| | This sketch | Cedar | OPA (Rego) |
|---|---|---|---|
| What it is | One sentence form, in one page | A policy language and evaluator (open source, Rust), used by Amazon Verified Permissions | A general-purpose policy engine with its own language, Rego (CNCF project); used for Kubernetes admission, API gateways and more |
| What a rule can say | One agent, one action, once, before a record number | `permit` / `forbid` over a principal, an action and a resource, with `when` / `unless` conditions on their attributes | Any rule over JSON input and loaded data; Rego is Datalog-like and much more expressive |
| What it answers | Did this agent's log use this permit at most once, before it ran out? | Is this one request allowed? | Whatever the policy computes for this input: allow/deny, or any JSON |
| Counting uses | The point: the second use is refused, from the signed log | Not built in: evaluation is a function of the request and the data passed in; counting needs state the caller keeps | The same: decisions are computed from the input and data; a use counter is state kept outside the policy |
| Evidence afterwards | The agent's signed, hash-linked log; anyone can re-check it offline | A decision (and whatever the caller logs) | A decision (and OPA's decision logs, if enabled) |
| Analysis of policies | None | Schema validation, and tools that reason about policies (for example, whether one set allows anything another forbids) | Tests and tooling for Rego; no general proof of policy properties |
| Maturity | A sketch | In production use, specified and documented | In production use, widely deployed |

What this means, plainly:

- **Cedar and OPA are far more capable as languages.** Anything this sketch can say, either can say
  as a rule ("shopper may buy"). Neither needs to change to express it.
- **The difference is not the language; it is where "once" is enforced and what is left behind.**
  Cedar and OPA decide whether a request is allowed now. To make a permission single-use, the system
  around them has to remember that it was used, and the record of that is whatever that system logs.
  In the notebook, the use *is* a signed record in the agent's own log, and a second use is visible to
  anyone who re-checks the log, without trusting the system that made the decision.
- **That property comes from the notebook, not from the sketch.** The notebook's own limit applies
  unchanged: "once" means once per log, not once in the world. A copied key could start a second log
  and use the same permit there (see the machine-notebook README and the "Once in the world" idea on
  /machines).

So if TET ever wanted a richer way to write permissions, the honest options look like:

1. **Use Cedar or OPA to decide, and the notebook to record.** The policy engine says whether an action
   is allowed; the agent then claims a one-time permit in its log before acting. This keeps a mature
   language and adds TET's evidence, at the cost of two systems that must agree.
2. **Keep a tiny language like this sketch,** because each sentence maps exactly onto a permit and
   nothing can be written that the check cannot enforce. It stays small on purpose.
3. **Neither.** Permits issued directly, as `notebook.py permit` does today, may be all that is needed.

None of these is chosen. Option 1 is the one that does not ask anyone to learn a new language.

## Open questions

- Should a rule be able to name a key rather than an agent name? Today the name only picks the log.
- Is a record number a useful deadline for people, or would they expect time? (The notebook counts
  records on purpose: a device's clock is one of the things its log does not show.)
- Would "once in the world" change what the language has to say? It is an open question on its own.

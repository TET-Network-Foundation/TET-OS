# Futures: when will someone have to trust a machine's own record?

**Status: a forecast, not a fact.** Written for the simulator demo so that each scenario can say whether
it is about today or about a world that may come. No web was read. Every trend, rule and product below is
**from memory, unchecked** unless it names a file in this repository. Likelihoods are rough words, not
numbers anyone measured. Nothing here is a promise, and no year below is a date anything will happen.

Each line: the situation; what makes it likely or not; a rough likelihood; what a signed log would settle
then and what it still would not; what would make TET irrelevant there.

The base case, for every line below: nobody ever disputes the machine's log, and a plain log is enough.
That is the likeliest outcome for most machines, and in it a signed log adds nothing.

The property under test is the same as in CASES.md: the key stays in the machine, and the copy of the log
passes through hands that do not hold it.

## About 3 years

1. **Delivery and survey drones in ordinary airspace, under remote identification rules.**
   Likely or not: remote ID is required for most drones in the US and the EU (memory, unchecked); flights
   beyond visual line of sight are being authorised case by case (memory). Likelihood: plausible that more operators may be asked for flight logs by authorities and clients. Settles: an exported log edited by the
   pilot or a subcontractor (CASES.md cases 1, 2). Not: that the GPS or barometer told the truth;
   completeness at the end of the log. Irrelevant if: flight controllers sign their own logs in a format the authorities
   adopt, or the authority's own remote ID receivers become the record.
2. **Cold-chain shipments of medicines and food with digital loggers handed between carriers.**
   Likely or not: this is happening today (memory: GDP rules, data-logger clouds). Likelihood: likely to continue. Settles: a read-out lowered or trimmed by a carrier (CASES-2.md case 1). Not: probe
   placement; whether the key left the device, or who used it. Irrelevant if: one logger maker's cloud
   becomes the norm that receivers trust, or loggers sign with keys in hardware under an industry format.
3. **AI agents that buy things or send messages on a person's behalf.**
   Likely or not: agent products that act on the web exist (memory); payment providers are discussing
   agent payment rules (memory, unchecked). Likelihood: possible. Settles: a session forwarded by a third
   party unchanged. Not: what the service that runs the agent and holds its key chose to log (CASES-2.md
   case 4 was dropped for this). Irrelevant if: one of the many signed-receipt drafts becomes a standard
   (how-is-it-different.md lists more than ten).
4. **Shared lab instruments in core facilities with data-integrity reviews.**
   Likely or not: research-integrity offices and some journals ask for raw data (memory). Likelihood:
   possible, slowly. Settles: a dropped or edited reading in an export the analyst carried. Not: whether the run
   handed on was the only one made. Irrelevant if: instrument makers ship signed exports, or the
   facility's own audit trail is accepted.

## About 10 years

1. **Self-driving labs whose runs go straight to collaborators and journals.**
   Likely or not: automated "self-driving" lab platforms are an active research area (memory, unchecked);
   journals asking for machine-signed raw runs is not a rule anywhere we know of. Likelihood: possible.
   Settles: that the run in the paper's data package is the instrument's, in order, with no reading taken
   out of the middle, checked by the journal offline against the facility's pin. Not: that the sample was
   what the label says; whether the run handed on was the only one made.
   Irrelevant if: journals do not ask for raw runs at all (the likeliest case, since no such rule is
   known to us); instrument makers sign data in hardware under a common format; or journals rely on a
   lab platform's hosted record instead. **This is the future scenario the demo builds.**
2. **Robot fleets shared between companies (a warehouse robot leased to several tenants).**
   Likely or not: robots-as-a-service exists (memory). Likelihood: possible. Settles: a tenant's copy of
   the robot's log, forwarded by the fleet operator's support desk, unchanged. Not: what the fleet
   operator, who holds the keys, chose to log. Irrelevant if: fleet platforms provide signed audit logs.
3. **Home and care robots whose records reach families, insurers or care inspectors.**
   Likely or not: depends on care robots becoming common; slow so far (memory). Likelihood: possible,
   uncertain. Settles: a record passed through the care provider unchanged, if the robot's key is not
   the provider's. Not: anything about the person cared for; and this field holds personal data that must
   stay on the device (the project's design principle: TET proves, never stores). Irrelevant if: robot
   makers keep records in their own clouds and regulators accept that.
4. **Insurers and authorities inspecting machines remotely from their own logs.**
   Likely or not: usage-based insurance reads telematics today (memory). Likelihood: possible in some fields. Settles: a log forwarded by the owner unchanged, when the key is sealed in the machine. Not: a
   sensor that lied; whether the key left the device, or who used it. Irrelevant if: insurers read directly from the
   maker's cloud.

## About 20 years

1. **After large quantum computers, old classical signatures are no longer trusted.**
   Likely or not: unknown timing; standards bodies have published post-quantum signature standards
   (ML-DSA is FIPS 204, memory) and set migration goals (memory, unchecked). Likelihood: possible within
   20 years; the timing is genuinely uncertain. Settles: a log signed today with both Ed25519 and
   ML-DSA-44 (as the notebook does, tools/machine-notebook/README.md) may still verify on its ML-DSA half,
   which is not publicly known to be broken by quantum attacks (unchecked).
   Not: that ML-DSA itself holds up; it is younger than Ed25519. Irrelevant if: every maker adopts
   post-quantum signatures on its own, which is what the standards ask for (memory); then the hybrid is no longer
   a difference, and the only question left is who offers the checker.
2. **Machines that hold their keys in hardware by default.**
   Likely or not: secure elements are already in many devices (memory). Likelihood: possible. Settles: it
   may narrow what this demo does not judge (whether the key left the device; who used it is still not judged); a signed log is then only as useful as the format the
   checker can read. Irrelevant if: the chip makers' own attestation formats become the record, which may happen: then TET would at most be one checker among many.
3. **Records that must be checked decades later, after the maker is gone.**
   Likely or not: long-lived infrastructure and medical records already need this (memory). Likelihood: plausible as a need. Settles: an offline check that needs no maker's server, as long as the pin and the
   format note survive. Not: that the reader still has the tool; a format nobody can read is no record.
   Irrelevant if: a public standard for signed machine logs exists and TET does not follow it.

## Tags used on the page

- **today**: the near miss, the geofence exit, the ground robot's general checks, the cold-chain
  excursion.
- **about 10 years: a forecast, not a fact**: the lab run handed to a journal.

# Cases, round 2: machines that are not vehicles

**Status: on paper, for the simulator demo.** No web was read for this file. Every rule, product or
practice named below is **from memory, unchecked**: treat each as a lead to look up, not as a citation.

## The rule (the same as in [CASES.md](CASES.md))

A signed log helps only where **the key stays in the machine and the copy of the log passes through
hands that do not hold it**. The check judges edits, reorderings and records taken out of the middle
of the copy; it does not judge a log produced by the key's holder, sensor truth, which machine held the
key, when each record was written, or whether the log is complete at its end.

A case is dropped when an ordinary record, the maker's cloud or the result itself already
settles it; when the question needs "which machine" or "the sensor told the truth"; or when the person
asked holds the key.

## Eight candidates

Each: who asks whom; the record today; what goes wrong; what a signed log settles and does not; kept or
dropped, and why.

### 1. A cold-chain temperature logger travelling with a shipment
- **Who asks whom:** the receiver (a pharmacy wholesaler, a food buyer) or its insurer asks the shipper
  and the carriers whether the goods stayed in their range, and in whose custody an excursion happened.
- **Record today:** a logger packed with the goods, read out at arrival as a PDF or CSV, or uploaded to
  the logger maker's cloud. Some single-use loggers make a PDF that is hard to edit (memory).
- **What goes wrong:** the read-out passes through a carrier or a forwarder before it reaches the
  receiver. An excursion (a door left open at a stop) is expensive for whoever had custody, so the copy
  is where the pressure is: the peak can be lowered, the excursion taken out, or moved past the
  hand-over time so it falls in the other carrier's leg.
- **Signed log settles:** that the temperatures in the copy are the ones the logger's key signed, in that
  order, with none taken out of the middle. Lowering the peak, taking it out, or swapping it with the next
  record is refused, with no help from the logger maker's server. Not judged: whether the records at
  the end of the journey are in the copy. A swap is refused
  as an order change; the log shows order, not when, so where one carrier's leg ends must come from
  somewhere else (a scan at hand-over, the shipping document).
- **Does not settle:** that the probe read the air around the goods (a logger next to the cooling unit
  reads cold); that the logger travelled with these goods; whether the key was read out of the logger;
  whether the log is complete at its end.
- **Kept, with a condition.** The receiver is a third party and the carrier carries the copy. But a
  carrier holds the device for hours, so the case holds where the key is kept in hardware, which the
  notebook does not judge. The maker's cloud settles it for one brand on one cloud; a signed log can be checked
  offline against a pinned key, for any maker that signs. It does not say which logger, or that it
  travelled with these goods.
- **Rules (memory, unchecked):** EU Good Distribution Practice for medicinal products (2013/C 343/01)
  asks for temperature records in transport; US FDA 21 CFR Part 11 for electronic records; the
  WHO guidance on time- and temperature-sensitive products.

### 2. A maker's 3D printer or CNC job log handed to a customer
- **Who asks whom:** a customer asks the maker whether a part was printed with the agreed material,
  temperature and settings, or whether a job was interrupted and resumed.
- **Record today:** the slicer file, the printer's own job history, photos, and the maker's word.
- **What goes wrong:** the maker runs the printer and holds its key, and is the one asked; the check
  does not judge a log the maker produced.
- **Signed log settles:** only that the copy was not edited after it left the maker, for example by a
  marketplace or a reseller between the maker and the customer.
- **Does not settle:** anything the maker would want to hide; that the nozzle thermistor read right.
- **Dropped.** The person asked holds the key. The part itself (its dimensions, a test print) settles
  most disputes.
- **Not judged:** a log the maker produced, because the maker holds the key; a copy that passes through someone else (a print farm's queue, a club's shared printer) is judged for edits after it left the maker.

### 3. A lab instrument's measurement run handed to a collaborator or a journal
- **Who asks whom:** a collaborator, a journal's data editor or an institution's research-integrity
  office asks the analyst for the raw run behind a figure.
- **Record today:** the instrument software's export (CSV, a vendor file), sometimes with an audit trail
  inside the vendor software; the analyst's spreadsheet. In regulated labs, audit-trail rules apply
  (21 CFR Part 11; the ALCOA+ principles, memory).
- **What goes wrong:** the export passes through the analyst, who has a reason to want a cleaner curve.
  Removing an "outlier" reading or smoothing a value in a CSV leaves no trace in the copy. Where the
  instrument is run by a shared facility, the analyst does not hold the instrument's key.
- **Signed log settles:** that the readings in the copy are the ones the instrument's key signed, in that
  order, with none taken out of the middle: a dropped outlier in the middle of the run is named as a
  missing record, an edited reading as a broken signature. Whether the copy is complete at the end of
  the run is not judged.
- **Does not settle:** that the sample in the well was what the label says; that the instrument was
  calibrated; which instrument (the facility's pin says which key); whether the run handed on was the
  only one made.
- **Kept,** with the condition stated: it holds where the instrument's key is held by the facility or the
  instrument, not by the analyst. The check judges one run's readings, not whether other runs were made, and the page says so. Where the facility's
  own audit trail (inside the vendor software) is available to the journal, it may already settle this;
  a signed export matters when only the exported file travels.

### 4. An AI agent's tool-call session handed to the person it acted for
- **Who asks whom:** the person the agent acted for (or their employer, or a payment provider) asks the
  service that ran the agent what it did.
- **Record today:** the service's own logs and the chat transcript.
- **What goes wrong:** the service runs the agent and holds its key, and it is the party asked.
- **Signed log settles:** that a copy forwarded by someone else (an employee exporting it for a
  complaint) was not edited.
- **Does not settle:** what the service would want to hide; that the model did what the log says.
- **Dropped for today.** The person asked holds the key. Many neighbours already sign agent receipts (see
  prep/answers/how-is-it-different.md). It could change if the agent runs on the person's own device or
  in hardware whose key the operator cannot use; that is a forecast (FUTURES.md), not a case.

### 5. A building's sensor or energy sub-meter log given to a tenant or an auditor
- **Who asks whom:** a tenant asks the landlord about a sub-metered energy bill; an auditor asks for a
  building's interval data behind an energy rating.
- **Record today:** the meter's register (the running total on its display) and the landlord's or the
  building system's interval export.
- **What goes wrong:** the interval export passes through the landlord or a building manager.
- **Signed log settles:** that the interval readings in the copy are the meter's, if the key is in a
  sealed meter.
- **Does not settle:** the meter's accuracy, which is what billing disputes are about.
- **Dropped.** The register on the display already settles the total, and billing meters fall under legal
  metrology rules (the EU Measuring Instruments Directive, memory). The interval-data case is weaker
  than case 1 and turns on sensor truth.

### 6. A rented tool's or vehicle's usage log between owner and renter
- **Who asks whom:** the owner claims the renter overloaded or overused the tool; the renter asks for the
  record.
- **Record today:** the hour meter, telematics in the owner's fleet portal.
- **What goes wrong:** the owner holds the machine and its key and makes the claim.
- **Dropped.** The party whose record is in question holds the key. The hour meter and a hand-over
  inspection settle most of it.

### 7. An inspection robot's or a camera trap's capture log
- **Who asks whom:** an asset owner asks the inspection contractor whether every section was inspected;
  a research project asks whether camera-trap images are from the stated place and time.
- **Record today:** the contractor's report and images; the camera's image files with their metadata.
- **What goes wrong:** the contractor holds the robot and its key. For images, the question is whether a
  picture is genuine and where it was taken.
- **Dropped.** The person asked holds the key (inspection), and media provenance has its own standard in
  production (C2PA, memory), built into some cameras. Where it was taken is a "sensor told the truth"
  question.

### 8. A measuring kiosk's or a voting machine's event log
- **Who asks whom:** a customer asks about a weighing or a dispensing; an election body asks about a
  machine's events.
- **Dropped.** Weighing and dispensing fall under legal metrology with sealed, certified instruments
  (memory). Voting systems have their own certification regimes and public trust questions far beyond a
  signed log; this demo stays out of elections.

## Which cases are kept

| Case | Kept? | Why |
|---|---|---|
| 1. Cold-chain logger | kept, with a condition | the carrier carries the copy; holds where the key is kept in hardware, which the notebook does not judge; checks offline against a pin |
| 2. Maker's printer log | dropped | the maker holds the key and is the one asked |
| 3. Lab instrument run | kept, with a condition | the facility or the instrument holds the key, the analyst carries the export; the check judges one run, not whether other runs were made |
| 4. AI agent session | dropped for today | the service holds the key and is asked; future variant in FUTURES.md |
| 5. Building sub-meter | dropped | the register and legal metrology settle the bill; the rest is sensor truth |
| 6. Rented tool | dropped | the owner holds the key and makes the claim |
| 7. Inspection robot, camera trap | dropped | the contractor holds the key; media provenance has its own standard |
| 8. Kiosk, voting machine | dropped | legal metrology or election certification; out of scope |

Two cases survive out of eight.

## What the demo builds from the two that survive

| Scenario | Machine | Tag | What someone would try | What refuses it |
|---|---|---|---|---|
| A shipment's temperature excursion | simulated cold-chain box | today | the peak temperature lowered to 7.8 °C in the copy | that record's signature |
| same | same | today | the peak record taken out | the record after it: "a record is missing" |
| same | same | today | the door-open record swapped with the one after it (the excursion moves one record later) | both records' seq |
| A lab run handed to a journal | simulated plate reader | about 10 years: a forecast, not a fact | the outlier reading taken out | the record after it: "a record is missing" |
| same | same | about 10 years: a forecast, not a fact | one reading edited to smooth the curve | that record's signature |

In both, the record that is changed or taken out has records after it. Not judged: whether the log is
complete at its end; the "does not show" list says so.

The lab scenario is tagged as a forecast because today journals rarely ask for an instrument-signed run;
the case itself (an analyst carrying an export) is today's. See FUTURES.md.

# Cases: when someone later asks "what did the machine do, and can I trust this record?"

**Status: on paper, for the simulator demo.** No web was read for this file. Every rule named below is
**from memory, unchecked**: treat each as a lead to look up, not as a citation.

## The one thing a signed log can add

In every case below, the useful situation is the same: **the key stays in the machine, and the copy of
the log passes through hands that do not hold it** (a pilot exporting from the aircraft, a subcontractor
forwarding it, an office filing it). The check judges edits, reorderings and records taken out of the
middle of the copy; it does not judge a log produced by the key's holder, sensor truth, which machine
held the key, or whether the log is complete at its end.

## Seven candidates

Each line: who asks whom; the record they hold today; what goes wrong with it; what a signed log would
and would NOT settle.

### 1. A delivery drone's flight log after a near miss or a complaint
- **Who asks whom:** the aviation authority or an accident investigator, or the other party's insurer,
  asks the drone operator.
- **Record today:** the flight log the flight controller writes, exported by the remote pilot from the
  aircraft or the controller app; for some brands also the manufacturer's cloud.
- **What goes wrong:** the export passes through the pilot, who is the person the question is about.
  Altitude or position lines in a CSV export can be edited before it reaches the safety manager or the
  authority. The manufacturer's cloud is the manufacturer's, not a neutral party's, and covers one brand.
- **Signed log would settle:** that the altitude lines in the copy are the ones the aircraft's key
  signed, in that order, with none taken out of the middle.
- **Would NOT settle:** that the barometer or GPS altitude was right; which aircraft held the key;
  whether the log is complete at its end.
- **Rules (from memory, unchecked):** US 14 CFR 107.9 (report an accident with serious injury or over
  USD 500 of damage within 10 days); 107.51 (400 ft limit); EU Regulation 2019/947 (120 m limit in the
  open category) and Regulation 376/2014 (occurrence reporting).

### 2. A survey drone's geofence and altitude record for a client or the authority
- **Who asks whom:** a client (a site owner, a rail or power company) or the authority asks the survey
  operator whether the flight stayed inside the agreed area.
- **Record today:** the flight log and a map export; the geofence is set in the app.
- **What goes wrong:** a gust pushes the aircraft over the line for a few seconds. The export is
  delivered with the report; the lines that show the exit can be dropped, or moved so the exit seems
  to happen at another time.
- **Signed log would settle:** that no record was taken out of the middle or moved, and that each was
  signed by the pinned key (not which aircraft held it).
- **Would NOT settle:** that the GPS position was true; that the geofence in the app was the agreed one.
- **Rules (from memory, unchecked):** EU specific-category operations under an authorisation (SORA)
  with an operational volume; EU geography zones and geo-awareness (Regulation 2019/945); US LAANC
  airspace authorisations; remote ID (US Part 89, EU direct remote identification) broadcasts position
  but is not a record the operator keeps.

### 3. A one-time permission: one flight, or one passage through a gate
- **Who asks whom:** a site owner (a farm, a quarry, a client site) that allowed one flight over its
  land, or one passage of a ground robot through a gate, asks the operator after a second visit is
  reported.
- **Record today:** an email or a form ("you may fly on Tuesday"); the machine's log does not name it.
- **What goes wrong:** one permission is cited for two flights, or used after it ran out, and nothing
  ties the use to the grant.
- **Signed log would settle:** that this log does not cite one permission twice, or after its last
  allowed record.
- **Would NOT settle:** use of the permit outside this log; today the
  permit is signed by the machine's own key, so it shows what the machine claims was allowed, not that
  the owner allowed it (not judged: the permit is signed by the machine's own key).
- **Rules (from memory, unchecked):** none specific; landowner permission is a civil matter in most
  places, and an authority's flight authorisation is a separate document.

### 4. A warehouse robot after a collision
- **Who asks whom:** the site's safety officer or insurer asks the robot's operator or vendor.
- **Record today:** the vendor's fleet manager logs, and usually CCTV.
- **What goes wrong:** the dispute is whether the robot's sensors saw the person or the rack.
- **Signed log would settle:** little that the fleet logs and the camera do not.
- **Rules (from memory, unchecked):** ISO 3691-4 for driverless industrial trucks; OSHA 29 CFR 1904
  injury records in the US.

### 5. A cleaning or lawn robot's coverage record for a contract
- **Who asks whom:** the customer asks the contractor whether the area was covered.
- **Record today:** the vendor app's coverage map.
- **What goes wrong:** the question is whether the work was done, which the floor or the lawn shows.

### 6. A farm sprayer's record of where it sprayed
- **Who asks whom:** a neighbour after drift, or the authority, asks the farmer.
- **Record today:** the spray record a professional user must keep, often written by hand afterwards.
- **What goes wrong:** the question is where the spray went, which needs the GPS and the nozzle to have
  told the truth; and the farmer holds the machine and its key.
- **Rules (from memory, unchecked):** EU Regulation 1107/2009 Article 67 (application records);
  Directive 2009/128/EC Article 9 (aerial spraying banned unless derogated).

### 7. A maintenance record handed from one owner to the next
- **Who asks whom:** a buyer asks the seller.
- **Record today:** a paper logbook or the app's history.
- **What goes wrong:** the seller holds the machine and its key; the check does not judge a log the key holder produced.

## Which cases are kept

Dropped: every case where an ordinary log or the maker's cloud already settles it, and
every case that needs "which machine" or "the sensor told the truth".

| Case | Kept? | Why |
|---|---|---|
| 1. Near miss, altitude | kept | the copy passes through the pilot, who does not hold the aircraft's key; editing it is the risk |
| 2. Survey geofence exit | kept | the same: a delivered export with lines dropped or moved |
| 3. One-time permission | **dropped** | the operator runs the machine whose key signs the permit, so the person asked holds the key; the ordinary log and the email already show two take-offs |
| 4. Warehouse collision | dropped | fleet logs and CCTV settle what happened; the open question is sensor truth |
| 5. Coverage for a contract | dropped | the floor or the lawn settles it; coverage needs position truth |
| 6. Farm sprayer | dropped | needs position and nozzle truth; the farmer holds the key |
| 7. Maintenance handover | dropped | the seller holds the key; a countersignature by the maintainer is not built |

Two cases survive, not three or four. Both are drone cases. No ground-robot case survived.

## What the demo does with the two that survive

| Scenario | Vehicle | What someone would try | What refuses it |
|---|---|---|---|
| Near miss | simulated drone | the altitude of the climb record is lowered to 118 m in the copy | that record's signature |
| Near miss | simulated drone | the climb record is taken out of the copy | the record after it: "a record is missing" |
| Geofence exit | simulated drone | the exit record and the one after it trade places | both records' seq |
| Geofence exit | simulated drone | the exit record is replaced with a record saying `fence=in`, signed by another key | that record's key (not the pinned key); the next record's prev; "2 different keys" for the log |

"Swapped in from another aircraft's log" is a which-machine claim: the check
cannot say which aircraft. The button is worded for what the check does show: the record was signed by
a key that is not the pinned one.

The ground robot has three changes (alter a value, use the one-time permit twice,
swap two records), labelled on the page as not tied to a real case. The one-time permit stays tested
because the notebook has it, but case 3 shows why it settles little while the machine's own key signs
the permit.

Each change is tested in `test_robotsim.py` and has a negative control in `controls.sh`.

**On screen, for case 1:** the check judges the records in the copy, up to the last one it holds. It
does not judge whether the copy is complete at its end, where the records after an incident would be.
The page's "does not show" list says so for every scenario.

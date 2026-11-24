#!/usr/bin/env python3
"""notebook.py, run with a fixed clock: what samples.py runs in place of notebook.py when it makes samples.

A notebook record carries the device clock (clock_utc). Samples are made up and are handed to people
outside this machine, so they must not carry the time of the machine that made them. This runs the real
notebook.py, unchanged, with one difference: its clock reads SAMPLE_CLOCK_UTC (1970-01-01T00:00:00Z, the
Unix epoch), always. Every record in a sample set therefore carries that one obviously-not-real time.

    python3 sample_clock.py --tet-cli <path> <notebook.py arguments>
"""

import datetime as dt
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import twoparty as tp  # noqa: E402  (puts notebook.py's folder on the path)

nb = tp.nb
SAMPLE_CLOCK = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
SAMPLE_CLOCK_UTC = "1970-01-01T00:00:00Z"


class SampleDatetime(dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return SAMPLE_CLOCK.astimezone(tz) if tz else SAMPLE_CLOCK.replace(tzinfo=None)


def fixed_clock_module():
    """A stand-in for the datetime module, as notebook.py uses it: its clock is SAMPLE_CLOCK."""
    m = types.ModuleType("datetime")
    m.__dict__.update(dt.__dict__)
    m.datetime = SampleDatetime
    return m


if __name__ == "__main__":
    nb.dt = fixed_clock_module()
    sys.exit(nb.main())

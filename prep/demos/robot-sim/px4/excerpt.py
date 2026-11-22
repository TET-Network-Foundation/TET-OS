"""Cut a small excerpt from a ULog that PX4 wrote, so the tests on a real PX4 log can run where the full
log (tens of MB) is not committed.

Every message is kept byte for byte, in its original order. The 16-byte file header and every message
that is not logged data (formats, info, parameters, subscriptions, logged strings, sync) are all kept.
Of the logged data, only the two topics the replay reads are kept (vehicle_local_position and
vehicle_attitude), and of those only every `--every`-th message per topic. Nothing is rewritten, so
the excerpt is a ULog that PX4 wrote, with messages left out; it is not a log PX4 would write itself.

    python3 excerpt.py --src <PX4 .ulg> --out px4-sitl-excerpt.ulg --every 40
"""

import argparse
import hashlib
import struct

import ulog

TOPICS = ("vehicle_local_position", "vehicle_attitude")


def cut(buf, every):
    if every < 1:
        raise ValueError("--every must be 1 or more")
    ulog.read_header(buf)
    subs = {}
    seen = {}
    out = [buf[:ulog.HEADER_LEN]]
    for off, t, body in ulog.messages(buf):
        raw = buf[off:off + 3 + len(body)]
        if t == "A":
            msg_id = struct.unpack_from("<H", body, 1)[0]
            subs[msg_id] = body[3:].decode("ascii", "replace")
        if t == "D":
            msg_id = struct.unpack_from("<H", body, 0)[0]
            topic = subs.get(msg_id)
            if topic not in TOPICS:
                continue
            n = seen.get(msg_id, 0)
            seen[msg_id] = n + 1
            if n % every:
                continue
        out.append(raw)
    return b"".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--every", type=int, default=40)
    a = ap.parse_args()
    with open(a.src, "rb") as f:
        buf = f.read()
    ex = cut(buf, a.every)
    with open(a.out, "wb") as f:
        f.write(ex)
    print(f"source {len(buf)} bytes sha256 {hashlib.sha256(buf).hexdigest()}")
    print(f"excerpt {len(ex)} bytes sha256 {hashlib.sha256(ex).hexdigest()}")


if __name__ == "__main__":
    main()

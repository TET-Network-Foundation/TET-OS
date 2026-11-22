#!/usr/bin/env python3
"""A small ULog reader and writer, standard library only.

Written from PX4's own format document (docs/en/dev_log/ulog_file_format.md in PX4-Autopilot), not
from pyulog. It reads what this demo needs: the header, 'B' flags, 'F' formats, 'I'/'M' info,
'P'/'Q' parameters, 'A' subscriptions, 'D' data, 'L'/'C' text, 'S' sync and 'O' dropouts. Each
message is returned with its byte offset in the file, so a chunk signer can cut the file at message
boundaries.

    python3 ulog.py FILE.ulg          prints the topics and message counts
"""

import struct
import sys

MAGIC = b"ULog\x01\x12\x35"
HEADER_LEN = 16
BASIC = {
    "int8_t": "b", "uint8_t": "B", "int16_t": "h", "uint16_t": "H", "int32_t": "i", "uint32_t": "I",
    "int64_t": "q", "uint64_t": "Q", "float": "f", "double": "d", "bool": "?", "char": "c",
}


class ULogError(ValueError):
    pass


def read_header(buf):
    if len(buf) < HEADER_LEN or buf[:7] != MAGIC:
        raise ULogError("not a ULog file (magic)")
    return {"version": buf[7], "start_us": struct.unpack_from("<Q", buf, 8)[0]}


def messages(buf):
    """Yield (offset, msg_type, body) for every message after the header. A message cut short at
    the end of the file is reported as an error, not skipped."""
    off = HEADER_LEN
    n = len(buf)
    while off < n:
        if off + 3 > n:
            raise ULogError(f"message header cut short at byte {off}")
        size, mtype = struct.unpack_from("<HB", buf, off)
        end = off + 3 + size
        if end > n:
            raise ULogError(f"message at byte {off} runs past the end of the file")
        yield off, chr(mtype), buf[off + 3:end]
        off = end


def parse_format(text):
    name, _, fields = text.partition(":")
    out = []
    for f in fields.split(";"):
        if not f:
            continue
        typ, _, fname = f.partition(" ")
        count = 1
        if "[" in typ:
            typ, _, rest = typ.partition("[")
            count = int(rest.rstrip("]"))
        out.append((typ, count, fname))
    return name, out


class ULog:
    def __init__(self, buf):
        self.buf = buf
        self.header = read_header(buf)
        self.formats = {}
        self.info = {}
        self.subs = {}  # msg_id -> (name, multi_id)
        self.msgs = []  # (offset, type, body)
        for off, t, body in messages(buf):
            self.msgs.append((off, t, body))
            if t == "F":
                name, fields = parse_format(body.decode("ascii", "replace"))
                self.formats[name] = fields
            elif t == "I" and body:
                kl = body[0]
                self.info[body[1:1 + kl].decode("ascii", "replace").split(" ")[-1]] = body[1 + kl:]
            elif t == "A" and len(body) >= 3:
                multi, msg_id = struct.unpack_from("<BH", body, 0)
                self.subs[msg_id] = (body[3:].decode("ascii", "replace"), multi)

    def _decode(self, fmt_name, body, pos):
        out = {}
        for typ, count, fname in self.formats[fmt_name]:
            if typ in BASIC:
                code = BASIC[typ]
                sz = struct.calcsize("<" + code)
                if fname.startswith("_padding"):
                    pos += sz * count
                    continue
                if pos + sz * count > len(body):
                    break  # a trailing padding field may be left out (format document)
                vals = struct.unpack_from("<" + code * count, body, pos)
                pos += sz * count
                if typ == "char":
                    out[fname] = b"".join(vals).split(b"\0")[0].decode("ascii", "replace")
                else:
                    out[fname] = vals[0] if count == 1 else list(vals)
            elif typ in self.formats:
                items = []
                for _ in range(count):
                    item, pos = self._decode(typ, body, pos)
                    items.append(item)
                out[fname] = items[0] if count == 1 else items
            else:
                raise ULogError(f"unknown type {typ} in format {fmt_name}")
        return out, pos

    def size_of(self, fmt_name):
        """Bytes one message of this format takes, padding fields included."""
        n = 0
        for typ, count, _ in self.formats[fmt_name]:
            n += count * (struct.calcsize("<" + BASIC[typ]) if typ in BASIC else self.size_of(typ))
        return n

    def field_offset(self, fmt_name, field):
        """Where a top-level field starts in a 'D' message of this format, counted from the first
        byte of the message (3-byte message header, then the 2-byte msg_id). Read from the format the
        file itself holds: PX4 orders fields by size and inserts padding, so it differs per log."""
        pos = 3 + 2
        for typ, count, fname in self.formats[fmt_name]:
            if fname == field:
                return pos
            pos += count * (struct.calcsize("<" + BASIC[typ]) if typ in BASIC else self.size_of(typ))
        raise ULogError(f"no field {field} in format {fmt_name}")

    def data(self, topic, multi_id=0):
        """Yield (offset, decoded fields) for every 'D' message of one topic instance."""
        ids = {mid for mid, (name, multi) in self.subs.items() if name == topic and multi == multi_id}
        for off, t, body in self.msgs:
            if t == "D" and len(body) >= 2:
                mid = struct.unpack_from("<H", body, 0)[0]
                if mid in ids:
                    yield off, self._decode(topic, body, 2)[0]

    def topics(self):
        counts = {}
        for off, t, body in self.msgs:
            if t == "D" and len(body) >= 2:
                mid = struct.unpack_from("<H", body, 0)[0]
                key = self.subs.get(mid, ("?", 0))
                counts[key] = counts.get(key, 0) + 1
        return counts


def timestamp_of(body, t):
    """The microsecond time a message carries, if any: the first field of a 'D' message (every
    subscribed format starts with its uint64 timestamp in PX4 logs; this is checked by the caller
    only as a hint), the timestamp of 'L' and 'C' text."""
    if t == "D" and len(body) >= 10:
        return struct.unpack_from("<Q", body, 2)[0]
    if t == "L" and len(body) >= 9:
        return struct.unpack_from("<Q", body, 1)[0]
    if t == "C" and len(body) >= 11:
        return struct.unpack_from("<Q", body, 3)[0]
    return None


class Writer:
    """Writes a ULog file with the same message layout PX4's logger uses. For this demo's own
    simulated flight only: a file written here is NOT a log written by PX4."""

    def __init__(self, start_us=0):
        self.out = bytearray(MAGIC + b"\x01" + struct.pack("<Q", start_us))
        self.out += self._msg("B", bytes(8) + bytes(8) + struct.pack("<QQQ", 0, 0, 0))
        self.formats = {}
        self.ids = {}

    @staticmethod
    def _msg(t, body):
        return struct.pack("<HB", len(body), ord(t)) + body

    def info(self, key, value):
        k = f"char[{len(value)}] {key}".encode()
        self.out += self._msg("I", bytes([len(k)]) + k + value.encode())

    def fmt(self, name, fields):
        """fields: [(type, name)], the first must be ('uint64_t', 'timestamp')."""
        self.formats[name] = fields
        self.out += self._msg("F", (name + ":" + "".join(f"{t} {n};" for t, n in fields)).encode())

    def subscribe(self, name):
        mid = len(self.ids)
        self.ids[name] = mid
        self.out += self._msg("A", struct.pack("<BH", 0, mid) + name.encode())

    def data(self, name, values):
        body = struct.pack("<H", self.ids[name])
        for (typ, fname), v in zip(self.formats[name], values):
            if "[" in typ:
                base, _, n = typ.partition("[")
                body += struct.pack("<" + BASIC[base] * int(n.rstrip("]")), *v)
            else:
                body += struct.pack("<" + BASIC[typ], v)
        self.out += self._msg("D", body)

    def text(self, level, ts_us, message):
        self.out += self._msg("L", bytes([ord(level)]) + struct.pack("<Q", ts_us) + message.encode())

    def bytes(self):
        return bytes(self.out)


if __name__ == "__main__":
    with open(sys.argv[1], "rb") as f:
        log = ULog(f.read())
    print(f"ULog version {log.header['version']}, {len(log.msgs)} messages, {len(log.formats)} formats")
    for (name, multi), n in sorted(log.topics().items()):
        print(f"  {name}[{multi}]: {n}")

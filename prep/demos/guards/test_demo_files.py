#!/usr/bin/env python3
"""The demo folders (prep/demos) hold no video and no large file.

Videos and full flight logs are kept outside git and fetched separately; what is committed must stay
small, because a file once in public history stays there for good. The rules, on every committed
file under prep/demos, in any letter case (read from the HEAD commit's tree, blob by blob, so the
bytes judged are the committed ones, not the working copy, and an uncommitted file is not judged
here):

  1. no video, at any size: a file is refused when any dot-separated part of its name after the
     first (trailing spaces and dots ignored) is a video type (VIDEO below), or when its first bytes are a video's:
     a Y4M header, or, in a file whose first 2048 bytes hold a NUL byte or are not valid UTF-8, a container's or stream's signature
     (Matroska/WebM, ISO media, AVI, Ogg, MPEG program, video and transport streams, FLV, ASF, IVF,
     RealMedia, MXF, H.264/H.265 streams), under any name (a transport stream only by its
     bytes, since TypeScript files also end in .ts);
  2. a flight log (.ulg) only in a `fixtures/` folder, and at most 300 KiB;
  3. nothing over 1 MiB, except a vendored library file: one under a `vendor/` folder whose sha256
     is listed for it in that vendor folder's SHA256SUMS.

A submodule under prep/demos is refused (its files would not be judged).

Not judged: what is inside an archive or an encoded file; video types and signatures other than
the ones named here; earlier commits (only the HEAD tree is read); whether a vendor folder's
SHA256SUMS lists the library's real files (review reads that list); images, other than by size.
A file that is not video can be refused when its first bytes look like a stream's.

    python3 prep/demos/guards/test_demo_files.py
"""

import hashlib
import os
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DEMOS = "prep/demos"
MAX_BYTES = 1024 * 1024
MAX_ULG_BYTES = 300 * 1024
VIDEO = {"ivf", "264", "265", "avc", "nut", "bik", "webm", "mp4", "m4v", "mov", "qt", "mkv", "avi",
         "ogv", "ogg", "ogm", "mpg", "mpeg", "mpe",
         "m1v", "m2v", "mp2v", "mpv", "m2ts", "vob", "3gp", "3g2", "wmv", "asf", "flv",
         "f4v", "rm", "rmvb", "divx", "h264", "h265", "hevc", "y4m", "mxf", "dv"}


def video_by_name(path):
    """True when any dot-separated part of the file name, after the first, is a video type
    ("clip.webm", "clip.WEBM.bin", "clip.webm. ")."""
    name = path.rsplit("/", 1)[-1].rstrip(" .").lower()
    return any(part.strip() in VIDEO for part in name.split(".")[1:])


def is_text(head):
    """True for UTF-8 text with no NUL byte. In such a file only the Y4M header is judged by its bytes,
    while name and size are judged as for any file."""
    if b"\0" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as e:
        return e.start >= len(head) - 3  # only a character cut by the read limit
    return True


def ts_sync(head):
    """An MPEG transport stream (188-byte packets) or M2TS (192): the sync byte 0x47 at the same
    place in three packets in a row, starting anywhere in the first packet."""
    return any(all(len(head) > k + 2 * n and head[k + i * n] == 0x47 for i in range(3))
               for n in (188, 192) for k in range(n))


def video_by_content(head):
    """True when `head` (a file's first bytes) is a video: a raw video header that is also text
    (Y4M), or, in a file that is not text, a container's or stream's signature."""
    if head.startswith(b"YUV4MPEG2"):                                   # Y4M raw video
        return True
    if is_text(head):
        return False
    h = head.lstrip(b"\0")                                              # zero padding before a stream
    start = len(head) - len(h) >= 2 and h[:1] == b"\x01"                  # an MPEG start code 00 00 01
    return (h.startswith(b"\x1a\x45\xdf\xa3")                           # Matroska / WebM (EBML)
            or head[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip")  # ISO media, QuickTime
            or (head[:4] == b"RIFF" and head[8:12] == b"AVI ")          # AVI
            or head.startswith(b"OggS")                                 # Ogg (Theora video)
            or b"\x00\x00\x01\xba" in head[:1024]                        # MPEG program stream pack
            or (start and h[1:2] == b"\xb3")                               # MPEG video sequence
            or ts_sync(head)                                            # MPEG-TS, M2TS
            or head.startswith(b"FLV\x01")                                # FLV
            or head.startswith(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11")        # ASF / WMV
            or head.startswith(b"DKIF")                                 # IVF (VP8, VP9, AV1)
            or head.startswith(b".RMF")                                 # RealMedia
            or head.startswith(b"\x06\x0e\x2b\x34")                        # MXF (SMPTE key)
            or (start and annexb(h[1:2])))                              # H.264 / H.265 stream


def annexb(unit):
    """The first byte after an H.264 or H.265 start code is a parameter set or a delimiter
    (H.264 types 7, 8, 9; H.265 types 32-35)."""
    if not unit:
        return False
    return (unit[0] & 0x9f) in (7, 8, 9) or (unit[0] & 0x81 == 0 and (unit[0] >> 1) & 0x3f in (32, 33, 34, 35))


def vendor_sums(read, path):
    """(library folder, {name relative to it: sha256}) from the SHA256SUMS of the library folder
    holding `path` (vendor/<library>/, as vendor/three/), or (None, None) when `path` is not under a
    vendor/ folder."""
    parts = path.split("/")
    if "vendor" not in parts[:-1]:
        return None, None
    i = len(parts) - 2 - parts[:-1][::-1].index("vendor")  # the last "vendor" above the file
    vdir = "/".join(parts[:min(i + 2, len(parts) - 1)])
    sums = {}
    try:
        for line in read(f"{vdir}/SHA256SUMS").decode("utf-8", "replace").splitlines():
            bits = line.split()
            if len(bits) == 2:
                sums[bits[1]] = bits[0]
    except (OSError, KeyError):  # no SHA256SUMS: nothing is listed
        pass
    return vdir, sums


def read_file(root):
    """The reader for files on disk (the rule tests): path -> bytes."""
    def read(p):
        with open(os.path.join(root, p), "rb") as f:
            return f.read()
    return read


def problems(root, paths, read=None):
    """One line per file that breaks a rule; empty when every file is fine. `read(path)` gives the
    bytes judged (the committed blob for the repository test); by default the file under `root`."""
    read = read or read_file(root)
    out = []
    for p in paths:
        data = read(p)
        size = len(data)
        low = p.lower().rstrip(" .")
        if video_by_name(p) or video_by_content(data[:2048]):
            out.append(f"{p}: a video; keep it outside git and link to it")
            continue
        if low.endswith(".ulg"):
            if "fixtures" not in p.split("/")[:-1]:
                out.append(f"{p}: a flight log outside a fixtures/ folder")
            elif size > MAX_ULG_BYTES:
                out.append(f"{p}: a flight log of {size} bytes, over {MAX_ULG_BYTES}")
            continue
        if size > MAX_BYTES:
            vdir, sums = vendor_sums(read, p)
            if vdir is not None:
                h = hashlib.sha256(data).hexdigest()
                if sums.get(p[len(vdir) + 1:]) == h:
                    continue
                out.append(f"{p}: {size} bytes, over {MAX_BYTES}, and its sha256 is not the one in {vdir}/SHA256SUMS")
            else:
                out.append(f"{p}: {size} bytes, over {MAX_BYTES}")
    return out


def committed(root):
    """(paths, read, submodules) for prep/demos in the HEAD commit: read(path) returns the committed
    blob's bytes, never the working copy."""
    # every path whose folder is prep/demos in any letter case: a case-insensitive checkout puts
    # "Prep/Demos/x" in the same folder
    r = subprocess.run(["git", "ls-tree", "-r", "-z", "HEAD"], cwd=root, capture_output=True, check=True)
    blobs, subs = {}, []
    for entry in r.stdout.decode("utf-8", "surrogateescape").split("\0"):
        if not entry:
            continue
        meta, path = entry.split("\t", 1)
        if not path.lower().startswith(DEMOS + "/"):
            continue
        mode, kind, oid = meta.split()
        if kind == "commit":
            subs.append(path)
        elif kind == "blob":
            blobs[path] = oid

    def read(p):
        return subprocess.run(["git", "cat-file", "blob", blobs[p]], cwd=root, capture_output=True, check=True).stdout
    return sorted(blobs), read, subs


class Rules(unittest.TestCase):
    """Each rule refuses what it names, on files made here (so a rule cannot pass for want of a case)."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="demo-files-")

    def tearDown(self):
        subprocess.run(["rm", "-rf", self.root])

    def put(self, path, size, data=None):
        full = os.path.join(self.root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(data if data is not None else b"\0" * size)
        return path

    def test_a_file_over_1_mib_is_refused(self):
        p = self.put("prep/demos/a/big.bin", MAX_BYTES + 1)
        self.assertEqual(problems(self.root, [p]), [f"{p}: {MAX_BYTES + 1} bytes, over {MAX_BYTES}"])

    def test_a_file_of_exactly_1_mib_is_allowed(self):
        p = self.put("prep/demos/a/edge.bin", MAX_BYTES)
        self.assertEqual(problems(self.root, [p]), [])

    def test_a_small_video_is_refused(self):
        p = self.put("prep/demos/a/clip.WebM", 10)
        self.assertEqual(problems(self.root, [p]), [f"{p}: a video; keep it outside git and link to it"])

    def test_a_video_is_refused_by_a_listed_video_type_in_its_name(self):
        for name in ("clip.ogv", "clip.mpg", "clip.3gp", "clip.wmv", "clip.flv", "clip.m2ts",
                     "clip.webm.bin", "clip.webm ", "clip.webm.", "clip.MKV"):
            p = self.put(f"prep/demos/a/{name}", 10)
            self.assertEqual(problems(self.root, [p]), [f"{p}: a video; keep it outside git and link to it"], name)

    def test_a_video_is_refused_by_its_bytes_whatever_it_is_called(self):
        heads = {
            "webm": b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01" + b"webm",
            "mp4": b"\x00\x00\x00\x18ftypisom",
            "avi": b"RIFF\x00\x00\x00\x00AVI LIST",
            "ogg": b"OggS\x00\x02",
            "mpeg-ps": b"\x00\x00\x01\xba\x44",
            "mpeg-ts": b"".join(b"\x47" + b"\x00" * 187 for _ in range(3)),
            "flv": b"FLV\x01\x05",
            "asf": b"\x30\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9",
        }
        for kind, head in heads.items():
            p = self.put(f"prep/demos/a/{kind}.bin", 0, head + b"\0" * 600)
            self.assertEqual(problems(self.root, [p]), [f"{p}: a video; keep it outside git and link to it"], kind)

    def test_more_video_streams_are_refused_by_their_bytes(self):
        heads = {
            "y4m": b"YUV4MPEG2 W16 H16 F25:1 Ip A1:1 C420jpeg\nFRAME\n",
            "ivf": b"DKIF\x00\x00\x20\x00VP90",
            "h264": b"\x00\x00\x00\x01\x67\x42\xc0\x1e",
            "h265": b"\x00\x00\x00\x01\x40\x01\x0c\x01",
            "mpeg-ts-offset": b"\x00" + b"".join(b"\x47" + b"\x01" * 187 for _ in range(3)),
            "mpeg-ps-padded": b"\x00" * 6 + b"\x00\x00\x01\xba\x44",
            "mxf": b"\x06\x0e\x2b\x34\x02\x05\x01\x01\x0d\x01\x02\x01\x01\x02",
            "rm": b".RMF\x00\x00\x00\x12",
        }
        for kind, head in heads.items():
            p = self.put(f"prep/demos/a/{kind}.bin", 0, head + b"\0" * 2000)
            self.assertEqual(problems(self.root, [p]), [f"{p}: a video; keep it outside git and link to it"], kind)

    def test_text_is_not_taken_for_a_video_by_its_bytes(self):
        texts = {"wide": b"The wide view of the field", "free": b"Use free disk space.",
                 "moov": b"abc moov", "sync": ("G" + "x" * 187).encode() * 3, "start": b"\x01\x67 text"}
        for kind, data in texts.items():
            p = self.put(f"prep/demos/a/{kind}.txt", 0, data)
            self.assertEqual(problems(self.root, [p]), [], kind)

    def test_ordinary_files_are_not_taken_for_videos(self):
        for name, data in (("page.html", b"<!doctype html>"), ("log.json", b'{"ts": 1}'),
                           ("notes.md", b"# clip.webm is kept outside git"), ("x.ts", b"export {}"),
                           ("x.tsx", b"export {}"), ("pic.gif", b"GIF89a"),
                           ("lib.mpg.md", b"text")):
            p = self.put(f"prep/demos/a/{name}", 0, data)
            want = [f"{p}: a video; keep it outside git and link to it"] if name == "lib.mpg.md" else []
            self.assertEqual(problems(self.root, [p]), want, name)

    def test_a_flight_log_outside_fixtures_is_refused(self):
        p = self.put("prep/demos/a/flight.ulg", 10)
        self.assertEqual(problems(self.root, [p]), [f"{p}: a flight log outside a fixtures/ folder"])

    def test_a_flight_log_over_300_kib_is_refused_even_in_fixtures(self):
        p = self.put("prep/demos/a/fixtures/flight.ulg", MAX_ULG_BYTES + 1)
        self.assertEqual(problems(self.root, [p]), [f"{p}: a flight log of {MAX_ULG_BYTES + 1} bytes, over {MAX_ULG_BYTES}"])

    def test_a_large_vendored_file_passes_only_with_its_listed_sha256(self):
        data = b"x" * (MAX_BYTES + 1)
        p = self.put("prep/demos/a/vendor/lib/big.js", 0, data)
        self.put("prep/demos/a/vendor/lib/SHA256SUMS", 0, f"{hashlib.sha256(data).hexdigest()}  big.js\n".encode())
        self.assertEqual(problems(self.root, [p]), [])
        self.put("prep/demos/a/vendor/lib/big.js", 0, data[:-1] + b"y")
        self.assertEqual(problems(self.root, [p]),
                         [f"{p}: {MAX_BYTES + 1} bytes, over {MAX_BYTES}, and its sha256 is not the one in prep/demos/a/vendor/lib/SHA256SUMS"])

    def test_a_large_file_with_vendor_only_in_its_name_is_refused(self):
        p = self.put("prep/demos/a/vendor.bin", MAX_BYTES + 1)
        self.assertEqual(problems(self.root, [p]), [f"{p}: {MAX_BYTES + 1} bytes, over {MAX_BYTES}"])


class Committed(unittest.TestCase):
    """The repository rule reads the committed blob and the tree's submodules, in a repo made here."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="demo-files-git-")
        self.git("init", "-q")

    def tearDown(self):
        subprocess.run(["rm", "-rf", self.root])

    def git(self, *args):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.invalid", *args], cwd=self.root,
                       check=True, capture_output=True)

    def test_the_committed_bytes_are_judged_not_the_working_copy(self):
        os.makedirs(os.path.join(self.root, DEMOS, "a"))
        path = f"{DEMOS}/a/clip.bin"
        with open(os.path.join(self.root, path), "wb") as f:
            f.write(b"\x1a\x45\xdf\xa3" + b"\0" * 100)
        self.git("add", path)
        self.git("commit", "-qm", "video")
        with open(os.path.join(self.root, path), "wb") as f:  # the working copy no longer looks like one
            f.write(b"text")
        paths, read, subs = committed(self.root)
        self.assertEqual((paths, subs), ([path], []))
        self.assertEqual(problems(self.root, paths, read), [f"{path}: a video; keep it outside git and link to it"])

    def test_a_folder_named_in_another_letter_case_is_judged(self):
        path = "Prep/Demos/a/clip.webm"
        os.makedirs(os.path.join(self.root, "Prep", "Demos", "a"))
        with open(os.path.join(self.root, path), "wb") as f:
            f.write(b"x")
        self.git("add", path)
        self.git("commit", "-qm", "case")
        paths, read, _ = committed(self.root)
        self.assertEqual(paths, [path])
        self.assertEqual(problems(self.root, paths, read), [f"{path}: a video; keep it outside git and link to it"])

    def test_a_submodule_is_listed(self):
        oid = "0" * 39 + "1"
        self.git("update-index", "--add", "--cacheinfo", f"160000,{oid},{DEMOS}/sub")
        self.git("commit", "-qm", "sub")
        self.assertEqual(committed(self.root)[2], [f"{DEMOS}/sub"])


class Repository(unittest.TestCase):
    def test_every_committed_demo_file_keeps_the_rules(self):
        paths, read, subs = committed(ROOT)
        self.assertGreater(len(paths), 50)  # the demo folders are really read
        self.assertEqual(subs, [], "a submodule under prep/demos: its files are not judged here")
        self.assertEqual(problems(ROOT, paths, read), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)

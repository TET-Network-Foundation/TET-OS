"""Generated folders for the two checkers' private-copy guards (encounter/, px4/).

Each case is a fresh copy of one honest log folder with one change: an entry of one kind put at one
position. The kinds are those a test can make here without privileges: a regular file, a folder,
a link (absolute, relative, to nothing, to a folder), a FIFO, a socket, a second link to a file,
names that are not plain (letter case, non-ASCII in two Unicode forms, a non-ASCII digit), and
plain names verify does not list. The positions are the folder handed in itself (with the trailing spellings the checkers take off), its
top level, a sub-folder, and the place of a record file. A device node needs privileges and is not
made here.
"""

import os
import re
import shutil
import socket
import unicodedata

SPELLINGS = ("", "/", "/.", "//", "/./", "/./.", "/.//./")
REPLACE_KINDS = ("link-abs", "link-rel", "link-dangling", "fifo", "socket", "hardlink", "other-type")
EXTRA_KINDS = ("file", "folder", "link-to-file", "link-to-folder", "link-dangling", "fifo", "socket", "hardlink")
NAMES = ("X", "Caf\u00e9", unicodedata.normalize("NFC", "caf\u00e9"), unicodedata.normalize("NFD", "caf\u00e9"), "\u0661.json")
PLAIN_NAMES = (".hidden", "1.json.unread")  # plain, so copied; verify does not list them


def _socket(path):
    # bound by its last name from its own folder, so a long scratch path stays under the socket limit
    parent, name = os.path.split(path)
    cwd = os.getcwd()
    os.chdir(parent)
    try:
        s = socket.socket(socket.AF_UNIX)
        s.bind(name)
        s.close()
    finally:
        os.chdir(cwd)


def _replace(p, kind, outside):
    """An entry of `kind` in the place of the existing entry `p`; what was there is kept where a link
    of that kind points. False when the kind does not apply to what is there."""
    keep = os.path.join(outside, f"kept-{len(os.listdir(outside))}")
    if kind == "hardlink":
        if not os.path.isfile(p):
            return False
        os.link(p, keep)
        return True
    if kind == "link-rel":
        sib = os.path.join(os.path.dirname(p), "kept")
        os.rename(p, sib)
        os.symlink("kept", p)
        return True
    os.rename(p, keep)
    if kind == "link-abs":
        os.symlink(keep, p)
    elif kind == "link-dangling":
        os.symlink(os.path.join(outside, "nothing-here"), p)
    elif kind == "fifo":
        os.mkfifo(p)
    elif kind == "socket":
        _socket(p)
    elif kind == "other-type":
        if os.path.isdir(keep):
            with open(p, "wb") as f:
                f.write(b"{}")
        else:
            os.makedirs(p)
    return True


def _extra(folder, name, kind, outside, a_file):
    p = os.path.join(folder, name)
    if kind == "file":
        with open(p, "wb") as f:
            f.write(b"{}")
    elif kind == "folder":
        os.makedirs(p)
    elif kind == "link-to-file":
        os.symlink(a_file, p)
    elif kind == "link-to-folder":
        os.symlink(outside, p)
    elif kind == "link-dangling":
        os.symlink(os.path.join(outside, "nothing-here"), p)
    elif kind == "fifo":
        os.mkfifo(p)
    elif kind == "socket":
        _socket(p)
    elif kind == "hardlink":
        os.link(a_file, p)


def generate(base, scratch, top, sub, record):
    """Yields (label, path to hand in). `top`: entries of the top level to replace; `sub`: sub-folders
    (relative paths); `record`: a record file's relative path. Every case is built from `base` in its
    own folder under `scratch`; `base` is not changed."""
    n = [0]

    def fresh():
        n[0] += 1
        root = os.path.join(scratch, f"c{n[0]}")
        outside = os.path.join(root, "outside")
        os.makedirs(outside)
        d = os.path.join(root, "log")
        shutil.copytree(base, d)
        with open(os.path.join(outside, "a-file"), "wb") as f:
            f.write(b"{}")
        return d, outside

    d, _ = fresh()
    yield "the honest folder", d
    # the folder handed in itself
    for spelling in SPELLINGS:
        d, outside = fresh()
        link = os.path.join(os.path.dirname(d), "link")
        os.symlink(d, link)
        yield f"folder: a link to it, spelled {spelling!r}", link + spelling
    for spelling in ("/records/..", "/records/../", "/records/../."):
        d, _ = fresh()
        yield f"folder: spelled {spelling!r}", d + spelling
    for kind in ("link-dangling", "fifo", "socket", "other-type"):
        d, outside = fresh()
        _replace(d, kind, outside)
        yield f"folder: {kind}", d
    # an entry put in the place of one that is there: top level, sub-folder, record file
    for where in list(top) + list(sub) + [record]:
        for kind in REPLACE_KINDS:
            d, outside = fresh()
            if _replace(os.path.join(d, where), kind, outside):
                yield f"{where}: {kind}", d
    # an entry added next to the others: top level, each sub-folder
    for folder in [""] + list(sub):
        for kind in EXTRA_KINDS:
            d, outside = fresh()
            a_file = os.path.join(d, record) if kind == "hardlink" else os.path.join(outside, "a-file")
            _extra(os.path.join(d, folder), "x", kind, outside, a_file)
            yield f"{folder or 'top'}: an added {kind}", d
        for name in NAMES + PLAIN_NAMES:
            d, _ = fresh()
            _extra(os.path.join(d, folder), name, "file", None, None)
            yield f"{folder or 'top'}: an added file named {name!r}", d
    # an entry renamed to a name that is not plain, at each position
    for where in list(top) + list(sub) + [record]:
        head, last = os.path.split(where)
        for new in sorted({last.upper(), last[:1].upper() + last[1:]} - {last}):
            d, _ = fresh()
            os.rename(os.path.join(d, where), os.path.join(d, head, new + ".tmp"))
            os.rename(os.path.join(d, head, new + ".tmp"), os.path.join(d, head, new))
            yield f"{where}: renamed {new!r}", d


def record_bytes(d):
    """The record files notebook.py verify reads in `d` (records/<ASCII digits>.json), by name, read
    through `d` as given."""
    rec = os.path.join(d, "records")
    out = {}
    for name in sorted(os.listdir(rec)) if os.path.isdir(rec) else []:
        if re.fullmatch(r"[0-9]+\.json", name) and os.path.isfile(os.path.join(rec, name)):
            with open(os.path.join(rec, name), "rb") as f:
                out[name] = f.read()
    return out

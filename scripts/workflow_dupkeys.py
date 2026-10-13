"""Fail if a GitHub workflow file has a duplicated key in any mapping.

GitHub rejects such a file and then runs no checks at all, silently (2026-10-11: a merge dropped six
'- if:' lines from ci.yml, the next step's name/run overwrote the previous one's, and no CI ran on
seven branches). PyYAML would keep the last value without a word, so this loader refuses duplicates.
Run by .github/workflows/workflow-lint.yml, which is separate from ci.yml so a broken ci.yml can't
hide its own breakage.
"""
import yaml,sys
class L(yaml.SafeLoader): pass
def cm(loader,node,deep=False):
    keys=[loader.construct_object(k,deep=deep) for k,_ in node.value]
    d=[k for k in set(keys) if keys.count(k)>1]
    if d: raise ValueError(f"duplicate keys {d} at line {node.start_mark.line+1}")
    return {loader.construct_object(k,deep=deep):loader.construct_object(v,deep=deep) for k,v in node.value}
L.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, cm)
bad = 0
for path in sys.argv[1:]:
    try:
        yaml.load(open(path), Loader=L)
        print(f"ok   {path}")
    except Exception as e:
        bad += 1
        print(f"FAIL {path}: {str(e)[:200]}")
sys.exit(1 if bad else 0)

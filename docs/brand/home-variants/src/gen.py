import json, html, os
HERE = os.path.dirname(os.path.abspath(__file__))
blocks = list(reversed(json.load(open(os.path.join(HERE, 'blocks.json')))['blocks']))
def h(s, n=10): return (s or '').replace('0x','')[:n] or '—'
rows = []
for i, b in enumerate(blocks):
    above = blocks[i-1] if i else None
    linked = above and b['parent_block_id'] == above['block_id']
    rows.append(f'<p><b class="hi">#{b["height"]}</b> <i>hash</i> {h(b["block_id"])} <i>prev</i> <span class="{"link" if linked else ""}">{"=" if linked else ""}{h(b["parent_block_id"])}</span> <i>root</i> {h(b["state_root"],8)} <i>txs</i> {b["tx_count"]} <i>t</i> {b["ts_ms"]} <i>by</i> {b["producer_id"][:12]}</p>')
STRIP = '<div class="strip"><p class="dim" data-en="newest blocks on this node · blocks aren\'t producer-signed yet" data-ja="このノードの最新ブロック · ブロックにはまだ生成者の署名がありません"></p>' + "".join(rows) + '</div>'
FONTS = {
 'serif': "url('../fonts/librebaskerville/LibreBaskerville[wght].ttf')",
 'serif-ja': "url('../fonts/shipporimincho/ShipporiMincho-Regular.ttf')",
 'serif-ja-bold': "url('../fonts/shipporimincho/ShipporiMincho-Bold.ttf')",
 'mono': "url('../fonts/jetbrainsmono/JetBrainsMono[wght].ttf')",
 'mono-ja': "url('../fonts/mplus1code/MPLUS1Code[wght].ttf')",
 'sans': "url('../fonts/archivo/Archivo[wdth,wght].ttf')",
 'sans-ja': "url('../fonts/zenkakugothicnew/ZenKakuGothicNew-Regular.ttf')",
 'sans-ja-bold': "url('../fonts/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf')",
}
FACES = f"""
@font-face {{ font-family: 'TET Serif'; src: {FONTS['serif']}; font-weight: 400 700; }}
@font-face {{ font-family: 'TET Serif JA'; src: {FONTS['serif-ja']}; font-weight: 400; }}
@font-face {{ font-family: 'TET Serif JA'; src: {FONTS['serif-ja-bold']}; font-weight: 700; }}
@font-face {{ font-family: 'TET Mono'; src: {FONTS['mono']}; font-weight: 100 800; }}
@font-face {{ font-family: 'TET Mono JA'; src: {FONTS['mono-ja']}; font-weight: 100 700; }}
@font-face {{ font-family: 'TET Sans'; src: {FONTS['sans']}; font-weight: 100 900; font-stretch: 62% 125%; }}
@font-face {{ font-family: 'TET Sans JA'; src: {FONTS['sans-ja']}; font-weight: 400; }}
@font-face {{ font-family: 'TET Sans JA'; src: {FONTS['sans-ja-bold']}; font-weight: 700; }}
"""
BASE = """
*{box-sizing:border-box} html,body{margin:0;height:100%} body{display:flex;flex-direction:column;min-height:100vh;background:var(--bg);color:var(--fg)}
.center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 16px;text-align:center}
.mark{display:flex;align-items:center;gap:14px;justify-content:center}
.logo{width:72px;height:72px}
.sub{margin:6px 0 22px;color:var(--dim)}
form{display:flex;gap:8px;width:100%;max-width:560px}
input{flex:1;min-width:0;font:inherit;font-size:16px;padding:11px 16px;background:var(--field);color:var(--fg);border:1px solid var(--line)}
button{font:inherit;font-size:15px;padding:11px 16px;background:var(--field);color:var(--fg);border:1px solid var(--line)}
.links{margin-top:16px;font-size:15px} .links a{color:var(--fg)}
.cont{margin-top:10px;font-size:13.5px;color:var(--dim)} .cont a{color:var(--dim)}
.strip{font-family:'TET Mono','TET Mono JA',monospace;font-size:12px;line-height:1.6;white-space:pre;overflow:hidden;background:var(--sbg);color:var(--sfg);padding:8px 20px}
.strip p{margin:0} .strip i{font-style:normal;color:var(--sdim)} .strip .dim{color:var(--sdim)} .strip .hi{font-weight:400;color:var(--shi)} .strip .link{color:var(--shi)}
footer{font-size:13px;color:var(--dim);padding:12px 20px;border-top:1px solid var(--line)}
footer a{color:var(--dim)}
@media (prefers-color-scheme:dark){ .logo{border-radius:50%;box-shadow:0 0 0 1px #929292} }
@media (max-width:600px){ .logo{width:56px;height:56px} .strip{font-size:11px;padding:8px 14px} }
"""
T = {
 'sub':('v0.2 · testnet','v0.2 · テストネット'),
 'ph':('Search threads, or enter a proof code','スレッドを検索、または証明コードを入力'),
 'btn':('Search','検索'),
 'links':('<a>Try</a> · <a>Sign</a> · <a>Verify</a> · <a>How it works</a>','<a>試す</a> · <a>署名</a> · <a>検証</a> · <a>しくみ</a>'),
 'cont':('continue: <a>Club board</a> · <a>key options</a>','続き: <a>Club board</a> · <a>鍵の設定</a>'),
 'foot':('Testnet. The demo node sees your IP address and doesn\'t log it. <a>this node</a> · <a>About</a> · <a>Terms</a>','テストネットです。デモノードはあなたのIPアドレスを見ますが、ログには書きません。 <a>このノード</a> · <a>このサイトについて</a> · <a>利用規約</a>'),
}
def page(name, css, wordmark):
    def tx(k): return f'<span data-en="{html.escape(T[k][0])}" data-ja="{html.escape(T[k][1])}"></span>'
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TET home variant {name}</title>
<style>{FACES}{BASE}{css}</style></head><body>
<div class="center">
  <div class="mark"><img class="logo" src="tet-logo.svg" alt="">{wordmark}</div>
  <p class="sub">{tx('sub')}</p>
  <form onsubmit="return false"><input id="q"><button>{tx('btn')}</button></form>
  <p class="links">{tx('links')}</p>
  <p class="cont">{tx('cont')}</p>
</div>
{STRIP}
<footer>{tx('foot')}</footer>
<script>
const ja = new URLSearchParams(location.search).get('lang') === 'ja';
document.documentElement.lang = ja ? 'ja' : 'en';
for (const el of document.querySelectorAll('[data-en]')) el.innerHTML = ja ? el.dataset.ja : el.dataset.en;
document.getElementById('q').placeholder = ja ? {json.dumps(T['ph'][1], ensure_ascii=False)} : {json.dumps(T['ph'][0])};
</script></body></html>"""

A_CSS = """
:root{--bg:#fbfaf6;--fg:#1c1f23;--dim:#5d646d;--field:#fff;--line:#b9b4a6;--sbg:#16181b;--sfg:#c9d1d9;--sdim:#6c737b;--shi:#8fd3a8;--t1:#1a237e;--e:#1f5132;--t2:#8a1f1f}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e6e3da;--dim:#9aa0a6;--field:#1d2025;--line:#3b3f46;--t1:#9fa8ff;--e:#7fd1a0;--t2:#f0a0a0}}
body{font-family:'TET Serif','TET Serif JA',serif}
.word{font-family:'TET Serif','TET Serif JA',serif;font-weight:700;font-size:76px;letter-spacing:.02em;line-height:1}
.word .t1{color:var(--t1)} .word .e{color:var(--e)} .word .t2{color:var(--t2)}
input,button{border-radius:2px;box-shadow:inset 1px 1px 0 rgba(0,0,0,.08)}
.links a,.cont a,footer a{text-decoration:underline}
@media (max-width:600px){.word{font-size:56px}}
"""
B_CSS = """
:root{--bg:#f3f1e6;--fg:#2d4a12;--dim:#5b6b45;--field:#ecead9;--line:#9aa57e;--sbg:#e6e3cf;--sfg:#2d4a12;--sdim:#7a8566;--shi:#2d4a12}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d0a;--fg:#ffb000;--dim:#b07a00;--field:#0b0d0a;--line:#5a4300;--sbg:#0b0d0a;--sfg:#ffb000;--sdim:#7a5a10;--shi:#ffd166}}
body{font-family:'TET Mono','TET Mono JA',monospace}
.word{font-family:'TET Mono','TET Mono JA',monospace;font-weight:700;font-size:64px;line-height:1}
.word::before{content:'> ';color:var(--dim);font-weight:400}
.word::after{content:'_';animation:none;color:var(--dim)}
input,button{border-radius:0} input::placeholder{color:var(--dim)}
.strip{border-top:1px dashed var(--line)}
@media (max-width:600px){.word{font-size:46px}}
"""
C_CSS = """
:root{--bg:#ffffff;--fg:#0b0b0b;--dim:#6b6b6b;--field:#fff;--line:#0b0b0b;--sbg:#0b0b0b;--sfg:#e8e8e8;--sdim:#8a8a8a;--shi:#2f6bff;--acc:#2f6bff}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0b;--fg:#f4f4f4;--dim:#9a9a9a;--field:#0b0b0b;--line:#f4f4f4;--sbg:#161616;--sfg:#e8e8e8;--sdim:#7a7a7a;--shi:#6f97ff;--acc:#6f97ff}}
body{font-family:'TET Sans','TET Sans JA',sans-serif}
.word{font-family:'TET Sans','TET Sans JA',sans-serif;font-weight:900;font-stretch:112%;font-size:80px;letter-spacing:-.03em;line-height:1}
.word .dot{color:var(--acc)}
input{border-width:2px;border-radius:0} button{border-width:2px;border-radius:0;background:var(--fg);color:var(--bg);font-weight:700}
.links a{text-decoration:none;border-bottom:2px solid var(--acc)} .cont a,footer a{color:var(--dim)}
@media (max-width:600px){.word{font-size:58px}}
"""
open(os.path.join(HERE, 'a.html'),'w').write(page('A', A_CSS, '<span class="word"><span class="t1">T</span><span class="e">E</span><span class="t2">T</span></span>'))
open(os.path.join(HERE, 'b.html'),'w').write(page('B', B_CSS, '<span class="word">TET</span>'))
open(os.path.join(HERE, 'c.html'),'w').write(page('C', C_CSS, '<span class="word">TET<span class="dot">.</span></span>'))
print("ok")

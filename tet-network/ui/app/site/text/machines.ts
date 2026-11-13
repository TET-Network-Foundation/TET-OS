/** Japanese for the machines section's English strings (features, page text). EN is the key. */
export const JA: Record<string, string> = {
  "Machines and agents": "機械とエージェント",
  "A machine or an agent holds its own key, signs what it does, and may use a one-time permission only once.":
    "機械やエージェントが自分の鍵を持ち、したことに署名します。1回限りの許可は1回しか使えません。",

  // ── page ────────────────────────────────────────────────────────────────────────────────────
  "Nothing here runs on a server today. Every check on this page runs on your own computer.":
    "いま、ここにあるものはどれもサーバーでは動いていません。このページの確認は、すべてあなた自身のコンピューターで動きます。",
  "A small drone over a row of plants. It carries its own key and a ticket that allows one action, once.":
    "植物の列の上を飛ぶ小さなドローン。自分の鍵と、1つの動作を1回だけ許すチケットを持っています。",
  "A machine keeps its own log": "機械が自分のログをつける",
  "Each record is signed with the machine's own key and linked to the record before it. If a record is taken out, moved or changed, the check fails.":
    "記録の一つひとつに機械自身の鍵で署名し、前の記録とつなげます。記録を抜いたり、入れ替えたり、書き換えたりすると、確認で不合格になります。",
  "A small sensor box writes records 1, 2 and 3. Each record carries a seal from the machine's key and is linked to the one before.":
    "小さなセンサーの箱が記録1、2、3を書きます。各記録には機械の鍵による印があり、前の記録とつながっています。",
  "The page Check a machine's log, with a sample greenhouse sensor log that reads VALID.":
    "「機械のログを確認」のページ。温室センサーのサンプルログが VALID と表示されています。",
  "Screenshot of our own page, /try?tab=machine-log, with a sample log.": "私たち自身のページ /try?tab=machine-log の画面。サンプルログを表示しています。",
  "The same check on a phone, in dark mode: the sample log reads VALID, with its Shows and Does not show lists.":
    "同じ確認をスマートフォンのダークモードで。サンプルログは VALID で、「分かること」と「分からないこと」の一覧が出ています。",
  "The same page on a phone, in dark mode.": "同じページ、スマートフォンのダークモード。",
  "The machine's key is new and its own: it is never the owner's key. The log program is not for military or dual-use systems.":
    "機械の鍵は新しく作った機械専用の鍵で、持ち主の鍵ではありません。このログのプログラムは、軍事用や軍民両用のシステム向けではありません。",
  "Permission for one thing, once": "1つのことを、1回だけ許す",
  "A permit names one action and the last record that may use it. The first use is accepted. A second use of the same permit is refused.":
    "許可証には、1つの動作と、それを使ってよい最後の記録番号が書かれています。1回目は受け付けられ、同じ許可証の2回目は拒否されます。",
  "A robot arm with a ticket marked 1×. The first use of the ticket gets a tick; a second use of the same ticket gets a cross.":
    "「1×」と書かれたチケットを持つロボットアーム。チケットの1回目の使用には丸、同じチケットの2回目にはバツがつきます。",
  "One-time means once per log, not once in the world. Someone who copies the key could start a second log and use the same permit there.":
    "「1回限り」とは、1つのログの中で1回という意味で、世界中で1回という意味ではありません。鍵をコピーした人は、2つ目のログを始めて、そこで同じ許可証を使えてしまいます。",
  "Agents sign what they send": "エージェントは送るものに署名する",
  "A bot or a script gets its own key. What it sends carries its signature, and anyone can check that signature without asking us.":
    "ボットやスクリプトが自分の鍵を持ちます。送るものには署名がつき、その署名は私たちに問い合わせなくても誰でも確認できます。",
  "A program window with a small face holds a key. It sends a page with a seal, and a magnifier checks the seal with a tick.":
    "小さな顔のあるプログラムの窓が鍵を持っています。印のついた紙を送り、虫めがねがその印を確かめて丸をつけます。",
  "The page Agent and machine control, with a sample machine whose log reads VALID and whose one-time permit open-vent is used.":
    "「エージェントと機械の管理」のページ。サンプルの機械のログは VALID で、1回限りの許可 open-vent は使用済みです。",
  "Screenshot of our own page, /agents, with a sample machine.": "私たち自身のページ /agents の画面。サンプルの機械を表示しています。",
  "Where we think this goes": "この先どうなると考えているか",
  "Machines that keep their own notebooks": "自分のノートをつける機械",
  "Looking about ten years out, our guess is this: many machines that work on their own, such as farm drones, robots in warehouses and sensors in buildings, would keep a signed log of what they did.":
    "10年ほど先を考えると、私たちの予想はこうです。農業用ドローン、倉庫のロボット、建物のセンサーのように自分で動く多くの機械が、自分のしたことを署名つきのログに残すようになる。",
  "After something goes wrong, anyone could read that log without having to trust the machine's maker: which key signed, in what order, and which permissions were used.":
    "何か問題が起きたとき、機械の作り手を信用しなくても、誰でもそのログを読めます。どの鍵が署名したか、どの順番か、どの許可が使われたか。",
  "Permissions would be small: one action, once, then gone.": "許可は小さなものになるでしょう。1つの動作を1回、それで終わり。",
  "None of this is built beyond what the cards above say, and it may turn out quite differently.":
    "上のカードに書いたこと以上は、まだ何も作っていません。まったく違う形になるかもしれません。",

  // ── features: titles, summaries, links ─────────────────────────────────────────────────────
  "A machine's own log": "機械自身のログ",
  "A small program on the machine writes down each reading, signs it with the machine's own key, and links it to the record before. Anyone given the folder can check it later.":
    "機械の上の小さなプログラムが測定値を一つずつ書き留め、機械自身の鍵で署名し、前の記録とつなげます。フォルダーを渡された人は誰でも、後から確認できます。",
  "Check a log in your browser": "ブラウザーでログを確認",
  "Drop a machine's folder on the page, or try a sample. The check runs in your browser tab; nothing is uploaded.":
    "機械のフォルダーをページに置くか、サンプルを試してください。確認はブラウザーのタブの中で行われ、何もアップロードされません。",
  "Check a machine's log": "機械のログを確認",
  "A record's fingerprint on a node": "ノードに置く記録の指紋",
  "The notebook can hand one record's fingerprint (its SHA-256) to a node you name. The reading itself stays on the machine. Tried only against a node run on the same computer.":
    "ノートは、1つの記録の指紋（SHA-256）を、指定したノードに渡せます。測定値そのものは機械の中に残ります。試したのは、同じコンピューターで動かしたノードだけです。",
  "One-time permits": "1回限りの許可証",
  "The machine signs a short note: one named action may be recorded once, up to a given record number. A record cites the note. A second use, or a late one, makes the log fail its check.":
    "機械が短いメモに署名します。名前のついた1つの動作を、決めた記録番号までに1回だけ記録してよい、というものです。記録がそのメモを引用します。2回目の使用や期限後の使用があると、ログは確認で不合格になります。",
  "An agent action allowed once": "1回だけ許されたエージェントの動作",
  "An example in which a software agent first claims a permit, and acts only if the claim is accepted. A second claim is refused, so the agent does not act again.":
    "ソフトウェアのエージェントが、まず許可証の使用を申し出て、それが受け付けられたときだけ動く例です。2回目の申し出は拒否されるので、エージェントは再び動きません。",
  "Agent signatures": "エージェントの署名",
  "An agent, such as a bot or a script, holds its own key and signs what it sends (tet-cli agent sign). Anyone can check the signature (tet-cli agent verify). Each signature names the chain it was made for.":
    "ボットやスクリプトのようなエージェントが自分の鍵を持ち、送るものに署名します（tet-cli agent sign）。署名は誰でも確認できます（tet-cli agent verify）。どの署名にも、それを作った対象のチェーンが書き込まれています。",
  "All your machines on one page": "すべての機械を1ページで",
  "A page that checks several machines' logs side by side, shows each one-time permit as used, still open or run out, and writes the command that gives a machine a new one. The page signs nothing.":
    "いくつもの機械のログを並べて確認し、1回限りの許可証を「使用済み」「まだ使える」「期限切れ」で示し、機械に新しい許可証を出すコマンドを書き出すページです。ページ自体は何にも署名しません。",
  "Open the machines page": "機械のページを開く",
  "Once in the world, not just once per log": "1つのログの中でなく、世界中で1回",
  "Today a permit means once per log. Making it once everywhere would need a shared record keeper, such as a node or the chain. This is an open question in a design note.":
    "いまの許可証は、1つのログの中で1回という意味です。どこでも1回にするには、ノードやチェーンのような共有の記録係が必要になります。設計メモの中の、まだ答えの出ていない問いです。",

  // ── features: Shows / Does not show ────────────────────────────────────────────────────────
  "which key signed each record": "どの鍵がそれぞれの記録に署名したか",
  "that the records are in this order": "記録がこの順番であること",
  "that each record was written before the next one": "各記録が次の記録より前に書かれたこと",
  "that no one-time permission was used twice in this log, or after it ran out":
    "このログの中で、1回限りの許可が2回使われたり、期限切れの後に使われたりしていないこと",
  "that the reading is true": "測定値が正しいこと",
  "that the machine's clock was right": "機械の時計が正しかったこと",
  "where the machine was": "機械がどこにあったか",
  "who runs the machine": "誰が機械を動かしているか",
  "that the key was not copied": "鍵がコピーされていないこと",
  "that a copied key did not use the same permission in another log": "コピーされた鍵が、同じ許可を別のログで使っていないこと",
  "whether the log checks out, by the same rules as the notebook's own check": "ノート自身の確認と同じ規則で、ログが合格かどうか",
  "the reason, when it does not": "不合格のときは、その理由",
  "anything about a log you were not given": "渡されていないログについてのこと",
  "whether each record's fingerprint is on the node you named, signed by this machine's key":
    "各記録の指紋が、この機械の鍵の署名つきで、指定したノードにあるかどうか",
  "the reading itself": "測定値そのもの",
  "when the record was written: blocks carry no time": "記録がいつ書かれたか（ブロックには時刻が入っていません）",
  "a record fixed in a block: the notebook cannot do that step": "ブロックに固定された記録（ノートにはその手順ができません）",
  "which record used the permit": "どの記録が許可証を使ったか",
  "that it was used once in this log, and not after it ran out": "このログの中で1回だけ、期限切れの前に使われたこと",
  "that the machine's own key signed it": "機械自身の鍵が署名したこと",
  "that the action really happened: the log holds the machine's claim": "動作が本当に行われたこと（ログにあるのは機械の申告です）",
  "that the action was a good idea": "その動作がよい判断だったこと",
  "which key claimed the permit, and in which record": "どの鍵が、どの記録で許可証の使用を申し出たか",
  "that this key's log accepts the action once, and not after it runs out": "この鍵のログが、その動作を1回だけ、期限切れの前にだけ受け付けること",
  "that a log using a permit twice, late, or signed by another key is refused": "許可証を2回使ったログ、期限後に使ったログ、別の鍵が署名した許可証を使ったログは拒否されること",
  "that a copied key did not write a second log": "コピーされた鍵が2つ目のログを書いていないこと",
  "that the action happened, or happened only once in the world": "動作が行われたこと、または世界中で1回だけ行われたこと",
  "who runs the agent, or that its clock was right": "誰がエージェントを動かしているか、その時計が正しかったか",
  "which key signed these bytes": "どの鍵がこのデータに署名したか",
  "that the bytes have not changed since": "その後データが変わっていないこと",
  "which chain the signature was made for": "署名がどのチェーンのために作られたか",
  "who or what wrote the words": "誰が、または何がその文を書いたか",
  "that the owner still stands behind the key: there is no way to withdraw one": "持ち主がいまもその鍵を認めていること（鍵を取り消す仕組みはありません）",
  "each machine's result, VALID or INVALID": "各機械の結果（VALID か INVALID か）",
  "which permits are used, still open, or run out": "どの許可証が使用済みか、まだ使えるか、期限切れか",
  "anything about a machine whose folder you did not add": "フォルダーを追加していない機械についてのこと",
  "the question, written down": "書き留められた問い",
  "an answer: nothing is decided or built": "答え（何も決まっておらず、何も作っていません）",
};

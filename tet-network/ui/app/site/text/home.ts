/** Japanese for the home page and the site frame. EN is the key. */
export const JA: Record<string, string> = {
  TET: "TET",
  Sections: "セクション",
  Language: "言語",
  Tags: "タグ",
  Machines: "機械",
  Keys: "鍵",
  Services: "サービス",
  Research: "研究",
  "Open source. Every feature on this site carries a status, and the status matches the repository.":
    "オープンソースです。このサイトのすべての機能に状態が付いていて、その状態はリポジトリの中身と一致しています。",
  Running: "稼働中",
  Prototype: "試作",
  Planned: "計画中",
  Idea: "アイデア",
  "works today for anyone": "今日、誰でも使える",
  "built, runs only on your own computer": "作ってあり、自分のパソコンの中だけで動く",
  "decided, not built": "やると決めたが、まだ作っていない",
  "not decided; being studied": "まだ決めていない。調べているところ",
  "The code on GitHub": "GitHub のコード",
  Shows: "示すこと",
  About: "このプロジェクトについて",
  Changelog: "変更履歴",
  Source: "出典",
  "What a check looks like": "確認はこう見えます",
  "This is a real run of TET's command-line tool. It checks a machine's signed record, then a copy where one reading was changed. The original passes; the edited copy is refused.":
    "これは TET のコマンドラインツールを実際に動かした出力です。機械が署名した記録を確かめ、次に測定値を一つ変えたコピーを確かめます。元の記録は通り、変えたコピーは断られます。",
  Measured: "計測した数字",
  "A few numbers, each measured and each with where it comes from. A zero-knowledge receipt is the proof TET's anonymous features attach; it is large, and making one takes time.":
    "いくつかの数字です。どれも計測したもので、出どころを書いています。ゼロ知識レシートは、TET の匿名の機能が付ける証明です。大きく、作るのに時間がかかります。",
  "Why this matters later": "これから必要になる理由",
  "Three reasons we think keys with limits will be needed. They are our reasoning, not a promise, and each links to what it rests on.":
    "制限つきの鍵が必要になると私たちが考える三つの理由です。私たちの推論であって約束ではありません。それぞれ、根拠にしているものへのリンクがあります。",
  "Products will carry a record of where they came from": "製品が、どこから来たかの記録を持つようになる",
  "The EU's ecodesign rules bring in a digital product passport: data about a product that travels with it. A record is only useful if you can tell who wrote it. A signed record says which key wrote each entry.":
    "EU のエコデザインの規則は、デジタル製品パスポートを導入します。製品と一緒に移動する、その製品についてのデータです。記録は、誰が書いたかが分かってはじめて役に立ちます。署名された記録は、それぞれの項目をどの鍵が書いたかを示します。",
  "Regulation (EU) 2024/1781, on EUR-Lex": "規則 (EU) 2024/1781（EUR-Lex）",
  "Software agents will act for people": "ソフトウェアのエージェントが人の代わりに動くようになる",
  "NIST has started an initiative on standards for AI agents, including how an agent is identified and what it is allowed to do. A key with written limits is one way to say what an agent may do and check it afterwards.":
    "NIST は AI エージェントの標準づくりの取り組みを始めました。エージェントをどう識別するか、何をしてよいかも含まれます。制限を書いた鍵は、エージェントに何が許されるかを示し、あとで確かめる方法の一つです。",
  "NIST, AI Agent Standards Initiative": "NIST、AI Agent Standards Initiative",
  "Signatures are moving to post-quantum schemes": "署名は量子コンピューターに耐える方式へ移りつつある",
  "NIST has published ML-DSA as a standard signature scheme designed to resist quantum computers. Records signed today may need to be checked for many years, so every TET signature already carries an ML-DSA-44 half next to Ed25519.":
    "NIST は、量子コンピューターに耐えるよう作られた署名方式 ML-DSA を標準として公開しました。今日署名した記録は、何年も先まで確かめる必要があるかもしれません。そのため TET の署名にはすべて、Ed25519 と並んで ML-DSA-44 の半分がすでに付いています。",
  "NIST FIPS 204 (ML-DSA)": "NIST FIPS 204（ML-DSA）",
  "Our reasoning, not a promise": "私たちの推論で、約束ではありません",
  X: "X",
  "Captured from {tool} on {date}. Not edited, except that colour codes were removed.":
    "{date} に {tool} から取り込んだ出力です。色の制御コードを除いて、手を加えていません。",
  "Try it": "試してみる",
  "Does not show": "示さないこと",
  "A guess, not a plan": "予定ではなく、予想です",
  "Status of each feature": "それぞれの機能の状態",
  "Keys for machines and agents: what each key may do, and how many times.":
    "機械とエージェントのための鍵。それぞれの鍵に何が許され、何回使えるか。",
  "TET gives each machine or agent its own key, limits what that key may sign, and lets anyone check the result.":
    "TET は、機械やエージェントの一つひとつに専用の鍵を持たせ、その鍵が署名できることに制限をかけ、その結果を誰でも確かめられるようにします。",
  "See how it works":
    "仕組みを見る",
  "A key with three use marks, one used and two left, linked to a small machine.":
    "三つの使用マーク（一つは使用済み、二つは残り）が付いた鍵と、それにつながる小さな機械。",
  "A key may do one named thing a set number of times.":
    "鍵は、決められた一つのことを、決められた回数だけできます。",
  "Why this matters":
    "なぜ必要か",
  "AI can now make text, pictures and code that look like anyone's. That makes two questions harder: which key made this, and did it exist before a given moment? TET answers only those two; it does not say whether the thing is true or good.":
    "いまの AI は、誰が作ったようにも見える文章や画像やコードを作れます。そのため、二つの問いに答えにくくなりました。どの鍵がこれを作ったのか、そしてそれはある時点より前に存在していたのか。TET が答えるのはこの二つだけで、その中身が正しいか、良いものかは示しません。",
  "Many pages that look alike; one, set apart, carries a key mark.":
    "見た目がそっくりな多くのページ。離れた一枚にだけ鍵の印が付いています。",
  "Copies can look the same. A signature says which key made one of them.":
    "コピーは見分けがつかないことがあります。署名は、そのうちの一つをどの鍵が作ったかを示します。",
  "How TET differs from today's blockchains":
    "いまのブロックチェーンとの違い",
  "Blockchains already do some things well: many independent nodes agree on one order, and some have run in public for years. TET has neither yet. It aims at a narrower question.":
    "ブロックチェーンがすでにうまくできていることがあります。独立した多くのノードが一つの順番に合意すること、そして何年も公開の場で動き続けてきたことです。TET にはまだどちらもありません。TET が目指すのは、もっと狭い問いです。",
  "Question":
    "問い",
  "Most blockchains":
    "多くのブロックチェーン",
  "Purpose":
    "目的",
  "A shared record of accounts and transfers that many independent nodes agree on.":
    "独立した多くのノードが合意する、口座と送金の共有記録。",
  "A shared record of keys: what each key may do, how many times, and when it signed.":
    "鍵の共有記録。それぞれの鍵に何が許され、何回使えて、いつ署名したか。",
  "Token":
    "トークン",
  "Most have one. It rewards the nodes that keep the record.":
    "多くは持っています。記録を保つノードへの報酬になります。",
  "TET has none.":
    "TET にはありません。",
  "Signatures":
    "署名",
  "Usually one elliptic-curve scheme, such as ECDSA or Ed25519.":
    "ふつうは楕円曲線の方式が一つ（ECDSA や Ed25519 など）。",
  "Two on every record: Ed25519 and ML-DSA-44, a scheme designed to resist quantum computers. Both must check.":
    "すべての記録に二つ。Ed25519 と、量子コンピュータに耐えるよう設計された方式 ML-DSA-44 です。両方が確認できなければなりません。",
  "What a result says":
    "結果が示すこと",
  "This transaction is in block N, in the order the nodes agreed.":
    "この取引は、ノードが合意した順番でブロック N に入っている。",
  "This key signed this, under this permission, and it existed before block N. Not that it is true.":
    "この鍵がこの許可のもとでこれに署名し、それはブロック N より前に存在していた。中身が正しいことは示しません。",
  "Left, many nodes joined in a ring around one shared record; right, one key with its use marks.":
    "左は、一つの共有記録を囲んでつながった多くのノード。右は、使用マークの付いた一つの鍵。",
  "Left: many nodes agree on one order. Right: one key and how many times it may act.":
    "左：多くのノードが一つの順番に合意する。右：一つの鍵と、それが何回使えるか。",
  "What exists today":
    "いまあるもの",
  "Four pieces of TET that exist as code. Each card gives its status, one thing it shows and one it does not.":
    "コードとして存在する TET の四つの部品です。どのカードにも、状態と、示すことを一つ、示さないことを一つ書いてあります。",
  "How it works":
    "仕組み",
  "Follow one action from a key to a check anyone can run.":
    "一つの操作を、鍵から、誰でもできる確認まで追ってみます。",
  "A key":
    "鍵",
  "A machine or an agent holds its own key. The key stays on that device.":
    "機械やエージェントは自分の鍵を持ちます。鍵はその機器の中から出ません。",
  "A one-time permission":
    "一回だけの許可",
  "The key's owner signs a permission for one named action. It can be used once.":
    "鍵の持ち主が、決められた一つの操作への許可に署名します。使えるのは一回だけです。",
  "The machine signs":
    "機械が署名する",
  "The machine signs a record of what it did, with both signatures, and uses up the permission.":
    "機械は、自分がしたことの記録に二つの署名を付け、許可を使い切ります。",
  "Existed before block N":
    "ブロック N より前に存在した",
  "A fingerprint of the record goes into block N. That shows the record existed before that block.":
    "記録の指紋（ハッシュ）がブロック N に入ります。これで、その記録がそのブロックより前に存在していたことがわかります。",
  "Anyone checks":
    "誰でも確かめられる",
  "Anyone holding the record can check the signatures, the permission and the block. A second use of the same permission is refused.":
    "記録を持っている人なら誰でも、署名と許可とブロックを確かめられます。同じ許可を二回目に使おうとすると拒否されます。",
  "A check shows which key signed, under which permission, and that the record existed before block N. It does not show that what the machine did was right. In the prototypes, every step runs on your own computer.":
    "確認でわかるのは、どの鍵が、どの許可のもとで署名したか、そして記録がブロック N より前に存在していたことです。機械のしたことが正しかったかはわかりません。試作では、どの段階も自分のパソコンの中で動きます。",
  "Where we think this goes":
    "この先どうなると考えているか",
  "In ten years":
    "十年後",
  "We guess that many machines and agents will act for people, each with a key that carries written limits. A site or a person could then check what an agent was allowed to do before trusting what it did. This is a guess, and it may be wrong.":
    "多くの機械やエージェントが人の代わりに動き、それぞれが制限の書かれた鍵を持つようになると予想しています。そうなれば、サイトや人は、エージェントのしたことを信じる前に、何が許されていたかを確かめられます。これは予想で、外れるかもしれません。",
  "Several machines, each with its own key, joined to one check in the middle.":
    "それぞれ自分の鍵を持ついくつかの機械と、真ん中の一つの確認。",
  "Many machines, each with its own key; one way to check them all.":
    "多くの機械が、それぞれ自分の鍵を持つ。そのすべてを同じ方法で確かめる。",
  "Read the research":
    "研究を読む",
  "Where things stand":
    "いまの状況",
  "No public node runs today, so nothing here works for anyone over the internet. The test network is being rebuilt. There are no users yet.":
    "いま動いている公開ノードはありません。そのため、ここにあるものはどれも、インターネット越しには誰も使えません。テストネットワークは作り直しているところです。利用者はまだいません。",
  "A public node drawn in dashed outline, not running, with a wrench; beside it, a laptop with a tick.":
    "点線で描かれた、動いていない公開ノードとレンチ。その横に、チェックの付いたノートパソコン。",
  "The public node is down and being rebuilt. The prototypes run on your own computer.":
    "公開ノードは止まっていて、作り直しているところです。試作は自分のパソコンの中で動きます。",
  "Five sections":
    "五つのセクション",
  "Each card says what is built and what is not.":
    "どのカードにも、できていることとできていないことが書いてあります。",
  "Questions":
    "よくある質問",
  "What is TET?":
    "TET とは？",
  "Open-source code for keys that machines and agents hold. Each key can carry limits on what it may sign and how many times. Anyone can check a signed record against those limits.":
    "機械やエージェントが持つ鍵のための、オープンソースのコードです。それぞれの鍵に、何に署名してよいか、何回までかという制限を付けられます。署名された記録がその制限に沿っているかは、誰でも確かめられます。",
  "Is there a token?":
    "トークンはありますか？",
  "No. TET has no token. The chain records keys, permissions and fingerprints of records.":
    "ありません。TET にトークンはありません。チェーンに記録するのは、鍵と許可と記録の指紋（ハッシュ）です。",
  "Does it run now?":
    "いま動いていますか？",
  "Not for anyone over the internet: no public node runs today. Parts of it run on your own computer, as prototypes.":
    "インターネット越しには、誰にも使えません。いま動いている公開ノードはないからです。一部は試作として、自分のパソコンの中で動きます。",
  "Is it safe to use?":
    "使っても大丈夫ですか？",
  "Every signature is hybrid: Ed25519 together with ML-DSA-44, and both halves must check. Keys stay on your device. Everything is a prototype that no one outside has reviewed or audited, so do not rely on it for anything that matters.":
    "すべての署名は二重です。Ed25519 と ML-DSA-44 を組み合わせ、両方が確認できなければなりません。鍵は自分の機器の中から出ません。ただしどれも試作で、外部の誰にもレビューや監査を受けていないため、大事なことには使わないでください。",
  "How do I try it?":
    "どうすれば試せますか？",
  "Open a Try it link under What exists today; those pages run in your browser. The five sections say what each part does and how far it has come.":
    "「いまあるもの」の「試してみる」リンクを開いてください。そのページはブラウザの中で動きます。五つのセクションには、それぞれの部分が何をするのか、どこまで進んでいるかが書いてあります。",
  "A key with a counter beside a small machine and a person: each key may do one named thing a set number of times.":
    "回数が書かれた鍵と、小さな機械と人。それぞれの鍵は、決められた一つのことを決められた回数だけできます。",
  "Five places to start": "はじめに見る五つの場所",
  "Each card says what is built and what is not. A label on every feature tells you how far it has come.":
    "どのカードにも、できていることとできていないことが書いてあります。それぞれの機能のラベルが、どこまで進んでいるかを示します。",
};

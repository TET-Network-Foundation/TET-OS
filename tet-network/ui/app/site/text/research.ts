/** Japanese for the research section's English strings (features, page text). EN is the key. */
export const JA: Record<string, string> = {
  "Research": "研究",
  "Ideas we are studying. Nothing on this page runs.":
    "調べているアイデアです。このページのものは、どれも動いていません。",

  // Page
  "Nothing on this page runs.": "このページのものは、どれも動いていません。",
  "Ideas we are studying, each with what it would change and what it would not.":
    "調べているアイデアです。それぞれ、何が変わり、何が変わらないかを書いています。",
  "A key beside an open notebook under a magnifying glass: an idea being studied, not a thing that runs.":
    "開いたノートと虫めがね、その横に鍵。調べているアイデアで、動いているものではありません。",
  "Keys that sign once": "一度だけ署名できる鍵",
  "Today, when TET allows something only once, a second use can still be made, and whoever keeps the record refuses it. A one-shot key would make the second signature impossible to make.":
    "今の TET では、一度だけ許されたことでも二度目を行うことはでき、記録を持つ側がそれを拒否します。ワンショット鍵なら、二度目の署名はそもそも作れません。",
  "Top: an ordinary key signs twice and a record book crosses out the second signature. Bottom: a one-shot key signs once and is used up, so there is no second signature.":
    "上：普通の鍵が二回署名し、記録帳が二つ目の署名に×を付けます。下：ワンショット鍵は一回署名すると使い切られ、二つ目の署名はありません。",
  "Top: today, a second use is caught by whoever keeps the record. Bottom: a one-shot key cannot sign a second time.":
    "上：今は、二度目の使用を記録を持つ側が見つけます。下：ワンショット鍵は二度目の署名ができません。",
  "The catch: a trusted setup": "落とし穴：信頼されたセットアップ",
  "The note read the papers and found a cost.": "研究ノートは論文を読み、一つの代償を見つけました。",
  "In the standard model, the one-shot scheme of Shmueli and Zhandry (IACR ePrint 2025/486) needs a common reference string made by a trusted setup, and practical indistinguishability obfuscation does not exist. A trusted setup is the same kind of trust TET rejected Groth16 for.":
    "標準モデルでは、Shmueli と Zhandry のワンショット方式（IACR ePrint 2025/486）には、信頼されたセットアップが作る共通参照文字列が必要です。また、実用的な識別不能難読化（iO）は存在しません。信頼されたセットアップは、TET が Groth16 を採用しなかった理由と同じ種類の信頼です。",
  "A trusted setup means one party makes the shared starting data from secret keys. By the note's reading, whoever kept those keys could sign twice with one key, and nothing would show it afterwards.":
    "信頼されたセットアップとは、ある一者が秘密鍵から共有の出発データを作ることです。研究ノートの読みでは、その秘密鍵を持ち続けた者は一つの鍵で二回署名でき、後からそれを示すものは何も残りません。",
  "A setup box makes a shared string from a secret key. Everyone's keys use the string, but a copy of the secret key, kept aside, makes two signatures.":
    "セットアップの箱が秘密鍵から共有の文字列を作ります。皆の鍵はその文字列を使いますが、取っておかれた秘密鍵の写しは二つの署名を作ります。",
  "The setup's secret key, if anyone kept it, would undo the once.":
    "セットアップの秘密鍵を誰かが持ち続ければ、「一度だけ」は成り立ちません。",
  "The paper's setup samples secret keys and builds the shared reference string from them (its Construction 52).":
    "論文のセットアップは秘密鍵を選び、そこから共有の参照文字列を作ります（論文の Construction 52）。",
  "The paper states its security only for an attacker who never sees those keys.":
    "論文が安全性を述べているのは、その秘密鍵を一度も見ない攻撃者に対してだけです。",
  "In the idealised oracle model there is no setup party, but the only known way to make that oracle real brings the secret keys back.":
    "理想化したオラクルモデルにはセットアップをする者がいません。しかし、そのオラクルを現実に作る既知の方法は、秘密鍵を再び持ち込みます。",
  "Of the sources read, only arXiv 2606.23612 says in words that its setup is trusted.":
    "読んだ資料のうち、セットアップが信頼されたものだと言葉で書いているのは arXiv 2606.23612 だけです。",
  "The paper never uses the word \"trusted\" for its setup. The finding follows from its construction.":
    "論文は自分のセットアップに「信頼された」という言葉を使っていません。この結論は、その構成から導かれるものです。",
  "That whoever holds the setup keys could sign twice is the note's own reading, still to be checked by someone who has read the proofs.":
    "セットアップの鍵を持つ者が二回署名できるというのは研究ノート自身の読みで、証明を読んだ人による確認はまだです。",
  "The proofs in the paper's Sections 3 to 6 and its appendices were not read line by line.":
    "論文の第3節から第6節の証明と付録は、一行ずつは読んでいません。",
  "That no scheme with a transparent setup exists. The note searched; it did not survey the field, and a scheme it missed may exist.":
    "透明なセットアップを持つ方式が存在しないこと。研究ノートは検索しましたが、分野を網羅的に調べたわけではなく、見落とした方式があるかもしれません。",
  "Try the idea on a sample wallet": "サンプルのウォレットで試す",
  "A concept page lets you hand over notes from sample keys that each work once. It is a model, not a key.":
    "構想ページでは、一度ずつしか使えないサンプルの鍵からメモを渡してみられます。これは模型で、鍵ではありません。",
  "The sample wallet after two hand-overs: two keys are struck through and marked Used, and the other sample person holds two notes.":
    "二回渡した後のサンプルのウォレット。二つの鍵に取り消し線と「使用済み」が付き、相手側のサンプルの人は二つのメモを持っています。",
  "The /future concept page, light theme. Screenshot from its pull request.":
    "/future の構想ページ（ライトテーマ）。プルリクエストのスクリーンショットです。",
  "The same sample wallet on a phone, dark theme, after a note was handed over once.":
    "同じサンプルのウォレットをスマートフォンで、ダークテーマで表示したもの。メモを一回渡した後です。",
  "The same page on a phone, dark theme.": "同じページをスマートフォンで（ダークテーマ）。",
  "Signatures": "署名",
  "Every TET signature today is two signatures made together, Ed25519 and ML-DSA-44. A second post-quantum one is an idea, waiting for the FIPS 206 standard.":
    "今の TET の署名は、どれも Ed25519 と ML-DSA-44 の二つを一緒に作ったものです。二つ目の耐量子署名はアイデアの段階で、FIPS 206 の標準を待っています。",
  "Two solid seals joined together, the two signatures used today, and a third seal drawn in dashed lines with a pause mark: it waits for its standard.":
    "つながった二つの塗りつぶしの印は、今使っている二つの署名。点線で描かれ一時停止の印が付いた三つ目は、標準を待っています。",
  "Solid: Ed25519 and ML-DSA-44, used today. Dashed: FN-DSA, an idea waiting for the FIPS 206 standard.":
    "実線：今使っている Ed25519 と ML-DSA-44。破線：FN-DSA。FIPS 206 の標準を待っているアイデアです。",
  "A learning model": "学習モデル",
  "Papers": "論文",
  "Links only. The research note says how much of each one was read.":
    "リンクのみです。どこまで読んだかは研究ノートに書いてあります。",

  // Papers (names and IDs stay as they are)
  "Amos, Georgiou, Kiayias, Zhandry (STOC 2020)": "Amos, Georgiou, Kiayias, Zhandry（STOC 2020）",
  "IACR ePrint 2020/107": "IACR ePrint 2020/107",
  "Defines one-shot signatures. The note says its authors report a bug in its security proof. Only the abstract was read.":
    "ワンショット署名を定義した論文です。研究ノートによると、著者自身が安全性の証明に誤りがあると書いています。読んだのは概要だけです。",
  "Shmueli, Zhandry (CRYPTO 2025)": "Shmueli, Zhandry（CRYPTO 2025）",
  "IACR ePrint 2025/486": "IACR ePrint 2025/486",
  "arXiv 2507.12456": "arXiv 2507.12456",
  "The scheme the setup finding is about. The arXiv copy is the one that was read.":
    "セットアップについての結論が対象としている方式です。読んだのは arXiv 版です。",
  "Huang, Vaikuntanathan": "Huang, Vaikuntanathan",
  "arXiv 2510.10899": "arXiv 2510.10899",
  "Its abstract page says it is subsumed by IACR ePrint 2026/1210.":
    "概要ページに、IACR ePrint 2026/1210 に包含されたと書かれています。",
  "Huang, Shmueli, Vaikuntanathan, Zhandry": "Huang, Shmueli, Vaikuntanathan, Zhandry",
  "IACR ePrint 2026/1210": "IACR ePrint 2026/1210",
  "arXiv 2511.04633": "arXiv 2511.04633",
  "Read through its abstract page and its arXiv predecessor, not its full text.":
    "概要ページと、その前身の arXiv 版で読みました。本文全体は読んでいません。",
  "Two works merged into IACR ePrint 2026/1210": "IACR ePrint 2026/1210 に統合された二つの論文",
  "IACR ePrint 2025/1906": "IACR ePrint 2025/1906",
  "IACR ePrint 2025/2056": "IACR ePrint 2025/2056",
  "Muraleedharan and others": "Muraleedharan ほか",
  "arXiv 2606.23612": "arXiv 2606.23612",
  "The note reads it as a circuit for the scheme without obfuscation, not an attack.":
    "研究ノートは、難読化なしの方式を回路にしたもので、攻撃ではないと読んでいます。",
  "Coladangelo, Sattath": "Coladangelo, Sattath",
  "arXiv 2002.11998": "arXiv 2002.11998",
  "Coladangelo, Liu, Liu, Zhandry (CRYPTO 2021)": "Coladangelo, Liu, Liu, Zhandry（CRYPTO 2021）",
  "arXiv 2107.05692": "arXiv 2107.05692",
  "Zhandry (ITCS 2024)": "Zhandry（ITCS 2024）",
  "arXiv 2307.12120": "arXiv 2307.12120",
  "Bostanci, Nehoran, Zhandry": "Bostanci, Nehoran, Zhandry",
  "arXiv 2411.00529": "arXiv 2411.00529",

  // Features
  "A research note on one-shot signatures: a quantum key that can sign one message and is then used up. Today every \"once\" in TET is caught afterwards by whoever keeps the record; a one-shot key would make the second signature impossible to make.":
    "ワンショット署名についての研究ノートです。ワンショット署名とは、一つのメッセージに署名すると使い切られる量子の鍵です。今の TET の「一度だけ」は、どれも記録を持つ側が後から見つけるものです。ワンショット鍵なら、二度目の署名はそもそも作れません。",
  "Where TET already limits a permission to one use, and who catches a second use today.":
    "TET がすでに許可を一回に限っている場所と、今は誰が二度目の使用を見つけるか。",
  "What the papers that were read prove, and under which assumptions.": "読んだ論文が何を、どの仮定のもとで証明しているか。",
  "That in the standard model the scheme read in most detail needs a trusted setup.":
    "最も詳しく読んだ方式は、標準モデルでは信頼されたセットアップを必要とすること。",
  "That one-shot keys can be built or used today. Nothing quantum runs in TET.":
    "ワンショット鍵が今作れる、または使えること。TET で量子的なものは何も動いていません。",
  "That TET will adopt them. Nothing here is proposed or planned.": "TET がそれを採用すること。ここでは何も提案も予定もしていません。",
  "The proofs in the papers. Those were not read line by line.": "論文の証明。一行ずつは読んでいません。",
  "A sample wallet of one-time keys": "一度だけ使える鍵のサンプルウォレット",
  "A concept page where you can hand over notes from a sample wallet whose keys each work once. It is a model on an ordinary computer, not a key.":
    "鍵がそれぞれ一度だけ使えるサンプルのウォレットから、メモを渡してみられる構想ページです。普通のコンピューター上の模型で、鍵ではありません。",
  "What the idea would change: a used key refuses a second hand-over.": "このアイデアで変わること：使った鍵は二度目の受け渡しを拒みます。",
  "What it would not change, in the page's own Shows and Does not show.":
    "変わらないこと。ページ自身の「示すもの」「示さないもの」に書いてあります。",
  "A real one-shot key. A copy of this model could be used twice.": "本物のワンショット鍵。この模型は、写せば二回使えてしまいます。",
  "Anything real: no request leaves the page, and nothing is stored.": "本物の何か。ページから通信は出ず、何も保存されません。",
  "Open the sample wallet": "サンプルのウォレットを開く",
  "An idea for a small model with a few simulated qubits: it would show why a copied simulation can sign twice, and why a real one-shot key could not.":
    "いくつかの量子ビットをシミュレートする小さな模型のアイデアです。写したシミュレーションはなぜ二回署名できてしまうのか、本物のワンショット鍵はなぜできないのかを見せます。",
  "What the model is meant to teach: a simulation can be copied, so its key can sign twice; a real one-shot key cannot be copied.":
    "この模型で伝えたいこと：シミュレーションは写せるので、その鍵は二回署名できてしまう。本物のワンショット鍵は写せない。",
  "A working model. Nothing is designed or built yet.": "動く模型。まだ何も設計されておらず、作られてもいません。",
  "Anything about real quantum hardware. A few simulated qubits on an ordinary computer are a model, not a key.":
    "本物の量子ハードウェアについてのこと。普通のコンピューター上でシミュレートした数個の量子ビットは模型であって、鍵ではありません。",
  "FN-DSA, a second post-quantum signature": "FN-DSA：二つ目の耐量子署名",
  "Today every TET signature is two signatures: Ed25519 and ML-DSA-44. FN-DSA is a second post-quantum signature scheme TET could add. Waiting for the FIPS 206 standard.":
    "今の TET の署名は、どれも Ed25519 と ML-DSA-44 の二つの署名です。FN-DSA は、TET が加えられるかもしれない二つ目の耐量子署名方式です。FIPS 206 の標準を待っています。",
  "What TET signs with today: each signature is an Ed25519 signature and an ML-DSA-44 signature together.":
    "今の TET の署名方式：どの署名も、Ed25519 の署名と ML-DSA-44 の署名を一緒にしたものです。",
  "Any FN-DSA code. Nothing is built, and nothing is decided.": "FN-DSA のコード。何も作られておらず、何も決まっていません。",
  "When the standard will be final. It has no date here.": "標準がいつ確定するか。ここに日付はありません。",
  "Source: the pqc-forum discussion of the FIPS 206 plan": "出典：pqc-forum での FIPS 206 の計画についての議論",
};

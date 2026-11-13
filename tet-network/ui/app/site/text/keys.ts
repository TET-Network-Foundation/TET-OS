/** Japanese for the keys section's English strings (features, page text). EN is the key. */
export const JA: Record<string, string> = {
  "Your keys": "あなたの鍵",
  "A site can check that your key answered its question, without learning your name.":
    "サイトは、あなたの鍵が質問に答えたことを確かめられます。あなたの名前は知りません。",

  // Page
  "Nothing on this page runs for anyone today. Sign in with TET is a prototype that runs only on your own computer.":
    "このページのものは、今日はまだ誰にも動いていません。Sign in with TET は試作で、自分のパソコンの中だけで動きます。",
  "A site asks a question, a key answers, and the site sees a key with a check mark, not a person.":
    "サイトが質問し、鍵が答えます。サイトに見えるのはチェックの付いた鍵で、人ではありません。",
  "Sign in with TET": "Sign in with TET（TET でサインイン）",
  "A site asks your key a one-time question. Your key answers. The site checks the answer and learns a key, not your name.":
    "サイトがあなたの鍵に、一度きりの質問をします。鍵が答えます。サイトは答えを確かめ、鍵を知りますが、あなたの名前は知りません。",
  "Three steps: the site asks a one-time question, your key answers with two signatures, the site checks the answer and sees a key, not a person.":
    "3つの手順。サイトが一度きりの質問をし、鍵が2つの署名で答え、サイトが答えを確かめます。サイトに見えるのは鍵で、人ではありません。",
  "1. The site asks a one-time question. 2. Your key answers it. 3. The site checks the answer, and refuses it if it is sent twice, meant for another site, or too late.":
    "1. サイトが一度きりの質問をします。2. あなたの鍵が答えます。3. サイトが答えを確かめます。2回送られた答え、別のサイトあての答え、遅すぎた答えは断ります。",
  "Screenshot of the sign-in walkthrough on a phone: the site asks a question, your key answers, and the site accepts the answer.":
    "スマートフォンで見たサインインの説明ページの画面。サイトが質問し、鍵が答え、サイトが答えを受け入れています。",
  "The sign-in walkthrough page on a phone. It replays a recording of a real run of the prototype; it signs nothing and sends nothing. The page is waiting for review and is not on this site yet.":
    "スマートフォンで見たサインインの説明ページ。試作を実際に動かした記録を再生するだけで、何も署名せず、何も送りません。このページはレビュー待ちで、まだこのサイトにはありません。",
  "Screenshot of the same walkthrough on a computer, in dark mode, with what the accepted answer shows and does not show.":
    "同じ説明ページをパソコンのダークモードで見た画面。受け入れられた答えが示すことと示さないことが書いてあります。",
  "The same walkthrough on a computer, in dark mode. Under the answer: what it shows, and what it does not.":
    "同じ説明ページを、パソコンのダークモードで。答えの下に、それが示すことと示さないことがあります。",
  "Where your key lives": "鍵はどこにあるか",
  "Today the prototype makes your key from 12 words you give it. One idea is to keep the key in a phone's secure hardware instead, where it never leaves the phone.":
    "今の試作は、あなたが渡すパスフレーズ（12語）から鍵を作ります。代わりに、鍵をスマートフォンの安全なハードウェアの中に置き、外に出さないというアイデアがあります。",
  "On a phone this could look like…": "スマートフォンでは、たとえばこうなるかもしれません…",
  "Drawn to explain an idea. No code does this today. The phone is a generic phone with secure hardware, not any real model.":
    "アイデアを説明するための絵です。今日これをするコードはありません。描いてあるのは安全なハードウェアを持つ一般的なスマートフォンで、実在の機種ではありません。",
  "A generic phone showing a site's one-time question, with a button to answer and a button to refuse.":
    "サイトからの一度きりの質問を表示した、一般的なスマートフォン。答えるボタンと断るボタンがあります。",
  "1. A site asks a question. You see which site is asking, and choose to answer or not.":
    "1. サイトが質問します。どのサイトが尋ねているかが見え、答えるかどうかを選べます。",
  "A generic phone with a secure chip inside; the key is locked in the chip, and an arrow leaving the phone is crossed out.":
    "中に安全なチップがある、一般的なスマートフォン。鍵はチップの中に閉じ込められていて、外へ出る矢印には×が付いています。",
  "2. You unlock with the phone's own lock. The key stays inside the phone's secure hardware; it is never copied out.":
    "2. スマートフォン自身のロックで解除します。鍵はスマートフォンの安全なハードウェアの中にとどまり、外へコピーされることはありません。",
  "A generic phone sends an answer; below it, the site sees a key with a check mark, and a person crossed out.":
    "一般的なスマートフォンが答えを送ります。その下で、サイトに見えるのはチェックの付いた鍵で、人には×が付いています。",
  "3. Only the answer leaves the phone. The site sees that this key answered, not your name.":
    "3. スマートフォンから出るのは答えだけです。サイトに見えるのは、この鍵が答えたことで、あなたの名前ではありません。",
  "Passwords, passkeys and TET": "パスワード、パスキー、そして TET",
  "Passkeys already do the hard parts of signing in well. They resist fake sites, use a new key for every site, and are built into the phones and browsers you have today. TET does not claim to do these better.":
    "パスキーは、サインインの難しいところをすでにうまくこなしています。偽サイトにだまされにくく、サイトごとに別の鍵を使い、今お使いのスマートフォンやブラウザに組み込まれています。TET は、これらをパスキーよりうまくできるとは言いません。",
  Password: "パスワード",
  Passkey: "パスキー",
  "Where the design differs: two signatures on every answer, one of them designed to resist quantum computers, and a key that can also sign records. What it does not do yet: run for anyone, work in a browser or on a phone, or protect against fake sites.":
    "設計が違うところ：どの答えにも署名が2つ付き、その1つは量子コンピューターに耐えるよう作られていること。そして同じ鍵で記録にも署名できること。まだできないこと：誰にでも動くこと、ブラウザやスマートフォンで使えること、偽サイトから守ること。",

  // Comparison rows
  "Can a fake site trick you into handing it over?": "偽サイトにだまされて渡してしまうことはある？",
  "Yes. You can type a password into a page that only looks like the real one.":
    "あります。本物そっくりなだけのページに、パスワードを入力してしまうことがあります。",
  "No. Your phone or browser offers a passkey only to the site it was made for.":
    "ありません。スマートフォンやブラウザは、パスキーを作ったサイトにしか差し出しません。",
  "The design would check where the question came from. The prototype does not check this yet.":
    "設計では、質問がどこから来たかを確かめます。試作はまだこれを確かめません。",
  "What does the site keep?": "サイトは何を保管する？",
  "Something to check your password against. If it leaks, your password can be guessed or reused.":
    "パスワードを照合するためのもの。漏れると、パスワードを推測されたり、使い回されたりすることがあります。",
  "A public key only. A leak gives nobody a way to sign in.": "公開鍵だけ。漏れても、それでサインインできる人はいません。",
  "A public key only. In the design, two: one for each half of the signature.":
    "公開鍵だけ。設計では2つで、署名の半分ずつに1つです。",
  "A different key for every site?": "サイトごとに別の鍵？",
  "Only if you make up a new password for each site.": "サイトごとに新しいパスワードを考えた場合だけ。",
  "Yes, always.": "はい、いつも。",
  "In the design, yes, made from your 12 words. The prototype uses the one key you give it.":
    "設計では、はい。パスフレーズ（12語）から作ります。試作は、渡された1つの鍵を使います。",
  "Can you use it today?": "今日使える？",
  "Yes, everywhere.": "はい、どこでも。",
  "Yes. It is built into phones, computers and browsers today.": "はい。今日のスマートフォン、パソコン、ブラウザに組み込まれています。",
  "No. It is a prototype that runs only on your own computer.": "いいえ。自分のパソコンの中だけで動く試作です。",
  "Signatures and future quantum computers": "署名と、これからの量子コンピューター",
  "A password is not a signature.": "パスワードは署名ではありません。",
  "Most passkeys use one classical signature, which a large enough quantum computer could break.":
    "ほとんどのパスキーは従来型の署名を1つ使います。十分に大きな量子コンピューターなら破れるかもしれません。",
  "Every answer carries two signatures: Ed25519, and ML-DSA-44, which is designed to resist quantum computers. Full quantum resistance of TET identities is not claimed yet.":
    "どの答えにも署名が2つ付きます。Ed25519 と、量子コンピューターに耐えるよう作られた ML-DSA-44 です。TET の ID が完全に量子耐性を持つとは、まだ言いません。",
  "Can the same key sign other things?": "同じ鍵で、ほかのものにも署名できる？",
  "No.": "いいえ。",
  "No. A passkey is made for signing in.": "いいえ。パスキーはサインインのためのものです。",
  "Yes: a TET key can also sign records. The design keeps sign-in signatures apart from records; the prototype only labels them, and that is not reviewed.":
    "はい。TET の鍵は記録にも署名できます。設計ではサインインの署名を記録と切り分けます。試作はラベルを付けるだけで、その方法はレビューされていません。",
  "If you lose it": "なくしたら",
  "Most sites can reset it, often by email.": "ほとんどのサイトで、たいていメールで再設定できます。",
  "Often kept in your phone or browser account, so a new device can get it back.":
    "多くの場合、スマートフォンやブラウザのアカウントに保管されていて、新しい端末で取り戻せます。",
  "Nobody can recover your 12 words. A site that needs recovery keeps its own.":
    "パスフレーズ（12語）は誰にも復元できません。復元が必要なサイトは、自分で復元の手段を用意します。",
  "Prove you belong to a group without saying who you are?": "誰かを明かさずに、グループの一員だと示せる？",
  "Not what passkeys are for.": "パスキーはそのためのものではありません。",
  "An idea in the design, using TET's existing membership proof. Not built for sign-in.":
    "設計の中のアイデアで、TET にすでにあるメンバーであることの証明を使います。サインイン用には作られていません。",

  // Features
  "A site asks a one-time question, your key answers, and the site checks the answer. Design not reviewed. The prototype runs only on your own computer and is not for real logins.":
    "サイトが一度きりの質問をし、あなたの鍵が答え、サイトが答えを確かめます。設計はレビュー前です。試作は自分のパソコンの中だけで動き、実際のログインには使えません。",
  "This key answered this site's question, once, before it expired.": "この鍵が、このサイトの質問に、期限内に1回だけ答えたこと。",
  "Both halves of the answer's signature were checked, Ed25519 and ML-DSA-44, by TET's existing verifier.":
    "答えの署名の両方の半分、Ed25519 と ML-DSA-44 が、TET の既存の検証プログラムで確かめられたこと。",
  "Who holds the key. Anyone with the 12 words can answer. The site learns a key, not a person.":
    "誰が鍵を持っているか。12語を持つ人なら誰でも答えられます。サイトが知るのは鍵であって、人ではありません。",
  "That you meant to sign in to this site: the prototype signs any question it is given. The full design would check where the question came from and show the site's name first; neither is built.":
    "あなたがこのサイトにサインインするつもりだったこと。試作品は渡された質問を何でも署名します。完全な設計では、質問がどこから来たかを確かめ、先にサイト名を表示しますが、どちらもまだ作られていません。",
  "Anything after a restart: the server keeps its questions in memory only.":
    "再起動の後のことは何も。サーバーは質問をメモリーにしか保持しません。",
  "A different key for each site: that is in the design, not in the prototype.":
    "サイトごとに別の鍵を使うこと。設計にはありますが、試作にはありません。",
  "That it is ready for real logins: the design has not been reviewed.": "実際のログインに使えること。設計はレビューされていません。",
  "Sign in as a member, without saying who": "誰かを明かさずに、メンバーとしてサインイン",
  "In the design, a site could learn only that a member of a group signed in, using the membership proof TET already has. Design only; not built for sign-in.":
    "設計では、TET にすでにあるメンバーであることの証明を使い、サイトが知るのは「グループの誰かがサインインした」ことだけになります。設計だけで、サインイン用には作られていません。",
  "If it were built: a member of this group answered this site's question.":
    "作られたなら：このグループのメンバーの誰かが、このサイトの質問に答えたこと。",
  "Which member answered.": "どのメンバーが答えたか。",
  "Anything today: no sign-in code uses the membership proof.": "今日は何も。メンバーであることの証明を使うサインインのコードはありません。",
  "That the design is reviewed: it is not.": "設計がレビュー済みであること。レビューされていません。",
  "An idea, not decided: your key is made and kept inside a phone's secure hardware and never leaves it. A site sees that this key answered, not your name. None of this is built.":
    "まだ決めていないアイデアです。鍵はスマートフォンの安全なハードウェアの中で作られ、そこに置かれ、外に出ません。サイトに見えるのはこの鍵が答えたことで、あなたの名前ではありません。どれもまだ作られていません。",
  "If it were built: this key answered this site's question. Nothing is built, so today it shows nothing.":
    "作られたなら：この鍵が、このサイトの質問に答えたこと。何も作られていないので、今日は何も示しません。",
  "Your name: a site learns a key, not who you are.": "あなたの名前。サイトが知るのは鍵で、あなたが誰かではありません。",
  "Whether a phone's secure hardware can hold TET's two-part key (Ed25519 and ML-DSA-44). That has not been checked.":
    "スマートフォンの安全なハードウェアが、TET の2つでひと組の鍵（Ed25519 と ML-DSA-44）を持てるかどうか。まだ確かめていません。",
  "How it would fit with the 12 words. A key that never leaves the hardware cannot be written down, so getting it back after losing the phone would work differently. Not decided.":
    "パスフレーズ（12語）とどう合わせるか。ハードウェアから出ない鍵は書き留められないので、スマートフォンをなくした後に取り戻す方法は変わります。まだ決めていません。",
  "That anything here works today: no code keeps a TET key in a phone's secure hardware.":
    "ここにあるものが今日動くこと。TET の鍵をスマートフォンの安全なハードウェアに置くコードはありません。",
};

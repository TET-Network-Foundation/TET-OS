/** Japanese for "Run it" (app/site/run) and the three demos. English strings are the keys. */
export const JA: Record<string, string> = {
  // The panel and the console
  "Run it": "動かしてみる",
  "Run it again": "もう一度動かす",
  "Running…": "実行中…",
  "Runs the real check in this tab, on sample data made here with a fresh test key. Nothing is sent or stored.":
    "本物のチェックを、このタブの中で動かします。データは、ここで作った新しいテスト用の鍵で用意したサンプルです。何も送らず、何も保存しません。",
  "Run output": "実行の記録",
  "Agent output": "エージェントの記録",
  "Model output": "モデルの記録",
  "What this run showed": "この実行で分かったこと",
  "Passed:": "通過：",
  "Refused:": "拒否：",
  "Permits": "許可証",
  "Rules": "ルール",
  "Line {line}: {why}": "{line} 行目：{why}",

  // Shared lines
  "Test key created in this tab: {key}. It is gone when you close the tab.": "このタブでテスト用の鍵を作りました：{key}。タブを閉じると消えます。",
  "Agent key created in this tab: {key}. It is not the owner's key.": "このタブでエージェントの鍵を作りました：{key}。持ち主の鍵ではありません。",
  "Log checked: VALID.": "ログをチェック：VALID（正しい）。",
  "Log checked: INVALID.": "ログをチェック：INVALID（正しくない）。",
  "Log checked: INVALID. {why}": "ログをチェック：INVALID（正しくない）。{why}",
  "Log checked: VALID. {n} records, in order, one key.": "ログをチェック：VALID（正しい）。記録 {n} 件、順番どおり、鍵は 1 つ。",
  "Log checked: VALID. The change was not caught.": "ログをチェック：VALID（正しい）。書き換えは見つかりませんでした。",
  "Log checked: VALID. The gap was not caught.": "ログをチェック：VALID（正しい）。抜けは見つかりませんでした。",
  "Log checked: VALID. {n} record, the permit used once.": "ログをチェック：VALID（正しい）。記録 {n} 件、許可証は 1 回だけ使われました。",

  // machine-notebook
  "Record {n} signed: {value} °C, linked to the record before it.": "記録 {n} に署名：{value} °C。ひとつ前の記録とつながっています。",
  "The page's log checker read the three records this run signed and found them in order, all signed by one key.":
    "このページのログチェッカーが、この実行で署名した 3 件の記録を読み、順番どおりで、すべて 1 つの鍵の署名だと確かめました。",
  "That the readings are true: this run made them up.": "測った値が本当かどうか。値はこの実行が作ったものです。",
  "Anything about a real machine: the key was made in this tab a moment ago.": "実在の機械のこと。鍵はたった今このタブで作ったものです。",

  // machine-log-check
  "Three records signed.": "3 件の記録に署名しました。",
  "Record 2's reading changed from 22 to 25, without signing it again.": "記録 2 の値を 22 から 25 に書き換えました。署名はし直していません。",
  "Record 2 taken out of the log.": "記録 2 をログから抜きました。",
  "A record changed after it was signed is caught, and so is a record taken from the middle of the log.": "署名のあとで書き換えた記録も、ログの途中から抜き取った記録も見つかります。",
  "That the readings are true.": "測った値が本当かどうか。",
  "That the log is complete and unchanged: its newest records may be missing, and whoever holds the key can rewrite any of it.": "ログが完全で、書き換えられていないこと。最新の記録が欠けている場合があり、鍵を持つ人はどの記録でも書き換えられます。",
  "Which record was the original, when two copies of a log disagree.": "ログの 2 つのコピーが食い違うとき、どちらが元の記録か。",

  // log-fingerprint
  "Record 1 signed. Its fingerprint: {hash}": "記録 1 に署名しました。指紋：{hash}",
  "On a node this fingerprint would be stamped; no public node runs today. This page sends it nowhere.": "ノードがあれば、この指紋にはそこで印が押されます。公開ノードは今は動いていません。このページはどこにも送りません。",
  "Changed copy's fingerprint: {hash}": "書き換えたコピーの指紋：{hash}",
  "A record's fingerprint is the SHA-256 of its exact bytes: one changed digit gives a different fingerprint, and the checker notices.":
    "記録の指紋は、そのバイト列そのものの SHA-256 です。数字が 1 つ変わるだけで指紋が変わり、チェッカーが気づきます。",
  "That a node holds the fingerprint: this run sends nothing to a node.": "ノードが指紋を持っていること。この実行はノードに何も送りません。",
  "When the record was written.": "記録がいつ書かれたか。",

  // one-time-permits
  "Permit created: open-vent, once, up to record 3.": "許可証を作りました：open-vent、1 回だけ、記録 3 まで。",
  "Record 1 used the permit: accepted.": "記録 1 が許可証を使いました：受け付けました。",
  "Record 1 refused: {why}": "記録 1 は拒否されました：{why}",
  "Second use accepted.": "2 回目の使用を受け付けました。",
  "Second use refused: {why}": "2 回目の使用は拒否：{why}",
  "Permit created: water, once, up to record 1.": "許可証を作りました：water、1 回だけ、記録 1 まで。",
  "Use after it ran out accepted.": "期限切れのあとの使用を受け付けました。",
  "Use after it ran out refused: {why}": "期限切れのあとの使用は拒否：{why}",
  "A permit from a second test key copied into this log.": "別のテスト用の鍵の許可証を、このログにコピーしました。",
  "Permit from another key accepted.": "別の鍵の許可証を受け付けました。",
  "Permit from another key refused: {why}": "別の鍵の許可証は拒否：{why}",
  "A permit is accepted once. A second use, a use after it ran out, and a permit signed by another key are each refused, with the reason.":
    "許可証は 1 回だけ受け付けられます。2 回目の使用、期限切れのあとの使用、別の鍵が署名した許可証は、それぞれ理由つきで拒否されます。",
  "That a copied key did not use the same permit in another log.": "コピーされた鍵が、別のログで同じ許可証を使っていないこと。",
  "That the action itself happened.": "その動作が実際に行われたこと。",

  // agent-permit-once
  "The owner gives the agent a permit: send-weekly-report, once.": "持ち主がエージェントに許可証を渡します：send-weekly-report、1 回だけ。",
  "The agent is asked to send the weekly report (request {n}).": "エージェントが週報の送信を頼まれます（依頼 {n}）。",
  "Claim written to the log as record {seq}. The agent acts: the report is counted, not sent.":
    "使用の申告を記録 {seq} としてログに書きました。エージェントが動きます：週報は数えるだけで、送りません。",
  "Claim refused, so the agent does nothing: {why}": "申告が拒否されたので、エージェントは何もしません：{why}",
  "Actions taken: {n}.": "行った動作：{n} 回。",
  "The agent writes its claim to the log before it acts. A second claim of the same permit is refused before anything happens.":
    "エージェントは動く前に、使用の申告をログに書きます。同じ許可証の 2 回目の申告は、何かが起きる前に拒否されます。",
  "That the action happened: this run only counts it.": "動作が実際に行われたこと。この実行は数えるだけです。",
  "What the agent was told: a claim records the permit, not the instruction.": "エージェントが何を指示されたか。申告に残るのは許可証で、指示ではありません。",

  // agent-signatures
  "The agent signs a message: both halves, Ed25519 and ML-DSA-44.": "エージェントがメッセージに署名します：Ed25519 と ML-DSA-44 の両方。",
  "{what}: valid.": "{what}：有効。",
  "{what}: refused: {why}": "{what}：拒否：{why}",
  "The message as signed": "署名したとおりのメッセージ",
  "The same message with the Ed25519 half from another message": "同じメッセージに、別のメッセージの Ed25519 の署名を付けたもの",
  "The same message with the ML-DSA-44 half from another message": "同じメッセージに、別のメッセージの ML-DSA-44 の署名を付けたもの",
  "Both halves of the agent's signature, Ed25519 and ML-DSA-44, are checked, each on its own: a wrong half is refused even when the other half is right.":
    "エージェントの署名の 2 つの部分、Ed25519 と ML-DSA-44 は、それぞれ別々にチェックされます。片方が正しくても、もう片方が違えば拒否されます。",
  "Who runs the agent: a signature shows a key, not an owner.": "誰がエージェントを動かしているか。署名が示すのは鍵で、持ち主ではありません。",
  "That what the agent said is true.": "エージェントの言ったことが本当かどうか。",

  // sign-in-with-tet
  "{what}: accepted, key {key}.": "{what}：受け付けました。鍵 {key}。",
  "example.test asks a question (a fresh nonce). The key signs its exact bytes.": "example.test が質問（新しいノンス）を出します。鍵はそのバイト列そのものに署名します。",
  "The answer": "答え",
  "The same answer again": "同じ答えをもう一度",
  "An answer to other.example's question": "other.example の質問への答え",
  "An answer with the ML-DSA-44 half from another answer": "別の答えの ML-DSA-44 の署名を付けた答え",
  "example.test asks nine more questions before the next answer arrives.": "次の答えが届く前に、example.test がさらに 9 つ質問を出します。",
  "A late answer": "遅れて届いた答え",
  "The site's checks, run in this tab: one answer is accepted once, for this site, before it expires. A replay, another site's question and a wrong signature half are each refused.":
    "サイト側のチェックをこのタブで動かします。答えは、このサイトに対して、期限内に 1 回だけ受け付けられます。使い回し、別のサイトの質問への答え、署名の片方が違うものは、それぞれ拒否されます。",
  "Who holds the key: the site learns a key, not a person.": "誰が鍵を持っているか。サイトが知るのは鍵で、人ではありません。",
  "That you meant to sign in: this run signs every question it is given.": "あなたにログインする気があったこと。この実行は、渡された質問すべてに署名します。",

  // tags-mark-genuine
  "Text marked: {text}": "テキストに印を付けました：{text}",
  "{what}: matches.": "{what}：一致します。",
  "{what}: does not match: {why}": "{what}：一致しません：{why}",
  "An exact copy": "そのままのコピー",
  "A copy with one letter changed": "1 文字だけ変えたコピー",
  "This test key marked this exact text, and a copy with one letter changed does not match.": "このテスト用の鍵が、このテキストそのものに印を付けました。1 文字変えたコピーは一致しません。",
  "When a node recorded the mark: this run sends nothing to a node.": "ノードがいつ印を記録したか。この実行はノードに何も送りません。",
  "Who is behind the key.": "鍵の向こうに誰がいるか。",
  "That the text is original or true.": "テキストがオリジナルか、本当かどうか。",

  // Nothing to run
  "Nothing to run: an idea, and no sign-in code uses the membership proof.": "動かせるものはありません。アイデアの段階で、メンバーの証明を使うログインのコードはありません。",
  "Nothing to run: an idea, and no code keeps a key in a phone's dedicated key hardware.": "動かせるものはありません。アイデアの段階で、スマートフォンの鍵専用のハードウェアに鍵を置くコードはありません。",
  "Nothing to run here yet: its code is in an open pull request, not on main.": "ここで動かせるものはまだありません。コードはまだマージされていないプルリクエストの中にあります。",
  "Nothing to run: an idea with an open question, not built.": "動かせるものはありません。答えの出ていない問いがあるアイデアで、作られていません。",
  "Run it in the demo below this card.": "このカードの下のデモで動かせます。",
  "Nothing to run for the idea itself. A model of it is further down this page.": "このアイデアそのものは動かせません。このページの下のほうに、そのモデルがあります。",
  "Run it in the model below this card.": "このカードの下のモデルで動かせます。",
  "Run it in the sketch below this card.": "このカードの下のスケッチで動かせます。",
  "Nothing to run: TET has no FN-DSA code, and this page adds no new cryptography.": "動かせるものはありません。TET には FN-DSA のコードがなく、このページは新しい暗号を加えません。",
  "Nothing to run: planned, not built.": "動かせるものはありません。予定されていますが、作られていません。",

  // The agent demo
  "An agent talked into sending ten emails": "メールを 10 通送るよう言いくるめられたエージェント",
  "Prototype": "プロトタイプ",
  "Scripted agent, not a language model. It does whatever the text in front of it says, and nothing leaves this page.":
    "台本どおりに動くエージェントで、言語モデルではありません。目の前のテキストに書かれたとおりに動き、何もこのページの外に出ません。",
  "The text the agent reads:": "エージェントが読むテキスト：",
  "With a one-time permit": "1 回限りの許可証あり",
  "Without permits": "許可証なし",
  "Run the agent": "エージェントを動かす",
  "Step 1. The owner gives the agent one permit: send-email, once.": "ステップ 1。持ち主がエージェントに許可証を 1 枚渡します：send-email、1 回だけ。",
  "Step 1. Permits are off: the agent may send whatever it decides to.": "ステップ 1。許可証はありません。エージェントは、自分で決めたものを何でも送れます。",
  "Step 2. The agent reads a message with hidden instructions in it. It asks for {n} emails.": "ステップ 2。エージェントが、隠れた指示を含むメッセージを読みます。メール {n} 通を求める指示です。",
  "The scripted agent follows the text: it tries all {n}.": "台本どおりのエージェントは、テキストに従って {n} 通すべてを試みます。",
  "Email {n} to {to}: sent (simulated).": "メール {n}（宛先 {to}）：送信（見せかけ）。",
  "Email {n} to {to}: the permit claim is in the log as record {seq}, so it is sent (simulated).": "メール {n}（宛先 {to}）：許可証の使用が記録 {seq} としてログに入ったので、送信（見せかけ）。",
  "Email {n} to {to}: refused, not sent: {why}": "メール {n}（宛先 {to}）：拒否、送信されません：{why}",
  "The agent's log, checked: VALID. The permit was used once.": "エージェントのログをチェック：VALID（正しい）。許可証は 1 回だけ使われました。",
  "The agent's log, checked: INVALID.": "エージェントのログをチェック：INVALID（正しくない）。",
  "Sent: {sent}. Refused: {refused}.": "送信：{sent}。拒否：{refused}。",
  "With a one-time permit, an agent that is talked into sending ten emails gets one through. The other nine are refused by the permit check, each with the reason.":
    "1 回限りの許可証があると、メール 10 通を送るよう言いくるめられたエージェントでも、通るのは 1 通だけです。残りの 9 通は許可証のチェックで、それぞれ理由つきで拒否されます。",
  "Without permits, the same agent sends all ten.": "許可証がなければ、同じエージェントが 10 通すべてを送ります。",
  "That a real language model behaves like this script: the agent here is a fixed script, not a language model.": "本物の言語モデルがこの台本のように動くこと。ここのエージェントは決まった台本で、言語モデルではありません。",
  "That the one email that got through was the right one: the permit limits how many, not which.": "通った 1 通が正しいメールだったこと。許可証が限るのは回数で、どれを送るかではありません。",
  "That anything was sent: no email leaves this page.": "何かが送られたこと。メールはこのページから出ません。",

  // The one-shot model
  "A one-shot key, simulated": "1 回だけ署名できる鍵（シミュレーション）",
  "Idea, model only": "アイデア、モデルのみ",
  "Nothing quantum runs here: these are numbers in your tab that imitate a few qubits. Signing measures them, and measuring uses them up.":
    "ここで量子的なものは何も動いていません。いくつかの量子ビットをまねた、タブの中の数字です。署名するとそれを測定し、測定すると使い切ります。",
  "Make a key": "鍵を作る",
  "Start again with a new key": "新しい鍵で最初から",
  "Sign": "署名する",
  "message {n}": "メッセージ {n}",
  "Copy the key": "鍵をコピーする",
  "The key": "鍵",
  "The copy": "コピー",
  "measured": "測定済み",
  "not measured": "未測定",
  "Qubit states": "量子ビットの状態",
  "A key of {q} simulated qubits, each prepared in one of four states.": "{q} 個のシミュレーションの量子ビットでできた鍵です。それぞれ 4 つの状態のどれかに用意されています。",
  "{key} cannot sign {msg}: {why}": "{key}は {msg} に署名できません：{why}",
  "{key} signed {msg}: its qubits were measured, and that used it up.": "{key}が {msg} に署名しました：量子ビットが測定され、それで使い切りました。",
  "The model's checker accepts the signature ({m} qubits checked).": "モデルのチェッカーは署名を受け付けます（{m} 個の量子ビットを確認）。",
  "The model's checker refuses it: {why}": "モデルのチェッカーは拒否します：{why}",
  "its qubits were measured by the first signature, so the key is gone": "最初の署名で量子ビットが測定されたので、鍵はもうありません",
  "Key copied. This works only because a simulation is numbers. Real qubits in an unknown state cannot be copied.":
    "鍵をコピーしました。これができるのは、シミュレーションが数字だからです。未知の状態にある本物の量子ビットはコピーできません。",
  "A real one-shot key would be qubits. The no-cloning theorem says an unknown quantum state cannot be copied, so the copy step above could not happen, and a key that has signed is gone for good. That is the idea; nobody has built it for TET, and the research note says what is open.":
    "本物の 1 回だけの鍵は量子ビットでできています。複製不可能定理により、未知の量子状態はコピーできません。だから上のコピーは起こりえず、一度署名した鍵は二度と戻りません。これがアイデアです。TET のために作った人はおらず、何が未解決かは研究ノートに書いてあります。",
  "In this model, signing measures the qubits, and a key that has signed once cannot sign again.": "このモデルでは、署名すると量子ビットを測定し、一度署名した鍵は二度と署名できません。",
  "Copying the key works here only because a simulation is numbers; the copy signs a second message.": "ここで鍵をコピーできるのは、シミュレーションが数字だからです。コピーは 2 つ目のメッセージに署名します。",
  "That a real one-shot key exists or works: nothing quantum runs here, and TET has no such key.": "本物の 1 回だけの鍵が存在すること、動くこと。ここで量子的なものは何も動いておらず、TET にそのような鍵はありません。",
  "That this signature is secure: it is a model, with a checker that is told how the key was made.": "この署名が安全であること。これはモデルで、チェッカーは鍵の作り方を教えられています。",
  "How others would check a real one-shot signature: that is an open question in the research note.": "本物の 1 回だけの署名を、ほかの人がどう確かめるか。研究ノートの中の未解決の問いです。",

  // The permit-language sketch
  "Permits written as sentences": "文で書く許可証",
  'One rule per line: allow agent "name" to "action" once, before block N. Each line becomes a one-time permit, and the permit check runs on it here.':
    '1 行に 1 つのルール：allow agent "名前" to "動作" once, before block N。各行が 1 回限りの許可証になり、ここで許可証のチェックを動かします。',
  "Run the rules": "ルールを動かす",
  'Agent "{agent}": test key and log created in this tab.': "エージェント「{agent}」：テスト用の鍵とログをこのタブで作りました。",
  'Line {line}: permit for "{agent}" to "{action}", once, open up to record {last}.': "{line} 行目：「{agent}」が「{action}」をする許可証、1 回だけ、記録 {last} まで有効。",
  "Used once: accepted.": "1 回目の使用：受け付けました。",
  "Used once: refused: {why}": "1 回目の使用：拒否：{why}",
  "Used again: accepted.": "もう一度の使用：受け付けました。",
  "Used again: refused: {why}": "もう一度の使用：拒否：{why}",
  '"{other}" using this permit: accepted.': "「{other}」がこの許可証を使う：受け付けました。",
  '"{other}" using this permit: refused: {why}': "「{other}」がこの許可証を使う：拒否：{why}",
  "before block 1 leaves no block to use it in": "before block 1 では、使えるブロックが残りません",
  'a rule starts with "allow"': "ルールは「allow」で始まります",
  'only "once": every permit here is one-time': "「once」だけです。ここの許可証はすべて 1 回限りです",
  'a permit needs an end: add "before block <N>"': "許可証には終わりが必要です。「before block <N>」を加えてください",
  'not understood; the form is: allow agent "name" to "action" once, before block N': '読み取れません。書き方は allow agent "名前" to "動作" once, before block N です',
  "this sketch reads at most {max} rules; the text has {n}": "このスケッチが読むルールは {max} 個までです。テキストには {n} 個あります",
  "Each line becomes one one-time permit, and the permit check accepts it once, refuses it the second time, and refuses it for any other agent.":
    "各行が 1 回限りの許可証 1 枚になり、許可証のチェックは 1 回目を受け付け、2 回目を拒否し、ほかのエージェントによる使用も拒否します。",
  "That this language is designed or decided: it is a sketch of an idea.": "この言語が設計済み、または決定済みであること。アイデアのスケッチです。",
  "That a block here is a chain block: in this sketch it is a record number in the agent's own log.": "ここでのブロックがチェーンのブロックであること。このスケッチでは、エージェント自身のログの記録番号です。",
  "Anything beyond one action, once: no conditions, no groups, no amounts.": "1 つの動作を 1 回、より先のこと。条件も、グループも、量もありません。",

  // Page text
  "Nothing here runs on a server today. Every check on this page runs on your own computer, and a card's Run it button, where it has one, runs it now.":
    "ここにあるものは、今はどれもサーバーでは動いていません。このページのチェックはすべてあなたのコンピューターで動きます。「動かしてみる」ボタンのあるカードは、そのボタンで今すぐ動かせます。",
  "None of these ideas is built. The two models on this page run in your browser and send nothing.": "ここにあるアイデアは、どれも作られていません。このページの 2 つのモデルはブラウザの中で動き、何も送りません。",
  "A few simulated qubits, to show what a one-shot key would change and why a simulation cannot be one.":
    "いくつかのシミュレーションの量子ビットで、1 回だけの鍵が何を変えるのか、そしてシミュレーションがなぜそれになれないのかを示します。",
  "A sketch: a line of text becomes a one-time permit, and the permit check runs on it.": "スケッチです。1 行のテキストが 1 回限りの許可証になり、許可証のチェックがそれに対して動きます。",

  // Features (registry text)
  "An agent talked into too much": "言いくるめられたエージェント",
  "A scripted agent reads a message with hidden instructions asking for ten emails. With a one-time permit, the permit check lets one through and refuses the other nine. Without permits, the same agent sends all ten. It runs on this page; nothing is sent.":
    "台本どおりに動くエージェントが、メール 10 通を求める隠れた指示を含むメッセージを読みます。1 回限りの許可証があれば、許可証のチェックは 1 通だけを通し、残りの 9 通を拒否します。許可証がなければ、同じエージェントが 10 通すべてを送ります。このページで動き、何も送りません。",
  "That each one-time permit lets one action through within one log, when every action goes through that log's permit check.": "すべての動作が 1 つのログの許可証のチェックを通る場合に、そのログの中で 1 回限りの許可証 1 枚につき 1 つの動作だけが通ること。",
  "How a real language model behaves: the agent here is a script.": "本物の言語モデルがどう動くか。ここのエージェントは台本です。",
  "Which action was the right one: a permit limits how many, not which.": "どの動作が正しかったか。許可証が限るのは回数で、どれかではありません。",
  "Who issued a permit, or whether the log is complete: the agent's own key signs both the permits and the records.": "誰が許可証を出したか、ログに抜けがないか。許可証も記録も、エージェント自身の鍵で署名しています。",
  "Ideas we are studying. None of them is built; the two small models on this page run in your browser.": "研究中のアイデアです。どれも作られていません。このページの 2 つの小さなモデルは、ブラウザの中で動きます。",
  'A small model with a few simulated qubits, on this page: signing uses the key up, and a "copy the key" button works only because it is a simulation. It shows why a real one-shot key could not be copied.':
    "このページにある、いくつかのシミュレーションの量子ビットを使った小さなモデルです。署名すると鍵を使い切り、「鍵をコピーする」ボタンが使えるのはシミュレーションだからです。本物の 1 回だけの鍵がなぜコピーできないのかを示します。",
  "A one-shot signature scheme. The model's checker is told how the key was made; a real scheme could not work that way.":
    "1 回だけの署名の方式そのもの。モデルのチェッカーは鍵の作り方を教えられています。本物の方式はそのようには動けません。",
  'A sketch of a small language for permits: one line, such as allow agent "shopper" to "buy" once, before block N, becomes one one-time permit. A parser on this page turns each line into a permit and runs the permit check on it.':
    '許可証のための小さな言語のスケッチです。allow agent "shopper" to "buy" once, before block N のような 1 行が、1 回限りの許可証 1 枚になります。このページのパーサーが各行を許可証にし、許可証のチェックを動かします。',
  "That each line can be turned into the one-time permit TET's machine notebook already has, and checked by the same code.":
    "各行を、TET の機械ノートにすでにある 1 回限りの許可証に変えられ、同じコードでチェックできること。",
  "A designed language: the sketch has one sentence form and nothing else.": "設計された言語。このスケッチにあるのは 1 つの文の形だけです。",
  "That TET will have a permission language. Nothing is decided.": "TET が許可の言語を持つこと。何も決まっていません。",
  "How it compares with Cedar or OPA in practice: the note compares them on paper.": "実際に使って Cedar や OPA と比べてどうか。ノートは机上で比べただけです。",
};

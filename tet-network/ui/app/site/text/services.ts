/** Japanese for the services section's English strings (features, page text). EN is the key. */
export const JA: Record<string, string> = {
  "Everyday services": "身近なサービス",
  "Bookings, deliveries and reviews that rest on signed records instead of trust in one platform.":
    "予約、配達、レビューを、一つのプラットフォームへの信頼ではなく、署名された記録で支えます。",

  // page
  "Nothing on this page runs for anyone today. All three services are one prototype, /market, that runs only on your own computer, with sample keys.":
    "このページのものは、今日まだ誰にも動いていません。3つのサービスはどれも1つの試作品 /market で、サンプルの鍵を使い、あなた自身のパソコンの中だけで動きます。",
  "A calendar, a parcel and a review, each joined to one check mark: each rests on a signed record.":
    "カレンダー、荷物、レビューが、それぞれ1つのチェックマークにつながっています。どれも署名された記録に支えられています。",
  "Settling up stays outside TET": "精算はTETの外で",
  "No record here carries an amount. The records say who signed what, and settling up happens outside TET (cash, bank, …).":
    "ここの記録には金額が一切入りません。記録が示すのは誰が何に署名したかで、精算はTETの外で行われます（現金、銀行振込など）。",
  "Settling up happens outside TET (cash, bank, …).": "精算はTETの外で行われます（現金、銀行振込など）。",

  // booking
  Booking: "予約",
  "Booking with a different name at each shop": "お店ごとに別の名前で予約",
  "Your device makes a different key for each shop you book with. Two shops cannot match those keys to each other.":
    "あなたの端末は、予約するお店ごとに別の鍵を作ります。2つのお店は、その鍵を互いに突き合わせられません。",
  "A phone holds two different keys, one for each of two shops. Each shop keeps its own record for its key; the two keys cannot be matched.":
    "スマートフォンが、2つのお店それぞれのための別々の鍵を持っています。お店はどちらも自分の鍵の記録だけを持ち、2つの鍵は突き合わせられません。",
  "1 Your device makes a different key for each shop. 2 Each shop keeps its own signed record for that key: came, or did not come. 3 The two keys cannot be matched to each other.":
    "1 あなたの端末が、お店ごとに別の鍵を作ります。2 お店はそれぞれ、その鍵について自分で署名した記録（来た、来なかった）を持ちます。3 2つの鍵は互いに突き合わせられません。",
  "Shops cannot compare notes": "お店どうしで照らし合わせられない",
  "Each shop gets a different key from you, so two shops cannot match their records to each other.":
    "お店ごとに受け取る鍵が違うので、2つのお店は記録を互いに突き合わせられません。",
  "A key, not your name": "名前ではなく鍵",
  "A booking names a key, a shop and a time. Your name and number are not in it.":
    "予約に書かれるのは、鍵とお店と時間です。あなたの名前や電話番号は入りません。",
  "Shops still see no-shows": "来なかった回数はお店にわかる",
  "A shop can count how often this pseudonym booked and did not come, from its own signed records.":
    "お店は、自分で署名した記録から、この仮名が予約して来なかった回数を数えられます。",
  "Your device makes a different key for each shop: a pseudonym. A shop sees how many times that pseudonym booked and did not come, at that shop only.":
    "あなたの端末は、お店ごとに別の鍵（仮名）を作ります。お店にわかるのは、その仮名がそのお店で予約して来なかった回数だけです。",
  "How many times this pseudonym booked at this shop and did not come, by this shop's own signed records.":
    "この仮名がこのお店で予約して来なかった回数（このお店自身の署名済み記録による）。",
  "Who the person booking is.": "予約した人が誰か。",
  "Their record at any other shop: there they use another pseudonym.": "ほかのお店でのその人の記録。そこでは別の仮名を使っています。",
  "That they did not start over: a person can drop a pseudonym with no-shows and start a new one, which looks like someone new.":
    "その人がやり直していないこと。来なかった記録のある仮名を捨てて新しい仮名を始めることができ、新しい仮名は別の人に見えます。",
  "That the shop marked \"did not come\" fairly: these are the shop's own records.":
    "お店が「来なかった」を公正に付けたこと。これはお店自身の記録です。",
  "How anyone settles up: that happens outside TET.": "誰がどう精算したか。精算はTETの外で行われます。",
  "Try it on /market": "/market で試す",

  // delivery
  Delivery: "配達",
  "Delivery handover records": "配達の受け渡し記録",
  "A parcel's journey ends with one record that both the courier and the receiver signed, for the parcel the sender signed.":
    "荷物の旅は、送り主が署名した荷物について、配達員と受取人の両方が署名した1つの記録で終わります。",
  "A parcel with a signed tag, a permit marked 1× from the courier service, a van, and at the door a handover with two signatures.":
    "署名されたタグの付いた荷物、配送サービスが出した「1×」の許可、配達の車、そして玄関先で2つの署名が入った受け渡し。",
  "1 The sender signs the parcel's tag. 2 The courier service gives one courier a permit that works once, for this parcel. 3 At the door, the courier and the receiver both sign the handover.":
    "1 送り主が荷物のタグに署名します。2 配送サービスが1人の配達員に、この荷物にだけ1回使える許可を出します。3 玄関先で、配達員と受取人の両方が受け渡しに署名します。",
  "Both sides sign": "両方が署名する",
  "The handover is signed by the courier and by the receiver, not taken on one side's word.":
    "受け渡しには配達員と受取人の両方が署名します。片方の言い分だけにはなりません。",
  "The right parcel": "正しい荷物",
  "The tag on the parcel must be the one the sender signed. Any other tag fails the check.":
    "荷物のタグは、送り主が署名したものでなければなりません。ほかのタグでは確認が通りません。",
  "One permit, one handover": "1つの許可で1回の受け渡し",
  "A second handover with the same permit is refused by the record keeper that saw the first.":
    "同じ許可での2回目の受け渡しは、1回目を見た記録係が断ります。",
  "The sender signs the parcel's tag. The courier service gives a courier a one-time permit for this one parcel. At the door, the courier and the receiver both sign the handover.":
    "送り主が荷物のタグに署名します。配送サービスは配達員に、この荷物1つだけに使える1回限りの許可を出します。玄関先で、配達員と受取人の両方が受け渡しに署名します。",
  "The sender's key signed this parcel record, with this tag and this receiver.":
    "送り主の鍵が、このタグとこの受取人でこの荷物の記録に署名したこと。",
  "The tag on the parcel is the one the sender signed.": "荷物のタグが、送り主の署名したものであること。",
  "A courier the courier service gave a one-time permit to, and the receiver's key, both signed this handover.":
    "配送サービスが1回限りの許可を出した配達員と、受取人の鍵の両方が、この受け渡しに署名したこと。",
  "This permit was used once, here.": "この許可が、ここで1回使われたこと。",
  "Who the courier is: the page says only \"a verified courier\". The courier service knows which courier it gave the permit to.":
    "配達員が誰か。ページには「確認済みの配達員」としか出ません。どの配達員に許可を出したかは配送サービスが知っています。",
  "What is inside the parcel: the contents line is what the sender wrote.": "荷物の本当の中身。中身の欄は送り主が書いたものです。",
  "Who holds each key.": "それぞれの鍵を誰が持っているか。",
  "That nobody with a copy of the courier's key used the permit somewhere else: only this record keeper's list is checked.":
    "配達員の鍵のコピーを持つ誰かが、別の場所でこの許可を使っていないこと。確認するのはこの記録係のリストだけです。",

  // market
  Market: "マーケット",
  "A market where only buyers can review": "買った人だけがレビューできるマーケット",
  "A review counts only when it comes with a receipt the shop signed. One receipt carries one review.":
    "レビューが数えられるのは、お店が署名したレシートが付いているときだけです。レシート1枚にレビュー1件です。",
  "A shop with a signed listing, a signed receipt, a review with the receipt that is accepted, and a review without one that is refused.":
    "署名された出品のあるお店、署名されたレシート、レシート付きで受け付けられたレビュー、レシートがなく断られたレビュー。",
  "1 The shop signs its listing. 2 The shop signs a receipt naming the buyer's key. 3 A review with that receipt counts; one without a receipt does not.":
    "1 お店が出品に署名します。2 お店が、買い手の鍵を書いたレシートに署名します。3 そのレシート付きのレビューは数えられ、レシートのないレビューは数えられません。",
  "Reviews come with a receipt": "レビューにはレシートが付く",
  "A review without a receipt the shop signed does not count.": "お店が署名したレシートのないレビューは数えられません。",
  "One receipt, one review": "レシート1枚にレビュー1件",
  "The same receipt cannot carry a second review.": "同じレシートに2件目のレビューは付けられません。",
  "Listings stay as signed": "出品は署名されたまま",
  "The shop's key signed the listing. Any change after that fails the check.":
    "出品にはお店の鍵が署名しています。その後に変えると確認が通りません。",
  "The shop signs its listing. A review counts only if it comes with a receipt the shop signed, from the key that receipt names, one review per receipt.":
    "お店が出品に署名します。レビューが数えられるのは、お店が署名したレシートが付き、そのレシートに書かれた鍵で署名されたときだけで、レシート1枚につき1件です。",
  "The shop's key signed this listing, and it has not changed since.": "お店の鍵がこの出品に署名し、その後変わっていないこと。",
  "Each review shown cites a receipt this shop's key signed, and is signed by the key that receipt names.":
    "表示されたレビューはどれも、このお店の鍵が署名したレシートを示し、そのレシートに書かれた鍵で署名されていること。",
  "Each receipt carries one review at most.": "レシート1枚につきレビューは多くても1件であること。",
  "That the buyer settled up: that happens outside TET, and the receipt says only that the shop issued it.":
    "買い手が精算を済ませたこと。精算はTETの外で行われ、レシートが示すのはお店が発行したことだけです。",
  "That the shop did not give receipts to friends.": "お店が知り合いにレシートを配っていないこと。",
  "That a review is true, or who wrote it.": "レビューが本当かどうか、誰が書いたか。",

  // prototype
  "See the prototype": "試作品を見る",
  "/market is the prototype behind all three. The keys are samples made in your browser tab, and nothing is sent anywhere.":
    "/market が3つすべての試作品です。鍵はブラウザのタブの中で作ったサンプルで、どこにも何も送信されません。",
  "The /market page, Delivery tab, after a sample: the parcel tag, a verified courier, the receiver's key, and Settled: outside TET (cash, bank, …).":
    "/market のページ、配達タブでサンプルを試したあと。荷物のタグ、確認済みの配達員、受取人の鍵、そして「精算：TETの外で（現金、銀行振込など）」。",
  "The /market prototype, Delivery tab, with a sample. A screenshot of our own page, in English.":
    "/market の試作品、配達タブでサンプルを試したところ。私たち自身のページのスクリーンショット（英語）。",
};

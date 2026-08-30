# Accept: text/markdown — AIエージェントに Markdown を返す content negotiation

出典: https://acceptmarkdown.com/ （HN 175pt / 108コメント, 2026-08）

## 推薦理由

同じURLに対して、ブラウザにはHTML、AIエージェントには Markdown を返す。
Markdown 側では nav・スタイル・スクリプト・レイアウトのラッパーが落ちるため、
エージェントが本文だけを受け取れる。

`profile.md` の目的への接続:

- **既存資産**: `Hirake`（Markdownビューア）と `llm-wiki`（Markdown知識ベース）の両方に直結する。
  どちらも「Markdown を配る」側なので、この仕様を実装する動機が自分の中にある
- **一次ターゲット（技術コミュニティ）**: 日本語での紹介がほぼ無い。
  さらに**公式サイトのレシピは Nginx / Laravel / Rails のみで、Node/Express が空白**。
  書けば一次情報になる
- **3〜4時間の制約**: 仕様がルール4つに閉じており、外部ツールのインストールも
  クラウドアカウントも測定設計も要らない。1件目として最も確実に完走できる

## 成功条件

`accept-markdown/` に Express サーバがあり、`npm start` で起動する。
同一URL `/docs/hello` に対して、以下の4つがすべて仕様通りに動く。

| リクエスト | 期待 |
|---|---|
| `curl -H "Accept: text/markdown"` | `200` + `Content-Type: text/markdown; charset=utf-8` + Markdown本文 |
| ブラウザ相当（`Accept: text/html,...,*/*;q=0.8`） | `200` + HTML |
| `curl -H "Accept: application/pdf"` | `406` |
| 上記いずれの成功レスポンスにも | `Vary: Accept` が付く |

`accept-markdown/README.md` に上記4つの curl コマンドと期待される出力を記載すること。
**これが「動く最小リポジトリ」の実体であり、第三者が検証できる形。**

## 学習手順

1. **仕様の確認（15分）**
   acceptmarkdown.com のルール4つを読む。あわせて RFC 9110 の `Accept` ヘッダ（q値・ワイルドカード）と
   RFC 7763（`text/markdown` メディアタイプ）の該当箇所だけ確認する。全文は読まない。

2. **最小サーバ（30分）**
   Express で `/docs/:slug`。Markdown ファイルを1つ `content/hello.md` に置くだけでよい。

3. **content negotiation（45分）**
   `Accept` を見て Markdown / HTML を出し分ける。HTML 変換は `marked` で足りる。

4. **`Vary` と 406（15分）**
   成功レスポンスに `Vary: Accept` を付ける。どちらにも該当しない場合は 406 を返す。

5. **検証（30分）**
   curl 4パターンを実行し、結果を `accept-markdown/README.md` に貼る。

6. **記事下書き（45分）**
   `手元のメモ` の記録をもとに `article.md` を書く。
   公式にない Node/Express のレシピであることを前面に出す。

合計 **3時間**。

## 詰まったら

- **`Accept` のパースを自前で書くと必ず詰まる。**
  ブラウザは `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8` を送ってくる。
  `*/*` が含まれるため、素朴な「`text/markdown` が含まれるか」判定ではブラウザにも Markdown を返してしまう。
  q値の比較が必須。
  **まず `req.accepts(['text/markdown', 'text/html'])` で動かすこと**（Express が内部で negotiator を使う）。
  自前実装に置き換えるのは、動いた後でよい。

- **`Vary: Accept` を忘れると、原因の分かりにくい壊れ方をする。**
  CDN やブラウザが片方のレスポンスをキャッシュし、もう片方のリクエストにも同じものを返す。
  ローカルでは再現しにくいので、忘れないうちに入れる。

- **406 を返す条件を広げすぎない。**
  `*/*` を送ってきたクライアントに 406 を返すと、普通のブラウザが壊れる。
  406 は「どの候補にも一致しない」ときだけ。

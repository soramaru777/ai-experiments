# accept-markdown demo

`Accept` ヘッダによる content negotiation の最小実装。
同じURLに対して、ブラウザには HTML、AIエージェントには Markdown を返す。

コマンドは **PowerShell 7** 用。

## PowerShell 7 での注意

- 環境変数は `$env:NAME = 'value'`。`NAME=value cmd` という前置き構文は**使えない**
- `Invoke-WebRequest` は 4xx/5xx で例外を投げる。406 を見たいので **`-SkipHttpErrorCheck` が必須**（PS 7.0+）
- `curl` は PowerShell 7 では **curl.exe**（Windows 10 以降に同梱）。
  PowerShell 5.1 の `curl` エイリアス（`Invoke-WebRequest`）とは別物なので、記事に書くときは区別すること

## 起動

```powershell
npm install
npm start
# listening on http://localhost:3000/docs/hello
```

検証用のヘルパーを読み込んでおくと楽。

```powershell
function Show-Rep {
    param([string] $Accept, [int] $Port = 3000)
    $r = Invoke-WebRequest "http://localhost:$Port/docs/hello" `
        -Headers @{ Accept = $Accept } -SkipHttpErrorCheck
    '{0}  {1}  Vary={2}  cache={3}' -f $r.StatusCode,
        (($r.Headers['Content-Type'] -join ',') -split ';')[0],
        ($r.Headers['Vary'] -join ','),
        ($r.Headers['x-cache'] -join ',')
}
```

## 検証（4パターン + 404）

### 1. 明示的に Markdown を要求

```powershell
Show-Rep 'text/markdown'
# 200  text/markdown  Vary=Accept  cache=
```

本文を見るなら:

```powershell
(Invoke-WebRequest http://localhost:3000/docs/hello -Headers @{ Accept = 'text/markdown' }).Content
```

### 2. ブラウザ相当

```powershell
Show-Rep 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
# 200  text/html  Vary=Accept  cache=
```

ナビとフッターと `<script>` が付く。Markdown 側にはこれらが無い。

### 3. どちらでもない形式 → 406

```powershell
Show-Rep 'application/pdf'
# 406  text/plain  Vary=Accept  cache=
```

`-SkipHttpErrorCheck` を外すと、ここで例外になって確認できない。

### 4. ワイルドカード → HTML（Markdown ではない）

```powershell
Show-Rep '*/*'
# 200  text/html  Vary=Accept  cache=
```

**ここが実装の勘所。** `curl.exe` は既定で `Accept: */*` を送る。多くのボットも同様。
`server.js` の

```js
const best = req.accepts(['text/html', 'text/markdown']);
```

の**配列順は、クライアントが具体型を1つも挙げていないときだけ効く**。

優先順位は次の通り。

1. q値が最優先
2. 同点ならクライアントの `Accept` 内の記載順（サーバの配列順ではない）
3. サーバの配列順が効くのは `*/*` や `text/*` のようなワイルドカードのみのとき

`text/html` を先に置いているため `*/*` には HTML が返る。
順序を入れ替えると `*/*` にも Markdown が返り、
「明示的に要求したエージェントにだけ Markdown を返す」という意図から外れる。
**ブラウザは `text/html` を q=1 で明示的に送るので、順序をどう変えても影響を受けない。**

### 5. 存在しないドキュメント

```powershell
(Invoke-WebRequest http://localhost:3000/docs/nope -SkipHttpErrorCheck).StatusCode
# 404
```

## 壊して直す

理解はここで進む。1つずつ試して、`手元のメモ` に結果を書くこと。

### 演習1: 配列の順序を入れ替える

`server.js` の `req.accepts(['text/html', 'text/markdown'])` を
`['text/markdown', 'text/html']` にして、以下を全部叩く。

```powershell
Show-Rep '*/*'
Show-Rep 'text/*'
Show-Rep 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
Show-Rep 'text/html;q=0.8,text/markdown;q=0.8'
Show-Rep 'text/markdown;q=0.8,text/html;q=0.8'
```

- 何が変わり、何が変わらないか
- ブラウザ相当（3行目）は壊れるか。なぜか
- 同点（4・5行目）のとき、勝つのはサーバの配列順か、クライアントの記載順か

### 演習2: `Vary: Accept` を消す

`NO_VARY=1` で起動すると `Vary` が落ちる（ソースを編集しなくてよい）。

**一括で実演する:**

```powershell
./demo-vary.ps1
```

Vary あり／なしの両方を起動し、「ブラウザが先 → 次にエージェント」を再現して並べる。
②が `text/html` なら再現成功。

**手で追う場合:**

```powershell
# Vary なしのサーバとキャッシュを起動
$env:NO_VARY = '1'; $env:PORT = '3100'
$srv = Start-Process node -ArgumentList 'server.js' -PassThru -NoNewWindow

$env:PORT = '3101'; $env:UPSTREAM = 'http://localhost:3100'
$prx = Start-Process node -ArgumentList 'cache-proxy.js' -PassThru -NoNewWindow

# 前提の確認を先にやる（上流に Vary が無いこと）
Show-Rep 'text/markdown' -Port 3100

# ① ブラウザ相当が先にアクセスしてキャッシュを埋める
Show-Rep 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' -Port 3101

# ② 次にエージェントがアクセスする
Show-Rep 'text/markdown' -Port 3101
# 200  text/html  Vary=  cache=HIT   <- Markdown を要求したのに HTML が返る

Stop-Process -Id $srv.Id, $prx.Id -Force
Remove-Item Env:NO_VARY, Env:PORT, Env:UPSTREAM
```

> **前提の確認を飛ばさないこと。** ポートを前のプロセスに掴まれていると、
> 意図した設定のサーバが起動できず（EADDRINUSE）、古いサーバが応答して
> 誤った結論に至る。実際にそれで「Vary あり／なしで結果が同じ」という
> 誤った観察をした。実験ごとにポートを変えるのが安全。

### 演習3: 406 の条件を広げる

`req.accepts([...])` を使わず、
「`Accept` に `text/markdown` か `text/html` の文字列が含まれなければ 406」
という素朴な判定に置き換える。

```powershell
Show-Rep '*/*'          # curl.exe や多くのボットの既定
Show-Rep 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
```

- 演習1で `*/*` の重要性が分かっているので、**先に予想を立ててから実行する**
- 予想と違ったら、その差分を `手元のメモ` に書く（そこが記事の材料になる）

## 補足: cache-proxy.js

演習2のための最小の共有キャッシュ。標準的なキャッシュの規則を実装している。

- エントリは URL で引く
- レスポンスの `Vary` に挙がったリクエストヘッダも一致条件に加える
- **`Vary` が無いエントリは、どんなリクエストにも一致する**（これが事故の正体）

```js
return entry.varyNames.every((n) => (reqHeaders[n] ?? '') === entry.varyValues[n]);
// varyNames が空配列だと every() は true を返す
```

## 参考

- https://acceptmarkdown.com/
- RFC 9110 §12.5.1 — `Accept` ヘッダと q値
- RFC 7763 — `text/markdown` メディアタイプ

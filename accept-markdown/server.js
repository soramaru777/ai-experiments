import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { marked } from 'marked';

const app = express();
const PORT = process.env.PORT ?? 3000;

app.get('/docs/:slug', async (req, res) => {
  // 返す表現が Accept に依存することを、分岐する前に必ず宣言しておく。
  // これを忘れると CDN やブラウザが片方のレスポンスをキャッシュし、
  // もう片方のリクエストにも同じものを返す。ローカルでは再現しにくい壊れ方をする。
  // NO_VARY=1 を付けて起動すると Vary を落とす（演習2用）。既定では必ず付ける。
  if (process.env.NO_VARY !== '1') res.set('Vary', 'Accept');

  let markdown;
  try {
    markdown = await readFile(path.join('content', `${req.params.slug}.md`), 'utf8');
  } catch {
    return res.status(404).type('text/plain; charset=utf-8').send('Not Found\n');
  }

  // ★ 並び順が挙動を決める ★
  // text/html を先に置くと、Accept: */* を送るクライアント（curl の既定値、多くのボット）には
  // HTML が返る。text/markdown を先にすると */* にも Markdown を返してしまい、
  // 「明示的に要求したエージェントにだけ Markdown を返す」という意図から外れる。
  const best = req.accepts(['text/html', 'text/markdown']);

  if (best === 'text/markdown') {
    return res.type('text/markdown; charset=utf-8').send(markdown);
  }
  if (best === 'text/html') {
    return res.type('text/html; charset=utf-8').send(renderHtml(req.params.slug, markdown));
  }

  // どの候補にも一致しないときだけ 406。
  // */* に対して 406 を返すと普通のブラウザが壊れるので、条件を広げないこと。
  return res
    .status(406)
    .type('text/plain; charset=utf-8')
    .send('Not Acceptable: this resource is available as text/html or text/markdown\n');
});

app.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}/docs/hello`);
});

/** HTML 側にだけナビ・スタイル・フッターを付ける。
 *  Markdown 側で「何が落ちるのか」を目で見て分かるようにするため。 */
function renderHtml(slug, markdown) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${slug}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
  nav, footer { color: #888; font-size: .875rem; }
  nav { border-bottom: 1px solid #ddd; padding-bottom: .5rem; }
  footer { border-top: 1px solid #ddd; margin-top: 2rem; padding-top: .5rem; }
</style>
</head>
<body>
<nav>ホーム / ドキュメント / ${slug} &nbsp;— この行は Markdown 側には現れない</nav>
${marked.parse(markdown)}
<footer>&copy; 2026 accept-markdown demo — このフッターも Markdown 側には現れない</footer>
<script>console.log('この script も Markdown 側には現れない');</script>
</body>
</html>
`;
}

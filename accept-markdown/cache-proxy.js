// 素朴な共有キャッシュ（CDN のふるまいを最小限に再現したもの）。
//
// HTTP キャッシュは URL でエントリを引く。同じ URL で表現が変わりうる場合、
// サーバは Vary で「どのリクエストヘッダが表現を左右するか」を宣言しなければならない。
// Vary が無いエントリは「どのリクエストにも一致する」と扱われる — これが事故の正体。
//
//   node cache-proxy.js        # localhost:3001 -> localhost:3000
import http from 'node:http';

const UPSTREAM = process.env.UPSTREAM ?? 'http://localhost:3000';
const PORT = Number(process.env.PORT ?? 3001);

/** url -> エントリの配列 */
const cache = new Map();

http
  .createServer(async (req, res) => {
    const entries = cache.get(req.url) ?? [];
    const hit = entries.find((e) => matches(e, req.headers));

    if (hit) {
      res.writeHead(hit.status, { ...hit.headers, 'x-cache': 'HIT' });
      return res.end(hit.body);
    }

    const upstream = await fetch(UPSTREAM + req.url, {
      headers: { accept: req.headers.accept ?? '*/*' },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = Object.fromEntries(upstream.headers);
    delete headers['content-length'];
    delete headers['content-encoding'];

    const varyNames = (upstream.headers.get('vary') ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    entries.push({
      status: upstream.status,
      headers,
      body,
      varyNames,
      varyValues: Object.fromEntries(varyNames.map((n) => [n, req.headers[n] ?? ''])),
    });
    cache.set(req.url, entries);

    res.writeHead(upstream.status, { ...headers, 'x-cache': 'MISS' });
    res.end(body);
  })
  .listen(PORT, () => console.log(`cache proxy on http://localhost:${PORT} -> ${UPSTREAM}`));

/** varyNames が空の配列だと every() は true を返す。
 *  = Vary が無いエントリは、どんなリクエストにも一致してしまう。 */
function matches(entry, reqHeaders) {
  return entry.varyNames.every((n) => (reqHeaders[n] ?? '') === entry.varyValues[n]);
}

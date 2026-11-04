// 把 vite build 的結果合併成單一 HTML（CSS、JS 全部內嵌），方便在沒有伺服器的地方預覽或分享。
// 用法：npm run build:single → dist-single/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g, (m, file) =>
  `<style>\n${readFileSync(join(dist, file), 'utf8')}\n</style>`);

html = html.replace(/<script type="module"[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/g, (m, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

html = html.replace(/<link rel="(icon|manifest|apple-touch-icon)"[^>]*>\n?/g, '');

if (/src="\.?\/?assets\//.test(html) || /href="\.?\/?assets\//.test(html)) throw new Error('仍有未內嵌的資源');
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/index.html', html);
console.log(`dist-single/index.html  ${(html.length / 1024).toFixed(0)} KB`);

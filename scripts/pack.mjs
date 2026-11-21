// 打包：只把运行时文件拷进 dist/，不引入任何构建依赖。
// 规则（平台硬校验）：
//  - zip 根必须是 index.html
//  - <head> 必须引用 builda-sdk.js，但 SDK 文件本身不能进包
//  - 不能有 node_modules / .map / .env / 反斜杠路径
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ZIP = join(ROOT, 'builda-web.zip');

function copyDir(src, dst, filter) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, {
    recursive: true,
    filter: (s) => {
      const rel = s.slice(src.length + 1);
      if (!rel) return true;
      if (rel.endsWith('.md')) return false;
      return filter ? filter(rel) : true;
    }
  });
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

cpSync(join(ROOT, 'index.html'), join(DIST, 'index.html'));
cpSync(join(ROOT, 'mobile-perf.js'), join(DIST, 'mobile-perf.js'));
copyDir(join(ROOT, 'css'), join(DIST, 'css'));
copyDir(join(ROOT, 'js'), join(DIST, 'js'));
mkdirSync(join(DIST, 'vendor'), { recursive: true });
for (const f of ['three.module.js', 'GLTFLoader.js', 'THREE-LICENSE.txt']) {
  cpSync(join(ROOT, 'vendor', f), join(DIST, 'vendor', f));
}
copyDir(join(ROOT, 'vendor', 'utils'), join(DIST, 'vendor', 'utils'));
copyDir(join(ROOT, 'assets'), join(DIST, 'assets'));

// ---- 自检 ----
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!html.includes('src="builda-sdk.js"')) throw new Error('index.html 缺少 builda-sdk.js 引用');
if (existsSync(join(DIST, 'builda-sdk.js'))) throw new Error('builda-sdk.js 不能打进包');

const files = walk(DIST);
const bad = files.filter((f) => /(^|\/)(node_modules|\.git|src)(\/|$)/.test(f) || /\.(map|env|br|gz)$/.test(f));
if (bad.length) throw new Error('包内出现禁用文件：\n' + bad.join('\n'));

for (const f of files) {
  if (!f.startsWith(DIST)) continue;
}

// ---- 打 zip ----
if (existsSync(ZIP)) rmSync(ZIP);
let zipped = false;
try {
  execFileSync('zip', ['-r', '-q', ZIP, '.'], { cwd: DIST, stdio: 'inherit' });
  zipped = true;
} catch (e) {
  console.warn('[pack] 未找到 zip 命令，跳过自动压缩。Windows 请用：.builda-agent\\builda.cmd bundle-pack dist builda-web.zip');
}

const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
console.log('[pack] dist files =', files.length, ' raw =', (bytes / 1024 / 1024).toFixed(2), 'MB');
if (zipped) {
  const z = statSync(ZIP).size;
  console.log('[pack] zip = builda-web.zip ', (z / 1024 / 1024).toFixed(2), 'MB');
  console.log('[pack] 下一步：./.builda-agent/builda bundle-check --engine h5 builda-web.zip');
}

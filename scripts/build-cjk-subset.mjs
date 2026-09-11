/**
 * Rebuilds public/fonts/vt-cjk.woff2 — a Noto Sans JP subset containing exactly
 * the CJK glyphs used by the HUD (currently 26). Shipping this is deliberate:
 * many systems have no CJK font at all and would render the glyphs as tofu.
 *
 * Requires python3 with fonttools + brotli, and network access to npm.
 * The output is committed, so this only needs re-running when glyphs change.
 *
 *   node scripts/build-cjk-subset.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = ['src', 'index.html'];
const CJK = /[\u3000-\u30ff\u4e00-\u9fff]/gu;

function walk(p) {
  const out = [];
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name);
    if (e.isDirectory()) out.push(...walk(f));
    else if (/\.(ts|tsx|html)$/.test(e.name)) out.push(f);
  }
  return out;
}

const files = SRC.flatMap((p) => (p.endsWith('.html') ? [p] : walk(p)));
const glyphs = [...new Set(files.flatMap((f) => readFileSync(f, 'utf8').match(CJK) ?? []))].sort();
console.log(`[cjk] ${glyphs.length} glyphs: ${glyphs.join('')}`);

const tmp = mkdtempSync(join(tmpdir(), 'vt-cjk-'));
execFileSync('npm', ['pack', '@fontsource/noto-sans-jp'], { cwd: tmp, stdio: 'inherit' });
const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
execFileSync('tar', ['xzf', tgz, '-C', tmp], { cwd: tmp });

writeFileSync(join(tmp, 'glyphs.txt'), glyphs.join(''));
writeFileSync(join(tmp, 'sub.py'), `
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
from fontTools.subset import Subsetter, Options
import glob, os, sys, tempfile
tmp = sys.argv[1]
need = set(open(os.path.join(tmp,'glyphs.txt'), encoding='utf-8').read())
cov = {}
for f in sorted(glob.glob(os.path.join(tmp,'package/files/noto-sans-jp-*-400-normal.woff2'))):
    try: t = TTFont(f)
    except: continue
    cm = set()
    for tb in t['cmap'].tables: cm |= {chr(c) for c in tb.cmap}
    h = need & cm
    if h: cov[f] = h
    t.close()
chosen, rem = [], set(need)
while rem:
    best = max(cov, key=lambda f: len(cov[f] & rem))
    chosen.append(best); rem -= cov[best]
work = tempfile.mkdtemp(); parts = []; acc = set()
for i, f in enumerate(chosen):
    want = (cov[f] & need) - acc
    if not want: continue
    acc |= want
    t = TTFont(f)
    o = Options(); o.layout_features = []; o.notdef_outline = True
    s = Subsetter(options=o); s.populate(text=''.join(want)); s.subset(t)
    p = os.path.join(work, 'p%d.ttf' % i); t.flavor = None; t.save(p); parts.append(p); t.close()
out = Merger().merge(parts) if len(parts) > 1 else TTFont(parts[0])
o = Options(); o.layout_features = []; o.notdef_outline = True
s = Subsetter(options=o); s.populate(text=''.join(need)); s.subset(out)
out.flavor = 'woff2'
os.makedirs('public/fonts', exist_ok=True)
out.save('public/fonts/vt-cjk.woff2')
chk = TTFont('public/fonts/vt-cjk.woff2'); cm = set()
for tb in chk['cmap'].tables: cm |= {chr(c) for c in tb.cmap}
assert not (need - cm), 'missing glyphs: %r' % (need - cm)
print('[cjk] wrote public/fonts/vt-cjk.woff2', os.path.getsize('public/fonts/vt-cjk.woff2'), 'bytes')
`);
execFileSync('python3', [join(tmp, 'sub.py'), tmp], { stdio: 'inherit' });

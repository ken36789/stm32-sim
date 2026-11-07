// 程式解說：在網站裡顯示 docs/ 的兩份說明（範例程式解說、原始碼導讀），內容和 GitHub 上的 .md 檔是同一份
import { marked } from 'marked';
import codeMd from '../../docs/程式解說.md?raw';
import devMd from '../../docs/原始碼導讀.md?raw';
import { $, esc } from './dom.js';
import { bench } from '../core/sim.js';
import { SDK_NAMES } from '../core/sdk.js';

const REPO = 'https://github.com/ken36789/stm32-sim/blob/main/';
const DOCS = {
  code:{ md:codeMd, file:'docs/程式解說.md', title:'範例程式解說' },
  dev: { md:devMd,  file:'docs/原始碼導讀.md', title:'原始碼導讀' },
};
const FILE_TO_DOC = { '程式解說.md':'code', '原始碼導讀.md':'dev' };
let cur = 'code', env = { track(){} };
const cache = {};

/** 和 GitHub 一樣的標題錨點：小寫、去掉標點、空白換成 - */
const slug = s => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

function render(key){
  const d = DOCS[key], body = $('#gdBody');
  cur = key;
  body.innerHTML = cache[key] ||= marked.parse(d.md, { gfm:true });
  const used = new Map();
  body.querySelectorAll('h1,h2,h3,h4').forEach(h => {
    let id = slug(h.textContent); const n = used.get(id) || 0; used.set(id, n + 1); if (n) id += '-' + n; h.id = id;
  });
  body.querySelectorAll('table').forEach(t => { const w = document.createElement('div'); w.className = 'md-table'; t.replaceWith(w); w.append(t); });
  body.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return;
    const file = decodeURIComponent(href.split('#')[0].split('/').pop());
    if (FILE_TO_DOC[file] && !/^https?:/.test(href)){ a.dataset.doc = FILE_TO_DOC[file]; a.dataset.hash = href.split('#')[1] || ''; return; }
    if (!/^[a-z]+:/i.test(href)) a.href = new URL(href, REPO + 'docs/').href;
    a.target = '_blank'; a.rel = 'noopener';
  });
  $('#gdToc').innerHTML = `<option value="">跳到章節…</option>` + [...body.querySelectorAll('h2')].map(h => `<option value="${esc(h.id)}">${esc(h.textContent)}</option>`).join('');
  $('#gdGit').href = REPO + d.file;
  document.querySelectorAll('#gd [data-doc][role="tab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.doc === key)));
  $('#gdScroll').scrollTop = 0;
  const b = bench.board;
  $('#gdSub').textContent = key === 'code' ? `目前：${b.name} · ${SDK_NAMES[b.sdk] || b.sdk}` : '給想修改或擴充這個網站的人';
  $('#gdNow').hidden = key !== 'code';
  $('#gdNow').innerHTML = `你現在用的是 <b>${esc(b.name)}</b>，程式寫法是 <b>${esc(SDK_NAMES[b.sdk] || b.sdk)}</b>。在「程式」分頁按「載入範例程式」產生的程式，就是這份說明在講的內容；換開發板或模組後，範例程式也會跟著變。`;
}

function jump(id){
  const el = id && document.getElementById(decodeURIComponent(id));
  if (el) el.scrollIntoView({ block:'start' });
}

export function openGuide(key = cur, hash = ''){
  $('#gd').hidden = false; document.body.classList.add('la-open');
  render(key); if (hash) jump(hash);
  env.track('guide-' + key);
}
function closeGuide(){ $('#gd').hidden = true; document.body.classList.remove('la-open'); }

export function initGuide(e = {}){
  env = { ...env, ...e };
  $('#btnGuide').addEventListener('click', () => openGuide());
  $('#gdClose').addEventListener('click', closeGuide);
  document.querySelectorAll('#gd [data-doc][role="tab"]').forEach(b => b.addEventListener('click', () => render(b.dataset.doc)));
  $('#gdToc').addEventListener('change', ev => { jump(ev.target.value); ev.target.value = ''; });
  $('#gdBody').addEventListener('click', ev => {
    const a = ev.target.closest('a'); if (!a) return;
    if (a.dataset.doc){ ev.preventDefault(); render(a.dataset.doc); jump(a.dataset.hash); return; }
    const h = a.getAttribute('href'); if (h?.startsWith('#')){ ev.preventDefault(); jump(h.slice(1)); }
  });
  document.addEventListener('keydown', ev => { if (!$('#gd').hidden && ev.key === 'Escape') closeGuide(); });
}

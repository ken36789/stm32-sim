export const $ = (s, el = document) => el.querySelector(s);
export let toastTimer;
export function toast(msg, kind){ const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (kind === 'err' ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = 'toast', kind === 'err' ? 4200 : 2600); }
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

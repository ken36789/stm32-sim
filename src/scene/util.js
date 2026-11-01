// 3D 與介面共用的小工具
export const WIRE_COLORS = { red:0xd5392e, black:0x2a2a2a, yellow:0xf0c419, blue:0x2f6cd6, green:0x2f9d55, orange:0xef7d1a, white:0xe6e6e6, purple:0x8b50d2 };
export const COLOR_NAMES = { red:'紅', black:'黑', yellow:'黃', blue:'藍', green:'綠', orange:'橙', white:'白', purple:'紫' };
export const hex6 = n => '#' + n.toString(16).padStart(6, '0');
export function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

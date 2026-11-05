// 這塊開發板能不能用某種外接模組。晶片沒有對應的周邊（SPI、CAN、STEP 計時器輸出）時，
// 介面把模組變成灰色、說明原因，並列出有這個功能、而且和目前板子最接近的開發板。
import { MODULE_TYPES } from './parts.js';
import { BOARDS } from './boards.js';
import { bench } from './sim.js';

export const FEATURES = {
  spi: { lack:'沒有 SPI', why:b => b.noSpi || `${b.mcu} 沒有可以用的 SPI。` },
  can: { lack:'沒有 CAN', why:b => b.noCan || `${b.mcu} 沒有 CAN 控制器。` },
  step:{ lack:'沒有 STEP 輸出', why:b => b.noStep || `${b.name} 沒有兩組可以用的計時器 PWM 輸出。` },
};
const NEEDS = { tc:'spi', flash:'spi', la_spi:'spi', can:'can', la_can:'can', stepper:'step' };
const TIPS = { stepper:'也可以改用「TB67S128FTG 步進馬達驅動板」＋「步進馬達」：CLK 接一般 GPIO 也能轉，只是比較慢。' };

/** 模組需要的周邊（不需要時是 null） */
export const needOf = type => NEEDS[type] || null;

/** 有這個周邊、而且和 b 最接近的開發板：同廠牌優先，再來同系列、同板型 */
export function altBoards(feat, b, n = 2){
  const score = x => (x.vendor !== b.vendor) * 4 + (x.series !== b.series) * 2 + (x.form !== b.form);
  return BOARDS.map((x, i) => [x, i]).filter(([x]) => x[feat] && x.id !== b.id)
    .sort((p, q) => score(p[0]) - score(q[0]) || p[1] - q[1]).slice(0, n).map(([x]) => x);
}

/**
 * { ok:true } 或 { ok:true, note }（可以用但有限制）
 * 或 { ok:false, feat, lack, why, tip, alt:[開發板] }（這塊板子不能用）
 */
export function moduleSupport(type, b = bench.board){
  const f = NEEDS[type];
  if (f && !b[f]){ const F = FEATURES[f]; return { ok:false, feat:f, lack:F.lack, why:F.why(b), tip:TIPS[type] || '', alt:altBoards(f, b) }; }
  if (type === 'tb67' && !b.step) return { ok:true, note:`${FEATURES.step.why(b)}CLK 改接一般 GPIO，用程式一步一步送，最快約幾百 pps。` };
  return { ok:true };
}

/** 工作台上這塊板子不能用的模組 */
export const unsupportedModules = (b = bench.board) => bench.modules.filter(m => !moduleSupport(m.type, b).ok);

/** 一句話說明（給提示訊息和檢測結果用） */
export function supportText(type, b = bench.board){
  const s = moduleSupport(type, b); if (s.ok) return s.note || '';
  return [s.why, s.tip, s.alt.length ? `可以改用 ${s.alt.map(x => x.name).join(' 或 ')}。` : ''].filter(Boolean).join('');
}
export const typeName = type => MODULE_TYPES[type].name;

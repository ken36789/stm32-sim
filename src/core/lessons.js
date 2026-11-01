// 邏輯分析儀的解說與教學：點波形上的一段，說明它是什麼、為什麼長這樣；每種協定一套分步教學。
import { bench, moduleById, moduleLabel, netInfo } from './sim.js';
import { MODULE_TYPES, variantOf } from './parts.js';
import { SPI_TYPES } from './buses.js';
import { hex2 } from './protocols.js';

const bin = (v, n = 8) => v.toString(2).padStart(n, '0');
const us = t => t >= 1000 ? `${(t / 1000).toFixed(3)} ms` : `${t.toFixed(2)} µs`;
const ascii = v => v >= 32 && v < 127 ? `「${String.fromCharCode(v)}」` : v === 13 ? '\\r（回車 CR）' : v === 10 ? '\\n（換行 LF）' : '';

/* ---------- 元件資料：暫存器與指令名稱 ---------- */
const I2C_REG = {
  bmx280:{ 0xD0:'chip_id（晶片 ID 暫存器）', 0xF4:'ctrl_meas（量測模式設定）', 0xF5:'config（濾波與待機時間）', 0x88:'calib00（校正值的開頭）', 0xFA:'temp_msb（溫度資料的開頭）', 0xF7:'press_msb（氣壓資料）' },
  lm75:{ 0x00:'溫度暫存器', 0x01:'設定暫存器' }, tmp102:{ 0x00:'溫度暫存器', 0x01:'設定暫存器' },
  mcp9808:{ 0x05:'環境溫度暫存器（T_A）', 0x06:'製造商 ID 暫存器', 0x07:'裝置 ID 暫存器' },
  hdc1080:{ 0x00:'溫度暫存器（寫入後開始轉換）', 0x01:'溼度暫存器', 0xFF:'裝置 ID 暫存器', 0xFE:'製造商 ID 暫存器' },
  aht20:{ 0xAC:'觸發量測指令', 0xBE:'初始化（校正）指令', 0x71:'讀狀態' },
  sht3x:{ 0x24:'單次量測指令的高位元組（0x2400：高重複性）', 0xF3:'讀狀態暫存器指令的高位元組（0xF32D）' },
};
const FLASH_CMD = { 0x9F:'讀 JEDEC ID', 0x05:'讀狀態暫存器 1', 0x06:'允許寫入（Write Enable）', 0x04:'禁止寫入', 0x03:'讀取資料', 0x0B:'快速讀取', 0x02:'頁寫入（Page Program）', 0x20:'抹除 4 KB 磁區', 0xD8:'抹除 64 KB 區塊', 0xC7:'整顆抹除', 0xAB:'讀裝置 ID', 0x90:'讀製造商／裝置 ID' };
function i2cDevice(addr){
  const m = bench.modules.find(x => x.type === 'temp' && variantOf(x.type, x.variant).addr === addr);
  return m ? { m, v:variantOf(m.type, m.variant), name:`${moduleLabel(m)}（${variantOf(m.type, m.variant).part}）` } : null;
}
/** SPI 分析儀 CS 探棒接的是哪個元件 */
function spiDevice(laId){
  const la = moduleById(laId); if (!la) return null;
  const g = netInfo(`${la.id}.CS`).gpio[0]; if (!g) return null;
  const m = bench.modules.find(x => SPI_TYPES.includes(x.type) && netInfo(`${x.id}.CS`).gpio.includes(g));
  return m ? { m, v:variantOf(m.type, m.variant), name:`${moduleLabel(m)}（${variantOf(m.type, m.variant).part}）` } : null;
}
/** 說明一次 SPI 傳輸（依元件解讀指令與回應） */
function spiMeaning(dev, mo, mi){
  if (!dev) return [];
  const v = dev.v;
  if (v.dev === 'w25q'){
    const c = mo[0], name = FLASH_CMD[c];
    if (!name) return [`第一個位元組 0x${hex2(c)} 是 ${v.part} 的指令碼，但不是範例程式用到的指令。`];
    const out = [`第一個位元組 0x${hex2(c)} 是指令：${name}。`];
    if (c === 0x9F && mi.length >= 4) out.push(`後面 3 個位元組是 Flash 回傳的 JEDEC ID：${hex2(mi[1])}＝製造商 Winbond、${hex2(mi[2])}＝SPI NOR Flash、${hex2(mi[3])}＝容量代碼（0x16＝32 Mbit、0x18＝128 Mbit）。主機在這段時間送 0x00 只是為了產生時脈。`);
    if (c === 0x05 && mi.length >= 2) out.push(`回傳的狀態暫存器是 0x${hex2(mi[1])}＝${bin(mi[1])}：BUSY（bit 0）＝${mi[1] & 1}、WEL（bit 1）＝${(mi[1] >> 1) & 1}。${mi[1] & 1 ? 'BUSY＝1 表示還在抹除或寫入，程式會等一下再問一次。' : 'BUSY＝0 表示已經完成。'}`);
    if (c === 0x06) out.push('寫入或抹除之前一定要先送這個指令，把 WEL 設成 1；完成後晶片會自動清掉 WEL。CS 拉高的那一刻指令才生效。');
    if (c === 0x20) out.push(`後面 3 個位元組是位址 0x${mo.slice(1, 4).map(hex2).join('')}。抹除會把整個 4 KB 磁區變成 0xFF，大約要 45 ms（看下一筆傳輸之前的空白），這段時間狀態暫存器的 BUSY＝1。`);
    if (c === 0x02) out.push(`位址 0x${mo.slice(1, 4).map(hex2).join('')}，接著是要寫入的資料：${mo.slice(4).map(hex2).join(' ')}（${mo.slice(4).map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '.').join('')}）。Flash 只能把 1 寫成 0，所以要先抹除。`);
    if (c === 0x03) out.push(`位址 0x${mo.slice(1, 4).map(hex2).join('')}，從第 5 個位元組開始 MISO 回傳資料：${mi.slice(4).map(hex2).join(' ')}（${mi.slice(4).map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '.').join('')}）。`);
    return out;
  }
  if (v.dev === 'max6675' && mi.length >= 2){
    const w = (mi[0] << 8) | mi[1];
    return [`MAX6675 一次送出 16 位元：0x${hex2(mi[0])}${hex2(mi[1])}＝${bin(w, 16)}。`, w & 4 ? 'D2＝1：熱電偶沒有接（斷線），溫度資料無效。' : `D14..D3＝${(w >> 3) & 0xFFF}，乘以 0.25 °C＝${((w >> 3) * .25).toFixed(2)} °C。D2＝0 表示熱電偶有接好。`, 'MAX6675 沒有 MOSI 腳，主機送的 0x00 只是為了產生時脈。'];
  }
  if (v.dev === 'max31855' && mi.length >= 4){
    const w = ((mi[0] << 24) | (mi[1] << 16) | (mi[2] << 8) | mi[3]) | 0;
    return [`MAX31855 一次送出 32 位元：${mi.map(hex2).join(' ')}。`, w & 0x10000 ? 'D16＝1：故障（熱電偶斷線或短路）。' : `D31..D18 是熱電偶溫度（有號數）＝${w >> 18}，乘以 0.25 °C＝${((w >> 18) * .25).toFixed(2)} °C。`, `D15..D4 是冷接點（晶片本身）溫度，約 ${(((w & 0xFFF0) << 16 >> 20) * .0625).toFixed(2)} °C。`];
  }
  return [];
}

/* ---------- 點選波形後的說明 ---------- */
export function explain(proto, a, ctx){
  const d = a.d || {}, dur = a.t1 - a.t0, facts = [['開始', us(a.t0 - ctx.t0)], ['長度', us(dur)]];
  const R = (title, why, lesson, extra = []) => ({ title, why:why.filter(Boolean), facts:[...extra, ...facts], lesson });
  if (proto === 'i2c'){
    const dev = d.addr !== undefined ? i2cDevice(d.addr) : null;
    switch (a.kind){
      case 'start': return R('起始條件 START', ['SCL 維持高電位時，SDA 由高變低——這是 I2C 規定的「開始」訊號，只有主機（MCU）能送出。', '平常 SDA 只能在 SCL 低電位時改變；在 SCL 高電位時改變 SDA，代表的是起始或停止這種特殊事件。', '看到 START 之後，匯流排上所有從機都會開始聽接下來的位址。'], 1);
      case 'rstart': return R('重複起始 Sr', ['沒有先送 STOP 就再送一次起始條件。', '常用在「先寫暫存器位址，再切換成讀取」：中間不放開匯流排，別的主機就不能插隊。'], 1);
      case 'addr': return R(`位址 0x${hex2(d.addr)} · ${d.rw ? '讀' : '寫'}`, [`這 8 個位元是 ${bin(d.value)}：前 7 個位元 ${bin(d.addr, 7)}＝0x${hex2(d.addr)} 是從機位址，最後 1 個位元 ${d.rw} 表示${d.rw ? '讀取（從機要送資料給主機）' : '寫入（主機要送資料給從機）'}。`,
        dev ? `0x${hex2(d.addr)} 是工作台上 ${dev.name} 的位址，所以它會回 ACK。` : '工作台上沒有元件使用這個位址，所以不會有人回 ACK。',
        '程式裡寫的是 7 位元位址。STM32 HAL 的函式要求先左移一位（addr << 1），R/W 位元由 HAL 自己補上；其他 SDK 大多直接給 7 位元位址。'], 2, [['7 位元位址', `0x${hex2(d.addr)}`], ['R/W', d.rw ? '1（讀）' : '0（寫）'], ['整個位元組', `0x${hex2(d.value)}`]]);
      case 'data': {
        const reg = !d.rw && d.index === 0 && dev ? I2C_REG[dev.v.dev]?.[d.value] : null;
        return R(`資料 0x${hex2(d.value)}`, [`二進位 ${bin(d.value)}，十進位 ${d.value}${ascii(d.value) ? '，ASCII ' + ascii(d.value) : ''}。最高位元（MSB）先送。`,
          d.rw ? `這是從機${dev ? ` ${dev.name}` : ''}送給主機的資料：這 8 個時脈裡 SDA 由從機控制。` : `這是主機送給從機${dev ? ` ${dev.name}` : ''}的第 ${d.index + 1} 個位元組。`,
          reg ? `寫入的第一個位元組通常是「暫存器位址」或「指令」：0x${hex2(d.value)} 是 ${reg}。` : null,
          '每個位元在 SCL 低電位時準備好，SCL 變高時被對方讀取。'], 3, [['二進位', bin(d.value)], ['十進位', String(d.value)]]);
      }
      case 'ack': return R('ACK（確認）', [`第 9 個時脈時，送資料的一方放開 SDA，${d.who}把 SDA 拉到低電位，表示「收到了」。`, '放開的 SDA 會被上拉電阻拉回高電位，所以「沒人回應」時看到的會是高電位（NACK）。'], 4);
      case 'nack': return R('NACK（沒有確認）', d.after === 'addr' ? ['第 9 個時脈時 SDA 仍然是高電位：沒有任何從機認得這個位址。', '常見原因：元件沒有接電源或 GND、SDA／SCL 沒接好、位址寫錯，或元件正在忙（例如 HDC1080 溫度轉換還沒完成時會故意不回應）。'] : d.last ? ['這是主機讀取的最後一個位元組。主機故意回 NACK，告訴從機「夠了，不用再送」，接著送出 STOP——這是正常的。'] : ['接收的一方不接受這個位元組。'], 4);
      case 'stop': return R('停止條件 STOP', ['SCL 維持高電位時，SDA 由低變高——這次傳輸結束，匯流排回到閒置狀態（兩條線都被上拉電阻拉到高電位）。'], 5);
      case 'bit': return R(d.ack ? `第 9 個位元（ACK）：${d.v}` : `位元 ${7 - d.k}：${d.v}`, [d.ack ? '第 9 個位元是接收方的回應：0＝ACK、1＝NACK。' : `這是位元組的第 ${d.k + 1} 個位元（bit ${7 - d.k}），I2C 先送最高位元。`, `在 SCL 由低變高的時候讀取 SDA：此時 SDA 是${d.v ? '高' : '低'}電位，所以是 ${d.v}。`, 'SCL 高電位的期間 SDA 不能改變，否則會被當成起始或停止條件。'], 3);
      case 'packet': {
        const lines = (d.segs || []).filter(s => s.addr !== null).map(s => { const dv = i2cDevice(s.addr); return `${s.rw ? '讀取' : '寫入'} 0x${hex2(s.addr)}${dv ? `（${dv.name}）` : ''}：${s.nak ? '沒有回應（NACK）' : s.bytes.length ? s.bytes.map(hex2).join(' ') : '沒有資料'}`; });
        return R('一次 I2C 傳輸', ['從 START 到 STOP 是一次完整的傳輸：', ...lines, '範例程式讀暫存器的方法是「先寫入暫存器位址，再讀資料」，所以常會看到一寫一讀成對出現。'], 6);
      }
      case 'err': return R('位元數不完整', ['兩個起始／停止條件之間的位元數不是 9 的倍數。可能是取樣率太低漏掉了時脈，或是探棒接觸不良、沒有共地。'], 7);
    }
  }
  if (proto === 'uart'){
    const Tb = 1e6 / ctx.opt.baud;
    switch (a.kind){
      case 'ustart': return R('起始位元', ['線路閒置時是高電位。送資料前先拉低一個位元時間，告訴接收端「要開始了」。', `接收端看到下降緣後，等半個位元時間（${(Tb / 2).toFixed(2)} µs）確認還是低電位，接著每隔一個位元時間（${Tb.toFixed(2)} µs）讀一次。`], 1);
      case 'ubit': return R(`資料位元 bit ${d.k}：${d.v}`, [`UART 先送最低位元（LSB）。這是第 ${d.k + 1} 個資料位元（bit ${d.k}）。`, `接收端在這個位元的正中間取樣，讀到${d.v ? '高' : '低'}電位。`], 2);
      case 'upar': return R('同位元', ['用來檢查錯誤：偶同位時，資料位元加上同位元的 1 的個數要是偶數。'], 2);
      case 'ustop': return R('停止位元', ['資料送完後回到高電位至少一個位元時間，下一個位元組的起始位元（下降緣）才看得出來。'], 3);
      case 'uferr': return R('停止位元錯誤（框架錯誤）', ['在應該是停止位元的位置讀到低電位。', '最常見的原因是鮑率不一致：位元時間算錯，取樣點就會一路偏移，讀到的位元全都錯。檢查解碼設定的鮑率。'], 4);
      case 'ubyte': case 'uerr': {
        const v = d.value, rev = bin(v).split('').reverse().join('');
        return R(`位元組 0x${hex2(v)}`, [`十進位 ${v}，二進位 ${bin(v)}。線上的順序是 ${rev}（先送 bit 0）。`,
          ascii(v) ? `ASCII 字元 ${ascii(v)}。` : v >= 0x80 ? '這個值大於 0x7F，不是 ASCII。printf 裡的中文字用 UTF-8 編碼，每個中文字通常佔 3 個位元組（例如「溫」是 E6 BA AB），解碼清單會把它們組回中文。' : '這是控制字元。',
          `一個位元組＝起始位元＋8 個資料位元＋停止位元＝10 個位元，${ctx.opt.baud} bps 時約 ${(10 * Tb).toFixed(1)} µs。`, d.ferr ? '這個位元組的停止位元錯誤，內容不可信。' : null], 5, [['二進位', bin(v)], ['十進位', String(v)]]);
      }
      case 'utext': case 'utextbad': return R('一行文字', [`這 ${d.n} 個位元組解碼成文字：${d.text.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}`, `這是程式呼叫 printf 送出的。${ctx.opt.baud} bps 時一個位元組約 ${(10e6 / ctx.opt.baud).toFixed(1)} µs，整行共 ${us(dur)}。`, d.bad ? `其中 ${d.bad} 個位元組有框架錯誤。` : null], 6);
    }
  }
  if (proto === 'spi'){
    const dev = spiDevice(ctx.id), mode = ctx.opt.cpol * 2 + ctx.opt.cpha;
    const frame = ctx.anns.find(f => f.kind === 'sframe' && f.t0 <= a.t0 && f.t1 >= a.t1);
    switch (a.kind){
      case 'sbit': return R(`MOSI ${d.mosi}／MISO ${d.miso}`, [`模式 ${mode}：${(ctx.opt.cpol === 0) === (ctx.opt.cpha === 0) ? '上升緣' : '下降緣'}取樣。這個時脈同時傳了兩個位元：主機在 MOSI 送出 ${d.mosi}，從機在 MISO 回傳 ${d.miso}。`, 'SPI 是全雙工：每一個時脈，主機和從機各交換一個位元；8 個時脈就交換一個位元組。'], 3);
      case 'smosi': return R(`MOSI 0x${hex2(d.value)}`, [`主機（MCU）送出的位元組，二進位 ${bin(d.value)}，最高位元先送。`, ...(frame && d.index === 0 ? spiMeaning(dev, frame.d.mosi, frame.d.miso).slice(0, 1) : []), dev?.v.dev?.startsWith('max') ? `${dev.v.part} 沒有 MOSI 腳，這些位元組只是為了產生時脈。` : null], 4, [['二進位', bin(d.value)]]);
      case 'smiso': return R(`MISO 0x${hex2(d.value)}`, [`從機${dev ? ` ${dev.name}` : ''}回傳的位元組，二進位 ${bin(d.value)}。`, d.value === 0xFF && d.index === 0 ? '0xFF 通常代表從機這一拍沒有在送資料（MISO 被拉高），例如主機正在送指令的時候。' : null, ...(frame ? spiMeaning(dev, frame.d.mosi, frame.d.miso).slice(1) : [])], 4, [['二進位', bin(d.value)]]);
      case 'sframe': return R('一次 SPI 傳輸', [`CS 拉低期間共交換 ${d.mosi.length} 個位元組。CS 拉低＝選中從機，拉高＝結束。`, `MOSI（主機送出）：${d.mosi.map(hex2).join(' ')}`, `MISO（從機回傳）：${d.miso.map(hex2).join(' ')}`, ...spiMeaning(dev, d.mosi, d.miso)], 5);
      case 'sempty': return R('CS 拉低，但沒有時脈', ['CS 被拉低又拉高，中間沒有 SCK。可能程式只切換了 CS，或是 SCK 探棒沒接好。'], 2);
      case 'serr': return R('位元數不完整', [`這次傳輸最後只有 ${d.n} 個位元，不滿一個位元組。可能是 CS 探棒接錯、取樣率太低漏掉時脈，或模式設錯。`], 3);
    }
  }
  if (proto === 'can'){
    const pk = ctx.anns.find(f => f.row === 'packets' && f.t0 <= a.t0 + .01 && f.t1 >= a.t1 - .01), id = pk?.d.id;
    const who = id === 0x123 ? 'MCU' : id === 0x200 ? '收發器模組的測試節點' : '某個節點';
    const T = 1e6 / ctx.opt.bitrate;
    switch (a.kind){
      case 'csof': return R('SOF 訊框開始', ['匯流排閒置時是隱性（邏輯 1：CANH＝CANL＝2.5 V）。一個顯性位元（邏輯 0）代表訊框開始，所有節點都用這個下降緣對齊時脈。', '只有在匯流排連續閒置至少 11 個位元之後，節點才可以開始傳送。'], 3);
      case 'cid': return R(`識別碼 ID 0x${d.id.toString(16).toUpperCase().padStart(3, '0')}`, ['11 位元的識別碼，同時也是優先權：數字越小越優先。', '兩個節點同時開始傳送時會逐位元比較：送隱性（1）卻聽到顯性（0）的節點知道自己輸了，立刻停下來改成接收，這叫「仲裁」，贏的人完全不受影響。',
        d.id === 0x123 ? 'ID 0x123 是範例程式中 MCU 每秒送出的訊框。' : d.id === 0x200 ? 'ID 0x200 是收發器模組內建的測試節點每 500 ms 送出的訊框。' : null], 3, [['二進位', bin(d.id, 11)]]);
      case 'crtr': return R('RTR 位元', ['0＝資料訊框（帶資料）；1＝遠端訊框（請別人送資料過來）。'], 3);
      case 'cide': return R('IDE 位元', ['0＝標準格式（11 位元 ID）；1＝延伸格式（29 位元 ID）。'], 3);
      case 'cr0': return R('保留位元 r0', ['保留給未來使用，傳送時固定送顯性（0）。'], 3);
      case 'cdlc': return R(`資料長度 DLC ${d.dlc}`, ['4 個位元，告訴大家後面有幾個資料位元組（0–8）。'], 3);
      case 'cdata': return R(`資料 D${d.index}：0x${hex2(d.value)}`, [`二進位 ${bin(d.value)}，最高位元先送。`, id === 0x123 ? ['D0、D1 是 MCU 的計數值（高位元組在前）。', '', '0x00 這種一連串的 0 會觸發位元填充。', '0xFF 這種一連串的 1 會觸發位元填充。'][d.index] : id === 0x200 ? 'D0、D1 是測試節點的計數值（高位元組在前），每送一次加 1。' : null], 3);
      case 'ccrc': return R(`CRC 0x${pk ? pk.d.crc.toString(16).toUpperCase().padStart(4, '0') : ''}`, ['從 SOF 到資料的每一個位元（不含填充位元），用多項式 x¹⁵＋x¹⁴＋x¹⁰＋x⁸＋x⁷＋x⁴＋x³＋1（0x4599）算出的 15 位元檢查碼。', pk ? (pk.d.crcOk ? `解碼器自己算出來也是 0x${pk.d.calc.toString(16).toUpperCase().padStart(4, '0')}，資料沒有出錯。` : `解碼器算出來是 0x${pk.d.calc.toString(16).toUpperCase().padStart(4, '0')}，和收到的不一樣，訊框有錯。`) : null], 5);
      case 'ccrcdel': return R('CRC 分隔位元', ['固定是隱性（1），讓傳送端有時間切換成「聽 ACK」。'], 6);
      case 'cack': return R('ACK 槽：有節點確認', ['傳送端在 ACK 槽送隱性（1），只要有任何一個節點正確收到，就會在這一位元把匯流排拉成顯性（0）。', id === 0x123 ? '這裡是收發器模組的測試節點回 ACK。' : 'MCU 的 CAN 控制器收到後回 ACK：用 UART／邏輯分析儀看 MCU 的 CAN_TX 腳，這一位元會有一個短短的低電位。'], 6);
      case 'cnack': return R('ACK 錯誤：沒有節點確認', ['ACK 槽一直是隱性，表示匯流排上沒有任何節點正確收到這個訊框。', `${who === 'MCU' ? '對端節點可能被關掉了，或收發器沒有供電。' : 'MCU 可能還沒有啟動 CAN（程式沒在執行、還沒呼叫 Start），或 TXD／RXD 接錯，所以沒辦法回 ACK。'}`, '傳送端接著送出錯誤旗標，然後自動重送。'], 6);
      case 'cackdel': return R('ACK 分隔位元', ['固定是隱性（1）。'], 6);
      case 'ceof': return R('EOF 訊框結束', ['7 個隱性位元，表示訊框結束。之後還要至少 3 個位元的間隔，下一個訊框才能開始。'], 6);
      case 'cerrflag': return R('錯誤旗標', ['傳送端發現錯誤後，立刻送出 6 個連續的顯性位元。這故意違反位元填充規則，讓所有節點都知道這個訊框作廢。', 'CAN 控制器會自動重送，直到有人 ACK，或錯誤次數太多進入「匯流排關閉」狀態。'], 6);
      case 'cstuff': return R('填充位元', ['CAN 規定：連續 5 個相同的位元之後，傳送端要插入 1 個相反的位元。', '這樣訊號至少每 6 個位元就有一次邊緣，所有節點才能持續校正時脈。接收端會自動把填充位元拿掉，不算進資料，也不算進 CRC。'], 4);
      case 'cbit': return R(`位元 ${d.v}（${d.v ? '隱性' : '顯性'}）`, [d.v ? '隱性（邏輯 1）：CANH 與 CANL 都約 2.5 V，差動電壓約 0 V。' : '顯性（邏輯 0）：CANH 約 3.5 V、CANL 約 1.5 V，差動電壓約 2 V。顯性會蓋過隱性。', `在每個位元時間（${T.toFixed(1)} µs）約 70% 的位置取樣。`], 2);
      case 'cframe': case 'cframenack': case 'ccrcerr':
        return R(`CAN 訊框 ID 0x${d.id.toString(16).toUpperCase().padStart(3, '0')}`, [`由${who === 'MCU' ? ' MCU ' : who}送出，資料 ${d.data.length} 個位元組：${d.data.map(hex2).join(' ') || '（無）'}。`, `這個訊框插了 ${d.stuffBits} 個填充位元，總長 ${us(dur)}（${ctx.opt.bitrate / 1000} kbps 時每個位元 ${T.toFixed(1)} µs）。`, d.crcOk ? 'CRC 正確。' : 'CRC 錯誤。', d.ackOk ? '有節點回 ACK。' : '沒有節點回 ACK。'], 3);
      case 'cstufferr': case 'cerr': return R(a.label, ['解碼失敗。常見原因：解碼鮑率和實際的不一樣、取樣率太低，或 CANH／CANL 探棒接反。'], 7);
    }
  }
  return R(a.label, [], 0);
}

/* ---------- 分步教學：find 會在擷取到的波形裡找出第一個符合的片段 ---------- */
export const LESSONS = {
  i2c:[
    { title:'I2C 是什麼', body:['I2C 只用兩條線：SCL（時脈，由主機產生）和 SDA（資料，雙向）。很多元件可以掛在同一組線上，每個元件有自己的 7 位元位址。', '兩條線都是「開汲極」：元件只能把線拉低，放開時由上拉電阻拉回高電位。所以閒置時兩條線都是高電位。'], find:['packet'], try:'先按「擷取」。看看 SCL 是不是一段一段的方波，閒置時兩條線都停在高電位。' },
    { title:'起始條件 START', body:['SCL 高電位時，SDA 由高變低，就是「開始」。', '這是唯一允許在 SCL 高電位時改變 SDA 的時候（另一個是 STOP）。'], find:['start'], try:'按「在波形上找」，放大看 SDA 先掉下來、SCL 才跟著掉。' },
    { title:'位址與讀寫位元', body:['START 之後的第一個位元組：前 7 位元是從機位址，第 8 位元是讀寫方向（0 寫、1 讀）。', '例如 BME280 的位址是 0x76，寫入時這個位元組是 0xEC，讀取時是 0xED。'], find:['addr'], try:'點位址那一格，看它怎麼由 8 個位元組成。' },
    { title:'資料位元', body:['每個位元組 8 個位元，最高位元先送。SDA 在 SCL 低電位時改變，SCL 高電位時被讀取。', '主機寫入時資料由主機送；讀取時 SDA 由從機控制。'], find:['data'], try:'放大到看得見每一個時脈，點上面那一列的 0／1。' },
    { title:'ACK 與 NACK', body:['每 8 個位元之後有第 9 個時脈：接收方把 SDA 拉低回應 ACK（收到）。沒人拉低就是 NACK。', '主機讀到最後一個位元組時會故意回 NACK，表示讀完了。'], find:['ack', 'nack'], try:'試著把感測器的 SDA 線拔掉再擷取，位址後面就會變成 NACK。' },
    { title:'停止條件 STOP', body:['SCL 高電位時，SDA 由低變高，傳輸結束，匯流排回到閒置。'], find:['stop'], try:'找找看每一筆傳輸最後的 STOP。' },
    { title:'讀暫存器的完整流程', body:['大部分感測器的讀法是：先「寫入」暫存器位址，再「讀取」資料。', '解碼清單可以看到這種一寫一讀的組合，例如寫 0x76：FA → 讀 0x76：三個溫度位元組。'], find:['packet'], try:'到「解碼清單」分頁，點每一筆看看在讀哪個暫存器。' },
    { title:'動手實驗', body:['1. 把取樣率調到 250 kS/s 以下：100 kHz 的 SCL 只取到幾個點，解碼開始出錯。', '2. 把 SCL、SDA 兩根探棒對調：找不到起始條件。', '3. 拔掉分析儀的 GND：波形出現雜訊。', '4. 換成另一個型號的感測器（元件分頁）：位址跟著改變。'], find:[], try:'每做一個實驗，按「擷取」再看「說明」分頁的分析。' },
  ],
  uart:[
    { title:'UART 是什麼', body:['UART 用一條線傳一個方向：MCU 的 TX 送出、RX 接收。沒有時脈線，雙方要事先約定相同的速度（鮑率），例如 115200 bps。', '閒置時是高電位。printf 的文字就是從 TX 一個位元組一個位元組送到電腦的。'], find:['utext'], try:'按「擷取」，看看 TX 上一串一串的資料。' },
    { title:'起始位元', body:['每個位元組開頭先拉低一個位元時間，接收端靠這個下降緣知道要開始讀了。'], find:['ustart'], try:'放大一個位元組，找到最前面那段低電位。' },
    { title:'資料位元：LSB 先送', body:['接著是 8 個資料位元，最低位元（bit 0）先送。所以波形上看到的順序是反過來的。', '接收端在每個位元的正中間取樣。'], find:['ubit'], try:'點一個位元組，對照它的二進位和線上的順序。' },
    { title:'停止位元', body:['最後回到高電位至少一個位元時間，然後才是下一個位元組。這種格式叫 8N1：8 個資料位元、沒有同位元、1 個停止位元。'], find:['ustop'], try:'數一數：一個位元組總共 10 個位元。' },
    { title:'鮑率與位元時間', body:['115200 bps 表示每秒 115200 個位元，一個位元約 8.68 µs。', '分析儀可以從最短的脈衝反推鮑率：點「說明」分頁就會看到估計值。'], find:['ubyte'], try:'把解碼鮑率改成 9600，看會出現什麼錯誤。' },
    { title:'ASCII、換行與中文', body:['英文和數字用 ASCII：例如 \'A\'＝0x41。\\r＝0x0D、\\n＝0x0A 是換行。', '中文用 UTF-8，每個字 3 個位元組，例如「溫」＝E6 BA AB。'], find:['utext'], try:'到「解碼清單」看每一行，再點開看裡面的位元組。' },
    { title:'動手實驗', body:['1. 解碼鮑率改成 9600 或 57600：停止位元錯誤、亂碼。', '2. 取樣率調到 250 kS/s 以下：每個位元只取到 2 個點左右，開始出錯。', '3. 把 TX 探棒接到 RX：MCU 沒有在收資料，線一直是高電位。'], find:[], try:'每做一個實驗，按「擷取」再看「說明」分頁。' },
  ],
  spi:[
    { title:'SPI 是什麼', body:['SPI 用四條線：SCK（時脈）、MOSI（主機送出）、MISO（從機回傳）、CS（片選）。時脈由主機產生，速度通常比 I2C 快很多。', '多個從機共用 SCK、MOSI、MISO，每個從機有自己的 CS。'], find:['sframe'], try:'按「擷取」，看 CS 拉低的那一段就是一次傳輸。' },
    { title:'CS 片選', body:['CS 平常是高電位。主機把某個從機的 CS 拉低，那個從機才會聽 SCK、在 MISO 上回應；其他從機的 MISO 保持高阻抗。', 'CS 拉高代表一個指令結束——SPI Flash 的寫入、抹除都是在 CS 拉高的那一刻才開始。'], find:['sframe'], try:'把分析儀的 CS 探棒改接到另一個 SPI 元件的 CS，看看解碼到的內容有什麼不同。' },
    { title:'時脈與模式', body:['模式由 CPOL（閒置電位）和 CPHA（哪一個邊緣取樣）決定。模式 0：閒置低電位、上升緣取樣、下降緣換資料。', '主機和從機的模式一定要一樣。'], find:['sbit'], try:'放大看：MOSI 在 SCK 下降緣改變，上升緣時保持穩定。' },
    { title:'全雙工交換', body:['每個時脈主機送出一個位元、同時收回一個位元，8 個時脈就交換一個位元組。', '所以就算只想讀資料，主機也要送東西出去（常送 0x00 或 0xFF）來產生時脈。'], find:['smosi', 'smiso'], try:'點 MOSI 和 MISO 同一個位置的位元組。' },
    { title:'指令與回應', body:['SPI Flash 用「指令碼＋位址＋資料」：0x9F 讀 ID、0x05 讀狀態、0x06 允許寫入、0x20 抹除、0x02 寫入、0x03 讀取。', '熱電偶 IC（MAX6675／MAX31855）沒有指令，CS 拉低後直接送出溫度資料。'], find:['sframe'], try:'到「解碼清單」從頭看 Flash 初始化：讀 ID → 允許寫入 → 抹除 → 等待 → 寫入。' },
    { title:'動手實驗', body:['1. 把解碼模式改成模式 1：取樣點落在資料改變的瞬間，位元錯一位。', '2. 取樣率調到 2 MS/s 以下：1 MHz 的 SCK 取不到足夠的點。', '3. 把 Flash 的 DI、DO 兩條線對調（接線分頁），看檢測和波形會怎樣。'], find:[], try:'每做一個實驗，按「擷取」再看「說明」分頁。' },
  ],
  can:[
    { title:'CAN 是什麼', body:['CAN 是汽車與工業常用的匯流排：所有節點接在同一對線 CANH、CANL 上，用「差動」訊號傳輸，抗雜訊能力很好。', 'MCU 的 CAN 控制器只有 TX、RX 兩支邏輯腳，要透過收發器（例如 SN65HVD230）轉成差動訊號。匯流排兩端各有一個 120 Ω 終端電阻。'], find:['cframe'], try:'按「擷取」，看 CANH（橘）和 CANL（藍）是不是一高一低、對稱地變化。' },
    { title:'顯性與隱性', body:['隱性（邏輯 1）：CANH＝CANL＝2.5 V。顯性（邏輯 0）：CANH≈3.5 V、CANL≈1.5 V。', '只要有一個節點送顯性，整條匯流排就是顯性——「0 會贏」。'], find:['cbit'], try:'放大看一個位元，比較兩條線的電壓。' },
    { title:'訊框結構', body:['SOF → ID（11 位元）→ RTR、IDE、r0 → DLC（資料長度）→ 資料（0–8 位元組）→ CRC（15 位元）→ ACK → EOF。'], find:['cid', 'cdlc', 'cdata'], try:'點下面那一列的每個欄位，看它們的意思。' },
    { title:'位元填充', body:['連續 5 個相同位元後，傳送端插入 1 個相反的位元，讓訊號一定有足夠的邊緣可以同步。', '範例程式故意送 0x00 和 0xFF，就是為了讓你看到很多填充位元（紫色）。'], find:['cstuff'], try:'找到 D2＝0x00、D3＝0xFF，數數看插了幾個填充位元。' },
    { title:'仲裁與優先權', body:['ID 也是優先權：ID 越小越優先。同時傳送時，送 1 卻聽到 0 的節點會自動退出。', '所以測試節點的 0x200 和 MCU 的 0x123 同時要送時，0x123 會贏。'], find:['cid'], try:'比較 0x123 和 0x200 的 ID 二進位，從第幾個位元開始不一樣？' },
    { title:'CRC 與 ACK', body:['CRC 讓接收端檢查資料有沒有出錯。', 'ACK 槽：傳送端送隱性，任何一個正確收到的節點都會把它拉成顯性。沒有人回 ACK，傳送端就送出錯誤旗標並重送。'], find:['cack', 'cnack'], try:'到元件分頁把 CAN 模組的「測試節點」關掉，再擷取看看 MCU 送的訊框。' },
    { title:'動手實驗', body:['1. 關掉測試節點：MCU 的訊框沒人 ACK，出現錯誤旗標。', '2. 解碼鮑率改成 250 kbps：解不出訊框。', '3. CANH、CANL 探棒對調：差動電壓變負，位元全部顛倒。', '4. 取樣率調到 1 MS/s：每個位元只取到 2 個點。'], find:[], try:'每做一個實驗，按「擷取」再看「說明」分頁。' },
  ],
};
export { MODULE_TYPES };

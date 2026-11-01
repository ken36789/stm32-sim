# STM32 接線實驗台

線上版：https://ken36789.github.io/stm32-sim/

在瀏覽器裡模擬 STM32 開發板：
- 用 3D 畫面接杜邦線，並自動檢測接線錯誤。
- 可以更換開發板與周邊元件，查看 datasheet。
- 把自己寫的 C/HAL 程式「編譯、燒錄」到開發板上執行。

這是純前端的靜態網站，不需要後端，任何人用瀏覽器（含 iPhone、iPad 的 Safari）打開就能用。

## 功能

- **37 塊開發板**：
  - Nucleo-144：H7、H5、F7、F4、F2、L4、U5
  - Nucleo-64：F4、F3、F1、F0、G4、G0、L4、L1、L0
  - Nucleo-32：L432KC、G431KB、F303K8、F042K6
  - 其他：Blue Pill、Black Pill（F411CE／F401CC）、STM32F407G-DISC1
- **開發板資料**：
  - 每塊板子有 30–40 腳的排針，Nucleo 使用 Arduino 相容的 A0–A5、D0–D15 腳位名稱。
  - 各板的板載 LED、使用者按鈕、I2C、ADC 與虛擬序列埠腳位都依照官方使用手冊設定。
- **8 種外接模組、24 種型號**：
  - 模組：LED、RGB LED、按鈕、PIR 人體感應、類比輸入（電位器／光敏電阻）、I2C 溫度感測器、蜂鳴器、繼電器。
  - 每種都可以更換型號，並標示「入門／進階／高階」與升級理由。
  - 工作台最多 8 個模組。
- **電源軌**：+ 與 − 各 10 孔，方便多個模組共用 3V3 與 GND。
- **元件資訊與 datasheet**：
  - 點 3D 畫面上的 MCU、ST-LINK、穩壓器或任何模組，會在「元件」分頁顯示規格、datasheet 與產品頁連結。
  - 也可以在那裡更換開發板或元件型號。
- **溫度感測器依各型號的 datasheet 模擬暫存器**：
  - BMP280／BME280 用晶片 ID 加 32 位元補償公式。
  - SHT31、AHT20 用指令加 CRC-8。
  - TMP102、LM75A、MCP9808、HDC1080 用各自的資料格式。
  - 不同型號的精度不同，換成高階型號讀值會更接近實際溫度。
- **接線檢測**：
  - 短路、電壓錯誤（例如 5 V 接到 3.6 V 的感測器、HC-SR501 接 3.3 V）。
  - SCL／SDA 接反、類比模組接到非 ADC 腳、I2C 位址衝突。
  - 虛擬序列埠腳位被占用、與板載 LED 共用腳位。
  - 會對照程式實際控制的 GPIO。
- **建議接線與範例程式**：依目前的開發板和模組自動接線，並產生完整的 main.c，包含各感測器的驅動程式。
- **編譯與燒錄**：
  - 以 gcc 的格式回報錯誤。
  - 模擬 ST-LINK 燒錄流程，Device ID 與 Flash 大小依開發板而定。
  - printf 輸出到序列埠視窗。

## 開發

需要 Node.js 18 以上（建議 22）。

```bash
npm install
npm run dev           # 開發伺服器 http://localhost:5173
npm test              # 模擬核心測試：37 塊開發板全部跑一遍
npm run lint
npm run build         # 建置到 dist/
npm run build:single  # 合併成單一 HTML（dist-single/index.html）
npm run check         # lint + test + build
```

## 專案結構

```
src/
  main.js               進入點：把核心、3D 與介面接起來
  core/                 模擬核心（不依賴 DOM 或 Three.js，可在 Node 測試）
    boards.js           開發板資料庫、排針、板上元件與 datasheet 連結
    parts.js            外接模組與各型號（規格、等級、datasheet）
    sim.js              工作台狀態、接線、電氣網路、GPIO、ADC、I2C
    devices.js          I2C 感測器的暫存器／指令模型
    checks.js           接線檢測規則
    codegen.js          建議接線與範例程式產生器
    compiler.js         C 原始碼檢查與轉譯
    hal.js              模擬的 HAL 函式庫
    runtime.js          執行已燒錄的程式
  scene/                3D：scene.js（開發板、電源軌、杜邦線）、modules3d.js（模組）
  ui/                   面板：inspector.js（元件分頁）、editor.js、serial.js、build.js…
tests/core.test.js
```

## 常見擴充

**新增開發板**：在 `src/core/boards.js` 的 `RAW` 加一列，填入以下欄位：
- MCU、核心、時脈、Flash、RAM、板型
- 燒錄器、Device ID、封裝
- 板載 LED、按鈕、虛擬序列埠

板型決定排針配置（`n144`、`n64`、`n32`、`pill`、`disco`）。Nucleo 系列如果 Arduino 腳位和預設不同，用 `pins` 覆寫。

**新增元件型號**：在 `src/core/parts.js` 對應模組的 `variants` 加一筆。I2C 感測器還要在 `devices.js` 加暫存器模型，並在 `codegen.js` 的 `driver()` 加讀取範例。

**新增模組種類**：依序修改以下檔案：
1. `parts.js`：定義模組。
2. `sim.js` 的 `moduleState`：設定電氣行為。
3. `checks.js`：加入接線規則。
4. `modules3d.js`：加入 3D 外觀。
5. `codegen.js`：加入範例程式。

**新增 HAL 函式**：在 `hal.js` 的 `makeAPI` 加同名函式。會等待的函式要加進 `compiler.js` 的 `ASYNC_BUILTIN`。

## 程式是怎麼「執行」的

這不是真的 ARM 編譯器：
1. 先用規則檢查常見錯誤。
2. 再把 C 程式轉成 async JavaScript：
   - 型別換成 `let`，整數型別轉換保留截斷效果，例如 `(int16_t)`。
   - 會等待的 HAL 函式前加 `await`。
   - 每個迴圈插入讓出點。

一般的 C 語法都能用。指標運算、`struct`、`union` 還不支援。

ADC 是簡化模型：`hadc1` 會讀取第一個接了類比模組的 ADC 腳。

## 部署

推送到 `main` 分支後，GitHub Actions 會自動測試、建置並部署到 GitHub Pages。

## Datasheet 連結

ST 的連結採用官方網址格式：
- MCU datasheet：`st.com/resource/en/datasheet/<型號>.pdf`
- MCU 產品頁：`st.com/en/microcontrollers-microprocessors/<型號>.html`
- 開發板產品頁：`st.com/en/evaluation-tools/<型號>.html`

TI、NXP、Microchip、Bosch、Omron、Bourns 的元件連到原廠 PDF。找不到穩定原廠網址的通用零件（例如 TTP223、HC-SR501）則提供 datasheet 搜尋連結。

## 資料儲存

開發板、模組、接線、程式碼與設定都存在使用者瀏覽器的 localStorage，不會上傳。

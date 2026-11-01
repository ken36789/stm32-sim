# MCU 模擬實驗室

線上版：https://ken36789.github.io/stm32-sim/

在瀏覽器裡模擬 ST、TI、NXP 共 116 種 MCU：用 3D 畫面接杜邦線、自動檢測接線，再把自己寫的 C 程式依照「接線檢測 → 編譯 → 燒錄」的流程寫進晶片執行。

這是純前端的靜態網站，不需要後端，任何人用瀏覽器（含 iPhone、iPad 的 Safari）打開就能用。

## 功能

- **116 種晶片**：
  - **ST（37）**：Nucleo-144、Nucleo-64、Nucleo-32、Blue Pill、Black Pill、F407 Discovery。
  - **TI（42）**：MSPM0、MSP430、TM4C（Tiva C）、C2000。
  - **NXP（37）**：Kinetis、MCX、LPC55／LPC54／LPC800、i.MX RT。
- **原廠 SDK 寫法**：每家晶片用自己的 SDK，「載入範例程式」會產生對應的完整程式。
  - ST：STM32Cube HAL
  - TI：MSPM0 DriverLib、MSP430 DriverLib、TivaWare、C2000Ware driverlib
  - NXP：MCUXpresso SDK
- **官方開發板與通用評估板**：
  - 標示「官方開發板」的，腳位依官方使用手冊設定，例如 LP-MSPM0G3507、MSP-EXP430FR2355、EK-TM4C123GXL、LAUNCHXL-F28379D、FRDM-K64F、LPCXpresso55S69、MIMXRT1060-EVKB。
  - 其他晶片放在「模擬器通用評估板」上：晶片腳位名稱與周邊功能依 datasheet，LED、按鈕與 I2C／UART 接法是本模擬器的設定。
- **強制實驗流程**：
  - 面板上方有三個步驟：① 接線檢測 ② 編譯 ③ 燒錄。
  - 更換晶片、模組、型號、接線或修改程式後，要重新檢測（沒有錯誤）並重新編譯，才能燒錄。
  - 硬體一變更，執行中的程式會立刻停止，韌體標示為「需重新燒錄」。
- **8 種外接模組、24 種型號**：
  - 模組：LED、RGB LED、按鈕、PIR、電位器／光敏電阻、I2C 溫度感測器、蜂鳴器、繼電器。
  - 預設工作台包含蜂鳴器。按「聲音：開」後，按住按鈕模組就會響；iPhone 在靜音模式下也能發聲。
- **元件資訊與 datasheet**：點 3D 畫面上的晶片、燒錄器、穩壓器或任何模組，可以查看規格、下載 datasheet、更換型號。
- **I2C 感測器依 datasheet 模擬暫存器**：BMP280／BME280 補償公式、SHT31／AHT20 CRC、TMP102、LM75A、MCP9808、HDC1080。
- **接線檢測**：
  - 短路、電壓範圍、SCL／SDA 接反、非 ADC 腳、I2C 位址衝突、虛擬序列埠腳被占用。
  - 會對照程式實際控制的 GPIO，能解析各家 SDK 的寫法。

## 開發

需要 Node.js 18 以上（建議 22）。

```bash
npm install
npm run dev           # 開發伺服器 http://localhost:5173
npm test              # 模擬核心測試：116 種晶片、6 種 SDK 全部跑一遍
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
    boards.js           ST 開發板資料庫，並合併 TI 與 NXP
    boards-ti.js        TI 晶片（MSPM0、MSP430、TM4C、C2000）
    boards-nxp.js       NXP 晶片（Kinetis、MCX、LPC、i.MX RT）
    sdk.js              各家 SDK 的範例程式寫法
    hal-vendor.js       TI 與 NXP SDK 函式的模擬
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

**新增晶片**：ST 加在 `boards.js` 的 `RAW`；TI、NXP 加在 `boards-ti.js`、`boards-nxp.js`（同系列可以直接用現成的範本函式）。ST 的那一列，填入以下欄位：
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

**新增 SDK 函式**：ST HAL 加在 `hal.js` 的 `makeAPI`，TI、NXP 加在 `hal-vendor.js`。會等待的函式要加進 `compiler.js` 的 `ASYNC_BUILTIN`。

## 程式是怎麼「執行」的

這不是真的交叉編譯器（ARM、MSP430、C2000 都一樣）：
1. 先用規則檢查常見錯誤。
2. 再把 C 程式轉成 async JavaScript：
   - 型別換成 `let`，整數型別轉換保留截斷效果，例如 `(int16_t)`。
   - 會等待的 SDK 函式（延遲、I2C）前加 `await`。
   - 沒有實作的 SDK 設定函式（時脈、腳位多工等）會被略過。
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

# MCU 模擬實驗室

線上版：https://ken36789.github.io/stm32-sim/

在瀏覽器裡模擬 ST、TI、NXP 共 116 種 MCU：用 3D 畫面接杜邦線、自動檢測接線，再把自己寫的 C 程式依照「接線檢測 → 編譯 → 燒錄」的流程寫進晶片執行。接上邏輯分析儀，可以看到 I2C、UART、SPI、CAN 訊號實際的波形，點任何一段就會說明它為什麼長這樣。

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
- **15 種外接模組、42 種型號**，工作台最多放 12 個：
  - 輸出：LED、RGB LED、有源蜂鳴器、繼電器。
  - 輸入與感測：按鈕、PIR、電位器／光敏電阻、I2C 溫度感測器（8 種）。
  - SPI／CAN 元件：熱電偶模組（MAX6675、MAX31855K）、SPI Flash（W25Q32JV、W25Q128JV）、CAN 收發器（SN65HVD230、TJA1050、TCAN332，內建 120 Ω 終端電阻與每 500 ms 送出 ID 0x200 的測試節點）。
  - 量測儀器：I2C、UART、SPI、CAN 四種分析儀。
  - 預設工作台包含蜂鳴器。按「聲音：開」後，按住按鈕模組就會響；iPhone 在靜音模式下也能發聲。
- **邏輯分析儀**（點 3D 畫面上的分析儀就會打開）：
  - 擷取 0.2–5 秒的波形；探棒上沒有變化時會像「觸發」一樣繼續等待訊號。
  - 單指拖曳平移、雙指或滾輪縮放；放大到看得見取樣點時會畫出每個取樣點。
  - 取樣率可調（依型號最高 24 或 100 MS/s），UART 鮑率、SPI 模式 0–3、CAN 鮑率可調。設錯時會看到解碼錯誤，用來理解「為什麼要設對」。
  - 解碼列：I2C 的 START／位址／ACK／資料／STOP；UART 的起始位元、資料位元、停止位元與 UTF-8 文字；SPI 的 MOSI／MISO 位元組與 Flash 指令；CAN 的 SOF、ID、DLC、資料、CRC、ACK、填充位元與錯誤旗標。
  - 「說明」：點任何一格，解說它是什麼、為什麼長這樣，並依元件解讀暫存器、指令與資料；沒有選取時列出自動分析（沒共地、探棒接反、取樣率不足、鮑率不對、NACK、ACK 錯誤…）。
  - 「教學」：每種協定 6–8 步的分步教學，可以直接在擷取到的波形上找出對應的片段，並附動手實驗。
  - 「解碼清單」：所有傳輸依時間列出，點一筆就放大到那裡。
  - 分析儀只是量測儀器：接上、移除或改接探棒不需要重新檢測、編譯、燒錄，程式會繼續執行。
- **元件資訊與 datasheet**：點 3D 畫面上的晶片、燒錄器、穩壓器或任何模組，可以查看規格、下載 datasheet、更換型號。
- **I2C 感測器依 datasheet 模擬暫存器**：BMP280／BME280 補償公式、SHT31／AHT20 CRC、TMP102、LM75A、MCP9808、HDC1080。
- **接線檢測**：
  - 短路、電壓範圍、SCL／SDA 接反、非 ADC 腳、I2C 位址衝突、虛擬序列埠腳被占用。
  - SPI 的 SCK／MISO／MOSI、Flash 的 DI／DO 接反、CS 腳；CAN 的 TXD／RXD 接反、晶片沒有 CAN 控制器、收發器電壓（TJA1050 要 5 V）。
  - 分析儀的 GND 是否共地、每根探棒是否接在正確的線上。
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
    sdk.js              各家 SDK 的範例程式寫法（GPIO、I2C、ADC、SPI、CAN）
    hal-vendor.js       TI 與 NXP SDK 函式的模擬
    buses.js            I2C 傳輸紀錄、UART 輸出、SPI（CS 片選）、CAN 控制器與測試節點
    spidev.js           SPI 元件模型：MAX6675、MAX31855K、W25Q Flash
    trace.js            訊號紀錄（微秒時間軸）：GPIO 與各協定波形的合成
    protocols.js        取樣量化與 I2C／UART／SPI／CAN 解碼器、CAN CRC-15 與位元填充
    analyzer.js         分析儀探棒、擷取、解碼與自動診斷
    lessons.js          波形片段的解說與分步教學
    parts.js            外接模組與各型號（規格、等級、datasheet）
    sim.js              工作台狀態、接線、電氣網路、GPIO、ADC、I2C
    devices.js          I2C 感測器的暫存器／指令模型
    checks.js           接線檢測規則
    codegen.js          建議接線與範例程式產生器
    compiler.js         C 原始碼檢查與轉譯
    hal.js              模擬的 HAL 函式庫
    runtime.js          執行已燒錄的程式
  scene/                3D：scene.js（開發板、電源軌、杜邦線）、modules3d.js（模組）
  ui/                   面板：inspector.js（元件分頁）、analyzer.js（邏輯分析儀視窗）、editor.js、serial.js、build.js…
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

匯流排的時間是模擬的：I2C 100 kHz、UART 115200 bps、SPI 1 MHz（模式 0）、CAN 500 kbps。每次傳輸會依這些速度產生位元層級的波形（I2C 的 START／ACK、UART 的起始與停止位元、CAN 的填充位元與 CRC），給邏輯分析儀擷取與解碼。

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

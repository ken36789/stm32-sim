# STM32H7 接線實驗台

在瀏覽器裡模擬 STM32H743ZI 開發板：用 3D 畫面接杜邦線、自動檢測接線錯誤，並把自己寫的 C/HAL 程式「編譯、燒錄」到開發板上執行。

這是純前端的靜態網站，不需要後端伺服器或資料庫。建置後的 `dist/` 資料夾可以放到任何靜態網站主機，所有人都能直接打開使用。

## 功能

- **3D 接線**：依序點兩個金色腳位就會接上一條杜邦線。點線可以拔除。手機可以改用面板上的下拉選單接線。
- **接線檢測**：
  - 檢查短路、電源電壓錯誤、I2C 腳位錯誤、SCL/SDA 接反，以及 PD8/PD9（虛擬序列埠）被占用。
  - 對照程式實際控制的 GPIO，找出接線與程式不一致的地方。
- **編譯**：
  - 用 gcc 的格式回報錯誤（含行號與 `^` 指示）。
  - 會檢查缺少分號、括號不成對、不存在的腳位，以及模擬器不支援的函式。
- **燒錄**：模擬 ST-LINK 的連線、抹除、寫入與驗證流程。燒錄中拔掉 USB，Flash 內容會變成不完整。
- **執行**：
  - 板載 LD1（PB0）、LD2（PE1）、LD3（PB14），以及外接 LED 會依程式亮滅。
  - 可以按 B1 USER、B2 RESET 和外接按鈕。printf 會輸出到序列埠視窗。
- **電氣保護**：短路時會觸發 USB 過電流保護而斷電；感測器接到 5V 會燒毀，需要在「檢測」分頁更換。

## 開發

需要 Node.js 18 以上（建議 22）。

```bash
npm install
npm run dev        # 開發伺服器，預設 http://localhost:5173（--host 讓同網段的手機也能連）
npm test           # 模擬核心測試（不需要瀏覽器）
npm run lint       # ESLint
npm run build      # 建置到 dist/
npm run preview    # 預覽建置結果
npm run check      # lint + test + build 一次跑完
```

## 專案結構

```
index.html              頁面骨架（面板、分頁、按鈕）
src/
  main.js               進入點：把核心、3D 場景與介面接起來
  styles.css            樣式與淺色／深色主題色票
  core/                 模擬核心，不依賴 DOM 或 Three.js，可在 Node 測試
    board.js            開發板 J1 腳位、外接模組、範例接線
    sim.js              接線資料、電氣網路、GPIO 讀值、LED、I2C 狀態
    checks.js           接線檢測規則
    compiler.js         C 原始碼檢查與轉譯
    hal.js              模擬的 HAL 函式庫（GPIO、Delay、I2C、UART、printf）
    printf.js           printf 格式化
    runtime.js          執行已燒錄的程式
    default-code.js     預設 main.c
    hooks.js            核心通知介面的連接點
  scene/scene.js        3D 開發板、模組、杜邦線
  ui/                   面板、編輯器、序列埠、建置與燒錄流程
tests/core.test.js      核心測試
.github/workflows/      GitHub Pages 自動部署
```

### 程式是怎麼「執行」的

這不是真的 ARM 編譯器，執行分成兩步：

1. `compiler.js` 先用規則檢查常見錯誤。
2. 再把 C 程式轉成 async JavaScript：型別換成 `let`，`HAL_Delay` 等耗時函式前加上 `await`，每個迴圈插入讓出點。這樣 `while (1)` 不會卡住瀏覽器，也能隨時停止或重設。

目前支援一般的 C 語法（變數、陣列、`if`、`for`、`while`、函式、`#define`）。指標運算、`struct` 和 `union` 還不支援。

## 常見擴充

**新增 HAL 函式**：在 `src/core/hal.js` 的 `makeAPI` 裡加一個同名函式。編譯器會自動認得它。如果函式需要等待（例如 SPI 傳輸），再把名稱加進 `compiler.js` 的 `ASYNC_BUILTIN`。

**新增外接模組**（例如蜂鳴器）：
1. 在 `src/core/board.js` 的 `MODS` 加上模組名稱、腳位和位置。
2. 在 `src/scene/scene.js` 的 `buildModule` 畫出元件。
3. 在 `src/core/checks.js` 加上它的接線規則。
4. 在 `src/main.js` 的 `applyOutputs` 更新它的 3D 狀態。

**換成其他開發板**（例如 STM32F4）：目前腳位資料集中在 `board.js`。要支援多塊板子，可以把 `J1`、板載 LED 的腳位和 MCU 資訊做成一個開發板設定物件，再加上選單切換。

## 部署（免費）

先執行 `npm run build`，產生的 `dist/` 就是完整網站。`vite.config.js` 已設定 `base: './'`，放在網域根目錄或子路徑都能用。

- **GitHub Pages**：把專案推到 GitHub，到 Settings → Pages → Source 選「GitHub Actions」。之後每次推送到 `main` 都會自動測試、建置並上線，網址是 `https://<帳號>.github.io/<專案名稱>/`。
- **Netlify / Cloudflare Pages / Vercel**：連結 GitHub 專案，建置指令填 `npm run build`，輸出資料夾填 `dist`。或直接把 `dist/` 資料夾拖到 Netlify Drop。

## 資料儲存

使用者的接線、程式碼、目前分頁和主題設定存在瀏覽器的 localStorage，只留在使用者自己的裝置上。網站不收集任何資料。之後若要加入帳號、雲端存檔或付費機制，需要另外加上後端服務。

## 字型

字型從 Google Fonts 載入：Chakra Petch、Noto Sans TC、JetBrains Mono。如果網站要在無法連到 Google 的環境使用，可以改成自行託管字型檔，或直接移除 `index.html` 裡的字型連結。移除後會改用系統字型。

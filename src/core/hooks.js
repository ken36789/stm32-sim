// 模擬核心與介面之間的連接點。核心只呼叫 hooks，介面在啟動時把實作填進來。
// 這樣 src/core 不依賴 DOM 或 Three.js，可以直接在 Node 測試。
const noop = () => {};
export const hooks = {
  toast: noop,          // (訊息, 'err'?) 顯示提示
  afterWiring: noop,    // 接線變動後
  wireAdded: noop,      // (wire) 新增一條線
  wireRemoved: noop,    // (wire) 移除一條線
  outputs: noop,        // GPIO 輸出改變
  serial: noop,         // (字串) printf / UART 輸出
  sys: noop,            // (訊息, class?) 模擬器系統訊息
  run: noop,            // (狀態) 執行狀態改變：idle/flash/run/halt/fault/done/off/reset
  sensorDamaged: noop,  // (boolean) 感測器損壞狀態
  recheck: noop,        // 重新執行接線檢測
  benchChanged: noop,   // 開發板或模組變更（需要重建 3D 與面板）
};

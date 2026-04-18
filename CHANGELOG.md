# Changelog

## [5.0] - 2026-04-18

### 新增
- **三段式收合**：`full -> bar -> rail -> full`，新增 28px 右側 Rail 並以 `panelState` 記憶狀態
- **Auto Tab Sync**：子分頁於 focus / visibilitychange 透過 `BroadcastChannel('copilot-batch-ctrl')` 廣播 `tabFocused`，主控自動切換對應 T 分頁
- **執行紀錄區**：送出任務後清空輸入框並寫入 `execLog`（slot / prompt / submittedAt / status），面板底部顯示可展開明細，點列加寬到 520px，`Esc` 可收合
- **Conversation ID Mapping**：主控開分頁前先寫入 `slot_pending_N`，子分頁每 500ms 輪詢 URL 擷取 conversation UUID 後回寫 `slot_register`

### 調整
- T1～T5 狀態色改為：灰（未分配）/ 黃（pending）/ 藍（generating）/ 綠（done）/ 青色外框（focused）

---

## [4.0] - 2026-04-18

### 新增
- **全站主控面板**：在所有網頁都顯示完整面板（T1～T5、狀態列、批次動作）
- **HTML 區塊截取**：新增 `🧩 截取 HTML 區塊`，可滑鼠選取 DOM 元素並擷取 `outerHTML`（超過 8000 字自動截斷）

### 調整
- 初始化流程改為所有頁面都載入主控 UI；僅在 Copilot 網域且 URL 含 `batch_task=` 時啟用子分頁自動執行
- 非 Copilot 頁面按下 `🚀 批次執行` 會自動開啟 M365 Copilot 分頁執行任務

---

## [3.0] - 2026-04-18

### 新增
- **縮小成狀態列**：點擊標題列將面板縮小為底部小狀態列，顯示 T1～T5 即時執行狀態（待機 / 執行中 / 完成 / 錯誤），再次點擊可展開
- **多分頁管理 UI**：T1～T5 分頁各自獨立的任務輸入框與狀態列
- **網頁截取按鈕**：非 Copilot 頁面右下角顯示 📎 按鈕，支援截取選取文字或全頁文字（自動去除廣告/導覽列雜訊），並直接送入指定 Copilot 分頁
- 分頁 has-content 綠點提示

### 改善
- 狀態資訊存入 GM storage，跨分頁共享
- 縮放狀態在重新整理後自動恢復

---

## [2.0] - 2026-04-17

### 修正
- 改用 `execCommand('insertText')` 正確對 M365 Copilot 的 Lexical Editor 注入文字
- 修正輸入框選擇器，優先使用 `id="m365-chat-editor-target-element"`
- 子分頁 URL 統一改回 `m365.cloud.microsoft`，與 `@match` 一致
- 送出按鈕改為輪詢等待（最多 4.5 秒）
- 移除 CSP 不相容的 `onclick=""` 字串，改用 `addEventListener`

---

## [1.0] - 2026-04-16

### 初始版本
- 批次開啟多個 Copilot 分頁並自動輸入指令
- 主控端 UI 面板
- GM_setValue / GM_getValue 跨分頁狀態同步
- 任務狀態監聽（等待 / 執行中 / 完成 / 錯誤）

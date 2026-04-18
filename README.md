# ⚡ Copilot Batch Task Controller

> Tampermonkey 腳本 — 讓 M365 Copilot 變成多工批次 AI 助手

[![version](https://img.shields.io/badge/version-4.0-00d2ff?style=flat-square)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

---

## ✨ 功能一覽

| 功能 | 說明 |
|------|------|
| 🗂️ **T1～T5 分頁管理** | 每個分頁獨立輸入任務，有內容時顯示綠點 |
| ▼ **縮小成狀態列** | 點擊標題列縮小面板，底部小狀態列即時顯示各分頁執行狀態 |
| 🚀 **批次執行** | 一鍵開啟多個 Copilot 分頁並自動送出任務 |
| 🌐 **全站主控面板** | 在任意網站都顯示完整控制面板（T1～T5、狀態、動作） |
| 📎 **網頁截取** | 在面板內截取選取文字、整頁內文或 HTML 區塊，一鍵送入指定 Copilot 分頁 |
| 🔄 **即時狀態同步** | 待機 / 執行中(閃爍) / 完成 / 錯誤，跨分頁共享 |

---

## 📦 安裝方式

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox）
2. 點選 **[安裝腳本](./CopilotBatchTaskController_v4.user.js)** → Tampermonkey 會自動彈出安裝視窗
3. 點「安裝」即完成

---

## 🚀 使用方式

### 基本批次任務
1. 前往 [M365 Copilot](https://m365.cloud.microsoft/)
2. 右下角出現 **⚡ Copilot 批次控制器** 面板
3. 在 T1～T5 分頁各自輸入不同任務
4. 點「🚀 批次執行」— 自動開啟對應分頁並送出

### 縮小狀態列
- 點擊面板**標題列**（⚡ Copilot 批次控制器）→ 面板縮小成底部狀態列
- 狀態列顯示 T1～T5 即時狀態（顏色 + 動畫）
- 點擊狀態列 → 重新展開面板

### 狀態色碼
| 顏色 | 意義 |
|------|------|
| 🟡 金色 | 等待中 |
| 🔵 水藍閃爍 | 執行中 |
| 🟢 綠色 | 完成 |
| 🔴 紅色 | 錯誤 |

### 網頁截取
1. 在**任意網頁**選取文字（或不選取）
2. 在控制面板點 **📎 截取**
3. 選「截取選取文字」、「截取整頁文字」或「🧩 截取 HTML 區塊」
4. 自動跳轉 Copilot，面板出現貼入提示
5. 點「T1」～「T5」將內容貼入對應任務框

---

## 🔧 版本紀錄

詳見 [CHANGELOG.md](./CHANGELOG.md)

---

## 📄 License

MIT

# iPAS 證照學習筆記

依經濟部 iPAS 能力鑑定官方學習指引整理的重點筆記，搭配歷屆公告試題的測驗與題庫。手機瀏覽器開啟後可「加入主畫面」使用。

## 網站

| 證照 | 級別 | 連結 |
|---|---|---|
| AI 應用規劃師 | 初級、中級 | https://ji0987.github.io/ipas-study/ai-planner/ |

全部證照：https://ji0987.github.io/ipas-study/

## 功能

- 筆記：依級別與科目瀏覽、主題收合、標記已讀、進度環、全文搜尋、速查表、列印
- 測驗：從該級別題庫隨機抽 10 題，附詳解
- 題庫：逐題瀏覽，可篩選圖片題／程式碼題、搜尋、加書籤
- 進度備份：匯出／匯入已讀紀錄與書籤，方便換裝置
- 快捷鍵：`⌘K`／`Ctrl+K` 指令面板、`Q` 測驗、`B` 題庫、`C` 速查表、數字鍵切換科目

學習進度只存在各自瀏覽器的 localStorage，不會上傳。

## 開發

需要 Node.js 22 以上。

```bash
npm install
npm run validate   # 驗證題庫與設定
npm run build      # 驗證後建置到 dist/
```

`dist/` 需透過網址開啟（題庫以 fetch 載入），本機可用任一靜態伺服器，例如在專案根目錄執行 `python -m http.server`，再開 `http://localhost:8000/dist/`。

推送到 `main` 後，GitHub Actions 會自動建置並部署到 GitHub Pages。

### 結構

```
engine/          共用引擎：頁面模板、標記產生器、樣式、執行期 JS 模組
certs/<證照>/    證照內容：config.json、notes/<科目>/<主題>.html、cheatsheet.html、quiz/<科目>.json
schema/          config 與題庫的 JSON Schema
scripts/         驗證腳本與一次性轉換工具
build.mjs        建置
legacy/          舊版單檔筆記（僅供參考）
```

新增證照：在 `certs/` 下建立新目錄，照 `schema/` 的格式放入 config、筆記片段與題庫，建置時會自動加入首頁列表。

## 資料來源

筆記內容整理自 iPAS 官方學習指引，題庫取自官方公告試題，著作權屬原權利人。本專案為非營利的個人學習整理，如有錯誤或權利疑慮請開 issue。

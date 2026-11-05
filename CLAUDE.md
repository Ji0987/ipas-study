# CLAUDE.md — ipas-study

結構、功能與指令見 README.md；本檔只記從程式碼看不出來的決定與流程。

## 檔案位置

- `materials/` 和 `exports/` 都是目錄連結，都不進版控，實際檔案在 `C:\Users\a0982\Documents\學習資料\iPAS\`。放在 Documents 是為了靠 Google 雲端硬碟備份，也能在其他裝置整理或列印。不要在這個 repo 執行 `git clean -x`。
  - `materials/<證照>/`：外部教材的正本，例如官方指引、歷屆試題、非官方題庫。新教材直接放這裡，不要另存複本。
  - `exports/<證照>/`：自己產生、能重新產生的成品。`模擬卷` 由 `scripts/make-exams.mjs` 從 repo 題庫產生；`ai-planner/模擬卷-輔考小老師` 由 `extract-tutor900.py` 解析 materials 的 900 題 PDF 後交給同一支腳本，指令見 README。重產會先清掉資料夾裡舊的分回 PDF。
- 模擬卷排版以列印省紙為準（使用者偏好原 AIoT 版）：答案縮在最後一頁底部，不另起作答頁或答案頁。使用者用合併檔雙面、每面兩頁列印，4 頁一張紙：每回必須剛好 4 頁（放不下才 8 頁），5 頁浪費一張紙，3 頁則空間利用不佳。
- 重製前的單檔 HTML 原版與一次性轉換腳本（`legacy/`、`scripts/migrate-legacy.mjs`、`scripts/extract-pdf-text.py`）已在 2026-11-04 刪除，需要時從 git 歷史取回（commit `fceb117` 還有）。
- 本機預覽：`.claude/launch.json` 的 `ipas-static`（port 8321），開 `/dist/<證照>/index.html`。dist 要透過網址開啟，直接雙擊無法 fetch 題庫。

## 部署

- 推送 `main` 後，GitHub Actions 會驗證、建置並部署到 GitHub Pages。
- 使用者授權：功能完成並驗證後，直接 commit、push `main`，不用逐次詢問；push 後確認 Actions 成功，並檢查線上網站。

## 技術決定（改動前先問使用者）

- 只用 HTML、CSS、vanilla JS 與 esbuild，不用框架；完整保留舊版的設計語言與互動。
- 閃卡功能已刪除，不要加回來。
- 頁面上的 inline 呼叫（`onclick="switchSub(...)"`、筆記裡的 `copyFm(...)` 等）由 `engine/js/main.js` 掛到 `window`；新增 inline 呼叫時要一併登記。
- 每張證照的進度只存一筆，key 是 `ipas:<證照>`，內容為 `{ version, read, bookmarks, answers, exams }`。資料升級靠 `version`；匯出、匯入都是整包 JSON。
- 題庫 JSON 一筆資料一行，讓 git diff 讀得懂。
- 每題必有以下欄位：
  - `id`：帶證照前綴，例如 `aip-q-0001`。作答紀錄靠它對應，不可以用陣列索引。
  - `topic`：筆記主題 id，同級別內可以跨科目指定。
  - `src`：`official`、`guide` 或 `self`。
  - `exp`：詳解。
- 附圖用 `figs:[{src:"img/…", at:"ctx|stem|A-D"}]`，檔案放在 `certs/<證照>/img/`。題組共用的情境放 `ctx`，出處放 `ref`（例如 `115-1 s2 8`）。舊題保留 `img`、`code`、`codeOpts`。
- config 設 `practical: true` 代表術科，不列入模擬考與雷達圖；只有一個級別時，自動隱藏級別切換。
- 詳解由 Claude 撰寫時，不另加標記（使用者決定）。

## 新增官方試題

1. 新試卷的 PDF 放進 `materials/<證照>/<級別>/歷屆試題/`。
2. 執行 `python scripts/extract-official.py [<證照>]`，用 PyMuPDF 依版面切成單題；浮水印以圖片雜湊排除。
3. 執行 `node scripts/import-official.mjs [<證照>]`，找出還沒收錄的題目，輸出到 `.cache/official/pending.md`。
4. 逐題寫進 `scripts/official-additions*.json`，`topic` 和 `exp` 必填。抽取有誤時，看原頁面用 `stem`、`opts`、`ctx`、`figs` 覆寫，常見情況：
   - 題幹內含「(A)」
   - 題組說明句不含「請根據」
   - 程式碼圖跨頁
5. 再跑一次 import（用 `ref` 防止重複匯入），最後 `npm run validate`。

AIoT 的特殊流程：
- 學習指引練習題用 `extract-guide.py aiot` → `import-guide.mjs aiot`。
- 舊版試題逐卷用 `list-pending.mjs aiot <試卷> <iot1|iot2>` 列出，再用 `merge-additions.mjs` 併入。
- 匯入時會自動排除三種題目：
  - 歷屆重複題：題幹與選項的 bigram Jaccard 都 ≥0.6，只留最新一次。
  - 與指引練習題重複的題目。
  - 疑義「皆給分」題。

## AIoT 範圍判定

- 考科二沿用舊版「物聯網應用工程師（初級）」的科目二。使用者判斷兩者相同，可以互相抵免。
- 舊科目一的題目逐題對照 AIoT 考科一的評鑑內容，以下不收（在 additions 記 `skip` 理由）：
  - 電磁輻射物理
  - NCC 法規條文
  - EPCglobal 標準細節
  - GPS／RTLS 定位原理

  iBeacon、UWB、RFID、NFC 照收。
- 考科二的題目一律用考科二的主題，唯一例外是 AI 模型訓練題指到 `ai-basic`。其餘主題指派：
  - 應用領域 → `aiot-cases`
  - TCP/IP、MQTT、5G → `iot-protocol`
  - OPC UA、Modbus → `ind-std`
  - 雲端、邊緣 → `middleware`
  - 感測器原理 → `sensor-basic`
  - 訊號、OSI → `sensor-signal`
- 非官方筆記（ZEO-Lab、阿淳 HackMD）只作參考、不照抄，因為 repo 公開，著作權屬原作者。術科還是佔位頁。

## 分工

查教材、出新題、對照勘誤表這類內容工作，使用者可能在 claude.ai 做，再帶結構化資料回來合併。需要補內容時，可以列出需求清單給使用者。

# 世界八大經典棋藝對戰館

免安裝、免登入，打開網頁就能和電腦對下八種經典棋：

**黑白棋 · 中國象棋 · 圍棋 · 五子棋 · 國際跳棋 · 西洋棋 · 日本將棋 · 雙陸棋**

▶ **線上試玩：https://yehtech.github.io/board-arena/**

## 功能

- 四種電腦難度：簡單／普通／困難／大師
- 點一下棋子就標出所有合法走法與可吃的子
- 單人悔棋、大師提示、AI 導師復盤
- 棋譜回放與分享連結
- 規則教學與每日殘局
- 繁體中文／English、深色／淺色主題、手機可玩

## 本機執行

不需要安裝任何東西，直接用瀏覽器開啟 `index.html`，或執行 `play_board_arena.bat`。

規則測試：用瀏覽器開啟 `tests/run-all-rules-tests.html`；AI 難度驗證：`tests/verify-ai-levels.html`。

規則回歸測試（Node.js，不需瀏覽器）：

```
node tests/node/rules-regression.test.js      # 跳棋 perft 預設驗到第 5 層
node tests/node/rules-regression.test.js 7    # 驗到第 7 層（約 20 秒）
```

棋力量測（自我對戰，估計各難度之間的等級分差）：

```
node tests/strength/elo-ladder.js --games=24            # 內建 JS AI，8 種棋 × 相鄰難度
node tests/strength/elo-ladder.js --only=go --games=40  # 只量圍棋
```

結果寫入 `tests/strength/results/latest.md`。西洋棋／象棋／將棋的引擎難度要在瀏覽器量：用本機 HTTP 伺服器開啟 `tests/strength/engine-ladder.html?games=8`。

## 規則與驗證

| 棋種 | 依據 | 驗證方式 |
|---|---|---|
| 西洋棋、象棋、將棋 | FIDE／亞洲象棋規則／日本將棋聯盟 | 3 萬多個隨機局面的合法走法與 Fairy-Stockfish 逐一比對，零差異（將棋打步詰除外，見下） |
| 國際跳棋 | FMJD：有吃必吃、**最多吃子**、被吃子於連跳結束才移除、連跳途中不升王 | 起始局面 perft 1–7 層與公開數值完全一致（9 / 81 / 658 / 4,265 / 27,117 / 167,140 / 1,049,442） |
| 將棋 | 二步、死格、強制升變、**打步詰**、**千日手**（同局面 4 次和棋，連續王手方判負） | 指定局面測試；Fairy-Stockfish 的 perft 會列出打步詰，但搜尋時視為輸棋而不會走，與本專案「禁止」的處理一致 |
| 象棋 | 蹩馬腿、塞象眼、飛將、困斃判負、**長將判負**（同局面 3 次） | 指定局面測試 |

已知限制：象棋「長捉」細則尚未實作（重複局面若非長將一律判和）。

## 電腦對手

| 棋種 | 簡單／普通 | 困難／大師 |
|---|---|---|
| 西洋棋、中國象棋、日本將棋 | 內建 JS AI | **Fairy-Stockfish**（WebAssembly，在玩家瀏覽器內執行） |
| 圍棋 | 蒙地卡羅樹搜尋（UCT + RAVE，`js/ai/go-mcts.js`），模擬次數隨難度增加 | 同左，大師每步約 1 秒（9 路約 1.2 萬次模擬） |
| 黑白棋、跳棋、五子棋、雙陸棋 | 內建 JS AI | 內建 JS AI（迭代加深，大師每步約 1 秒） |

- Fairy-Stockfish 需要瀏覽器支援「跨來源隔離」。網站透過 `coi-sw.js`（Service Worker）補上必要標頭，**第一次造訪會自動重新整理一次**。
- 不支援的環境（舊瀏覽器、直接用 file:// 開檔、記憶體不足）會自動改用內建 AI，不影響遊玩。
- 直接開 `index.html` 不會啟用引擎；要在本機測試引擎，請用本機 HTTP 伺服器（localhost）開啟。

**原生棋力引擎（選用，僅限本機）**：在本機執行 `start_multiplayer_server.bat` 啟動伺服器後，電腦對手會改用 `engines/` 資料夾內的原生引擎（例如 Fairy-Stockfish、Edax）。引擎執行檔不放在 repo 內，需自行下載。

## 授權

- `js/vendor/fairy-stockfish/`：[Fairy-Stockfish](https://github.com/fairy-stockfish/fairy-stockfish.wasm) WebAssembly 版（npm `fairy-stockfish-nnue.wasm` 1.1.12），GPL-3.0，授權全文與作者名單見同資料夾 `Copying.txt`、`AUTHORS`。原始碼：https://github.com/fairy-stockfish/fairy-stockfish.wasm

## 功能開關

| 開關 | 位置 | 目前 | 說明 |
|---|---|---|---|
| `ADS_MASTER_SWITCH` | `js/ads-manager.js` | `false` | 廣告總開關。開啟前請先換上正式的 AdSense Publisher ID |
| `ONLINE_PVP_ENABLED` | `js/app.js` | `false` | 雙人連線、登入、排行榜。需要先完成真正的連線後端 |

## 開發中

- 真人連線對戰（登入 + 即時同步棋步）
- `server/`、`deploy/` 為連線伺服器的雛形，尚未可用於正式環境

## 問題回報

請到 [GitHub Issues](https://github.com/Yehtech/board-arena/issues)。

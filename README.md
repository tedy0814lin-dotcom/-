# 籌碼雷達

自己的股票＋加密貨幣籌碼搜尋器。有帳號密碼登入，手機和電腦都能用。

- **加密貨幣**：幣安永續合約成交額前 50 名，看持倉量變化、大戶多空比、散戶多空比、資金費率、主動買賣比，每 5 分鐘自動更新。
- **台股（上市）**：三大法人近 5 日買賣超、連買連賣天數、融資融券增減，每天收盤後更新。
- 自動標出「大戶增倉做多」「投信連買」「籌碼集中」等訊號，可以點選篩選。

---

## 架站教學（第一次大約 20 分鐘，全部免費）

需要一台電腦。整個過程只用瀏覽器，不用安裝任何程式。

### 第 1 步：把檔案放上 GitHub

GitHub 是放程式碼的地方，像程式專用的雲端硬碟。

1. 先把下載的 `whale-radar.zip` 解壓縮，會得到一個 `whale-radar` 資料夾。
2. 到 <https://github.com/signup> 註冊帳號。
3. 登入後點右上角 **＋** → **New repository**。
4. Repository name 填 `whale-radar`，選 **Private**（只有你看得到），按 **Create repository**。
5. 在新頁面找到藍色小字 **uploading an existing file**，點進去。
6. 打開電腦裡的 `whale-radar` 資料夾，**全選裡面所有東西**（`api`、`lib` 兩個資料夾和其他檔案），一起拖進網頁的框框。
7. 等檔案都列出來後，按最下面綠色的 **Commit changes**。

上傳完，GitHub 頁面上應該看得到 `api`、`lib`、`app.js`、`index.html` 等檔案。

### 第 2 步：用 Vercel 把它變成網站

Vercel 會讀你 GitHub 上的檔案，自動架成一個網站。

1. 到 <https://vercel.com/signup>，選 **Hobby**（免費），用 **Continue with GitHub** 登入。
2. 點 **Add New…** → **Project**，在清單裡找到 `whale-radar`，按 **Import**。（看不到的話，點 Adjust GitHub App Permissions 允許它讀取這個 repository。）
3. Framework Preset 保持 **Other**，其他都不用改。
4. 展開 **Environment Variables**（環境變數），新增三個：

   | Key（名稱） | Value（值） |
   |---|---|
   | `APP_USERNAME` | 你想要的帳號，例如 `zicheng` |
   | `APP_PASSWORD` | 你想要的密碼，越長越好 |
   | `SESSION_SECRET` | 隨便亂打 32 個以上英文數字，例如 `k29Dla8xQm...`，不用記 |

   帳號密碼放在這裡，不會出現在程式碼裡，所以就算別人看到程式碼也不知道你的密碼。

5. 按 **Deploy**，等 1 分鐘左右出現彩帶畫面就完成了。

### 第 3 步：開始用

1. 點 **Continue to Dashboard**，上面的 **Domains** 就是你的網址，長得像 `whale-radar-xxxx.vercel.app`。
2. 手機打開那個網址，輸入帳號密碼登入。登入後會記住 30 天。
3. 建議在手機瀏覽器選單按 **加到主畫面**，之後就像 App 一樣一鍵打開。

---

## 遇到問題

| 看到的狀況 | 原因與解法 |
|---|---|
| 登入時說「網站還沒設定帳號密碼」 | 環境變數沒設好。到 Vercel 專案 → Settings → Environment Variables 補上三個，再到 Deployments 點最新一筆右邊 **⋯** → **Redeploy**。 |
| 加密貨幣上方寫「由你的瀏覽器直接抓取」 | 正常。代表 Vercel 的伺服器被幣安擋了，網站自動改用你的手機去抓，資料一樣是即時的。 |
| 台股顯示「抓不到證交所資料」 | 證交所偶爾會擋太頻繁的請求，等幾分鐘再按重新整理。持續失敗的話，把錯誤訊息整句貼給 Claude。 |
| 台股是昨天的資料 | 證交所每天約 15:00–16:30 才公布當天資料，在那之前看到的是前一個交易日。 |
| 想改帳號或密碼 | 改 Vercel 的環境變數，然後 Redeploy。 |

## 之後要改網站

在 GitHub 上點檔案 → 右上角鉛筆圖示 → 修改 → **Commit changes**。Vercel 會在一分鐘內自動更新網站，不用重新設定。

---

## 每個檔案在做什麼（學習地圖）

網站分成兩半：**前端**是你在手機上看到的畫面，**後端**是在 Vercel 伺服器上幫你去交易所抓資料的程式。

```
whale-radar/
├── index.html      前端：主畫面的骨架（頁首、分頁、搜尋框、指標說明）
├── login.html      前端：登入頁
├── style.css       前端：所有顏色、字體、版面（想改顏色從這裡開始）
├── app.js          前端：抓資料、畫卡片、搜尋、排序、篩選
├── lib/
│   └── cryptoCore.js   加密貨幣的計算與訊號規則（前後端共用）
├── api/            後端：每個檔案就是一個網址
│   ├── _lib.js         共用工具：登入憑證、抓資料（底線開頭不會變成網址）
│   ├── login.js        /api/login   檢查帳號密碼
│   ├── logout.js       /api/logout  登出
│   ├── me.js           /api/me      確認是否已登入
│   ├── crypto.js       /api/crypto  幣安籌碼資料
│   └── twstock.js      /api/twstock 證交所法人與融資融券
├── vercel.json     Vercel 設定（伺服器放在東京、執行時間上限）
└── package.json    專案基本資料
```

**建議的學習順序**

1. 改 `style.css` 裡最上面的顏色（例如 `--accent`），commit 後看網站變化。這是最快有成就感的地方。
2. 讀 `lib/cryptoCore.js` 的 `cryptoSignals`，把「持倉 24h 增加 5%」改成 3%，看訊號數量怎麼變。這裡就是你的交易邏輯。
3. 讀 `api/twstock.js` 的訊號區塊，試著加一個自己的訊號，例如「自營商連買」。
4. 用瀏覽器直接打開幣安的資料網址看原始資料長怎樣，例如 <https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=5>。

## 可以再加的功能

- 期交所：外資台指期未平倉、大額交易人（看整體大盤方向）
- 上櫃（櫃買中心）股票
- 訊號出現時傳 Telegram 或 LINE 通知
- 點進單一標的看更長期的圖表

---

籌碼只是線索，不保證漲跌。資料來自交易所公開資料，可能延遲或出錯。Vercel Hobby 方案限個人非商業使用，之後如果要開放給學員收費，要升級方案。

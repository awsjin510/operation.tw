# AI56｜AWS × Salesforce 跨雲整合：企業資料不再搬家的時代來臨

> 9月Dreamforce大會上，AWS與Salesforce宣布三層打通合作：資料層零複製、AI代理層、通訊層互通。這不只是技術更新，而是企業雲端進入「跨雲整合」時代的戰略信號，對台灣聯絡中心與業務團隊有實際影響。

- 網址：https://operation.tw/post/401/
- 作者：Jin（https://operation.tw/about/）
- 分類：雲端
- 發布：2026-09-16　最後更新：2026-09-28
- Podcast 單集：AI56趨勢操作｜資料不再搬家：AWS × Salesforce 三層打通，企業雲端進入「跨雲整合」時代（Apple Podcasts：https://podcasts.apple.com/tw/podcast/id1620760720?i=1000790225787）
- 引用時請標明來源：操作一下 operation.tw

---

**重點整理**

- AWS與Salesforce的三項深度合作打通資料層、代理層、通訊層，標誌著企業雲端從「多雲」進入「跨雲整合」時代
- 零複製（Zero Copy）技術讓資料直接被讀取而無需同步或複製，解決企業廿年來的資料流動瓶頸
- AI代理進Slack、Agentforce Voice整合Amazon Connect等創新，重組企業流程而非只是省時間，對聯絡中心與銷售團隊有立即應用價值

## 為什麼企業資料流動一直這麼困難？

傳統情況下，企業要從Salesforce業務系統拉資料到AWS做分析，需要走API串接、排程設定、ETL工具三個流程，往往需要等待三週以上、經過七個以上系統，最後產出的數據還會被同事質疑準確性——這就是多雲時代的典型痛點。根據9月15日Dreamforce開場的宣布，AWS與Salesforce決定從根本上改變這個局面。

## 零複製（Zero Copy）真正改變了什麼？

零複製是指Salesforce Data Cloud裡的資料可以直接被Amazon QuickSight讀取，完全不需要複製或同步過程。這項技術背後採用Apache Iceberg這個開放標準，讓多個雲端服務能在共同的資料格式上工作，而不是各自維護一套複本。簡單來說，從前IT部門要做資料工程師的繁重工作，現在資料就地共享，業務部門可以更快取得所需資訊進行分析決策。

## AI代理進Slack代表企業流程怎樣的改變？

這不只是省時間，而是流程的本質重組。AWS Bedrock上的AI代理現在可以直接掛進Slack頻道，員工一句話就能在AWS後端跑完整套業務流程——像是查詢訂單、修改記錄、發動工作流。這意味著過去需要員工在多個系統間切換操作的事務，現在可以在溝通工具內直接完成，大幅降低操作複雜度。

## Agentforce Voice與Amazon Connect整合對台灣企業的實際影響是什麼？

Agentforce Voice與Amazon Connect的即時雙向互通，讓AI客服能夠智慧地判斷是否需要轉接真人或開啟工單，這對台灣聯絡中心與客服營運特別重要。台灣的聯絡中心通常同時處理大量電話與文字互動，這項整合讓企業可以用單一AI系統跨越語音與文字介面，減少客服培訓與系統維護成本，同時提升客戶體驗。

## 跨雲整合時代的採購邏輯怎麼運作？

傳統採購中，企業要同時向AWS與Salesforce採購，會面臨各自計費、各自簽約的行政複雜性。這次合作引入合併計費邏輯，讓企業用單一使用者認證和統一計費模式購買跨雲服務，大幅降低採購門檻。這對中小型企業與新創特別有利，因為不再需要IT部門花時間協調多家雲端廠商的合約細節。

## 企業雲端進化的三個階段是什麼？

第一階段是「搬上雲」（2010年代初），企業從本地伺服器遷移到單一雲端；第二階段是「多雲」（2015-2020年代），企業為了避免廠商綁定而同時使用多家雲端服務；第三階段是「跨雲整合」（2024年起），企業不再簡單地共存多雲，而是讓不同廠商的服務深度連結、流暢互通。AWS與Salesforce的這次宣布就是第三階段的標誌性事件。

## 這波更新後企業該如何提前佈局？

通常宣布到實際落地會有半年落差，聰明的企業現在就可以開始評估。IT主管應該審視現有Salesforce與AWS使用情況；雲端架構師可以開始規劃零複製的架構方案；行銷與業務應該評估AI代理進Slack能帶來的流程優化；聯絡中心營運團隊應該啟動對Agentforce Voice的試點計畫。同時，這也是學習新技能的好時機——「AI整合工程師」與「跨雲代理架構師」這類職位會逐漸浮現。

## 常見問題

### Salesforce資料怎樣直接被AWS讀取而不複製？

透過Apache Iceberg開放標準，Salesforce Data Cloud與Amazon QuickSight能共用同一份資料格式，無需建立複本，QuickSight可直接查詢源資料進行分析。

### AI代理在Slack裡能執行什麼操作？

AWS Bedrock上的AI代理可在Slack內執行後端流程，包括查詢數據、修改記錄、觸發自動化工作流等，員工無需切換系統即可完成任務。

### 跨雲整合會增加還是降低企業成本？

合併計費與零複製技術能降低採購行政成本與重複資料存儲成本，但具體ROI取決於企業現有架構；建議先從試點項目評估實際效益。

---

📚 **同主題的其他單集 / 文章，延伸聽下去：**

- [Neoclouds崛起：AI時代雲端新勢力如何挑戰AWS宰制局面](https://operation.tw/post/397/)

- [小型高效AI模型崛起：為什麼2027年是雲端成本結構的分水嶺？](https://operation.tw/post/394/)

- [Anthropic砸千億美元投資AWS：AI晶片戰爭延燒至雲端基礎設施](https://operation.tw/post/391/)

🎙 **這篇文章延伸自 Podcast《操作一下》。**想用聽的，完整一集在這裡：

- [在 SoundOn 收聽這集](https://player.soundon.fm/p/aa7727c5-7aa2-4403-8a87-b91a8d842f7b/episodes/48929925-4ac6-44ba-aabe-cdf89d7a3bd6)

- [在 Apple Podcast 收聽](https://podcasts.apple.com/tw/podcast/id1620760720?i=1000790225787)

- [在 Spotify 收聽](https://open.spotify.com/search/AI56%E8%B6%A8%E5%8B%A2%E6%93%8D%E4%BD%9C%EF%BD%9C%E8%B3%87%E6%96%99%E4%B8%8D%E5%86%8D%E6%90%AC%E5%AE%B6%EF%BC%9AAWS%20%C3%97%20Salesforce%20%E4%B8%89%E5%B1%A4%E6%89%93%E9%80%9A%EF%BC%8C%E4%BC%81%E6%A5%AD%E9%9B%B2%E7%AB%AF%E9%80%B2%E5%85%A5%E3%80%8C%E8%B7%A8%E9%9B%B2%E6%95%B4%E5%90%88%E3%80%8D%E6%99%82%E4%BB%A3)

- [瀏覽所有單集 →](https://operation.tw/podcast.html)

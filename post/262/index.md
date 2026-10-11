# AI14｜OpenAI 登上 AWS、S3 三分裂——雲端 AI 代理平台的版圖正在重畫

> 微軟用百億美金把 OpenAI 綁在 Azure 上的時代，正悄悄鬆動。OpenAI 旗艦模型登上 Amazon Bedrock，同一天 AWS 把 S3 升級成三個全新服務。這幾條新聞單看都像平常的雲端公告，但拼在一起，你會看到 AWS 正把自己從「賣 GPU 主機的雲端商」，升格為 AI 代理的核心工作台。這篇文章帶你把這張拼圖拆開來看。

- 網址：https://operation.tw/post/262/
- 作者：Jin（https://operation.tw/about/）
- 分類：雲端
- 發布：2026-05-06
- Podcast 單集：AI14_雲端操作 | OpenAI登上AWS Bedrock、S3 全面升級——AWS 把 AI 代理平台收攏了（Apple Podcasts：https://podcasts.apple.com/tw/podcast/id1620760720?i=1000766524093）
- 引用時請標明來源：操作一下 operation.tw

---

## 一條被默默撬開的鐵律

過去三年，有一個問題的答案幾乎是業界共識：OpenAI 跑在 Azure 上。微軟用百億美金的獨家授權把這個關係綁得很死，Azure 也靠著這張牌在企業 AI 採購裡拿到了不少先機。但這個局面，在最近這週被幾則看似不相關的新聞悄悄撬開了。

第一條：OpenAI 與微軟的排他關係鬆綁，旗艦模型正式登上 Amazon Bedrock。第二條：AWS 同一天宣布把 S3 升級，拆出三個新的服務形態——S3 Files、S3 Tables、S3 Vectors。單看任何一條，你可能會覺得「好，又一則雲端公告」。但這集 Podcast 想做的事，是把這幾條新聞放在同一個框架裡看，畫面就完全不一樣了。

## AWS 在下一盤什麼棋？

Amazon Bedrock 本來就是 AWS 的多模型代管平台，讓企業不用自己管模型基礎設施，直接呼叫 API 就好。過去 Bedrock 上有 Anthropic 的 Claude、Meta 的 Llama 等選擇，但就是缺了 OpenAI 這塊。現在 OpenAI 補上來，Bedrock 的牌面一口氣完整了很多。

但更值得注意的，是 S3 的這次升級。S3 是一個誕生超過二十年的老服務，本質上就是物件儲存——你丟檔案進去、需要時取出來。但 AI 代理的工作流需要的不只是「存檔案」，它需要結構化資料、需要向量資料庫來做語意搜尋，也需要更靈活的檔案操作介面。

這次 S3 分出來的三個面向，剛好就是對應這三塊需求：S3 Files 強化了檔案層的操作彈性，S3 Tables 讓結構化資料的查詢更直接，S3 Vectors 則是直接把向量儲存整進來。過去這些能力你得東湊西湊，串 RDS、串 OpenSearch、串外部向量庫。現在 AWS 把它們收進同一個屋簷下，AI 代理要存記憶、查知識庫、處理文件，理論上都可以在 S3 生態裡一條龍完成。

## 三朵雲現在各自站在哪裡？

這集也盤了一下三大雲端現在的位置。簡單說：Azure 靠著 OpenAI 的先發優勢，在企業端建立了不少黏性，Microsoft 365 Copilot 的整合也讓它在辦公室場景裡有護城河。Google Cloud 則是自家模型 Gemini 加上 BigQuery 的資料優勢，在分析型 AI 工作負載上有一定競爭力。

AWS 的盤算比較不一樣——它沒有自己的明星消費端模型，但它有最大的企業雲端市佔、最成熟的基礎設施生態，以及現在這個正在成型的「AI 代理工作台」定位。OpenAI 登上 Bedrock 這一步，讓 AWS 可以對企業客戶說：你要用哪個模型都好，工作流、儲存、運算，都在我這裡。

## 對台灣 IT 採購的三個實際影響

如果你在台灣負責 IT 採購或技術選型，這些變化有幾個值得注意的地方。第一，模型供應商和雲端供應商之間的排他性正在降低，你選 AWS 不再等於放棄 OpenAI，評估時可以把這兩個維度分開來看。第二，S3 Vectors 這類向量儲存的整合，對正在評估 RAG 架構或 AI 知識庫的團隊來說，可能減少需要額外維護的元件數量，值得納入架構討論。第三，Bedrock 的多模型策略讓廠商鎖定的風險稍微降低，但也意味著你需要更清楚地定義自己的評估標準，而不是靠生態綁定做決策。

## 這不是一則新聞，是一個方向

雲端的新聞很容易讓人感覺每週都在刷新、每週都很重要，但大多數時候只是功能更新。這次不太一樣。OpenAI 鬆綁、S3 重新定義、Bedrock 補齊牌面，這幾件事加在一起，比較像是 AWS 在 AI 代理時代完成了一次關鍵的卡位動作。這集 Podcast 想傳達的核心觀點就是這個——不要只看單則新聞，要看它們拼在一起的那張圖。

---

📚 **同主題的其他單集 / 文章，延伸聽下去：**

- [歐洲雲端反擊戰：OVHcloud邊緣AI如何撼動美國雲端巨頭壟斷？](https://operation.tw/post/139)

- [雲端投資者戰爭：帕蘭泰爾揭露AI新創融資黑幕](https://operation.tw/post/135)

- [AWS二十週年里程碑：從內部工具到雲端帝國的演進之路](https://operation.tw/post/134)

🎙 **這篇文章延伸自 Podcast《操作一下》。**想用聽的，完整一集在這裡：

- [在 Apple Podcast 收聽](https://podcasts.apple.com/tw/podcast/id1620760720?i=1000766524093)

- [在 SoundOn 收聽這集](https://player.soundon.fm/p/aa7727c5-7aa2-4403-8a87-b91a8d842f7b/episodes/a194f22c-b379-4851-9f99-c07adae85a3e)

- [在 Spotify 收聽](https://open.spotify.com/search/AI14_%E9%9B%B2%E7%AB%AF%E6%93%8D%E4%BD%9C%20%7C%20OpenAI%E7%99%BB%E4%B8%8AAWS%20Bedrock%E3%80%81S3%20%E5%85%A8%E9%9D%A2%E5%8D%87%E7%B4%9A%E2%80%94%E2%80%94AWS%20%E6%8A%8A%20AI%20%E4%BB%A3%E7%90%86%E5%B9%B3%E5%8F%B0%E6%94%B6%E6%94%8F%E4%BA%86)

- [瀏覽所有單集 →](https://operation.tw/podcast.html)

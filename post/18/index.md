# 告別 Excel 人肉比價！CloudCost 助你一眼看穿跨雲價差，精準掌握預算！

> 這週完成的另外一個Side Project｜CloudCost 一鍵跨雲比價，找出最划算的雲端方案！

- 網址：https://operation.tw/post/18/
- 作者：Jin（https://operation.tw/about/）
- 分類：AI
- 發布：2026-03-01
- 引用時請標明來源：操作一下 operation.tw

---

## 這週完成的另外一個Side Project｜CloudCost 一鍵跨雲比價，找出最划算的雲端方案！

-

> 「這些機器規格到底哪家雲比較便宜？差距多少？」相信這個問題不管是業務、PM還是架構師都很常被問到。

以前的流程是這樣的：

打開 AWS Pricing 頁面 → 找到對的 Region、機型、OS → 換算成月費 → 再打開 GCP 頁面重來一遍 → Azure 再一遍  → 開 Excel 把數字貼進去 → 還要自己算 Reserved 打折後到底省多少 → 還要記得換算台幣才知道預算夠不夠 → 然後主管說「Oracle 好像也可以考慮？」，整個流程再跑一次。

CloudCost，就是一個可以同時可以快速比較 AWS、GCP、Azure、Oracle 費用的工具，即使業務在外面跑，只要手機開個網頁就能快速比價。

輸入機器規格（CPU / RAM / 儲存 / 流量），選好「多台機器模式」，把 Web Server、DB、Cache 各別設好角色，

畫面上直接列出四家的月費，還有 On-Demand vs Reserved 1 年的差異，旁邊還幫你換算好台幣。

馬上就看到：Oracle 在哪個規格下比 AWS 便宜快 40%，但他的產品有搭配 Microsoft 工具，Azure 加上 Hybrid Benefit 折扣反而比想像中便宜。

當機器數量一多，以前可能要花很多時間，現在五分鐘內有答案，價格來源也是直接串4個美國雲的API，版本是2026/2月的版本。

更有 AI 分析模式：除了報價，還會告訴你「Reserved 折扣夠不夠大、值不值得鎖定」、「Spot Instance 適不適合你的場景」，以及很多人漏算的隱藏費用（NAT Gateway、跨 AZ 流量、Load Balancer 小時費……）等等，補充提醒各種情境。

最後也可以把當下的比較結果，打包成連結分享，直接丟給客戶參考，節省許多反覆操作的時間。

Cloudcost連結(持續優化中)：[https://awsjin510.github.io/cloudcost/](https://awsjin510.github.io/cloudcost/?fbclid=IwZXh0bgNhZW0CMTAAYnJpZBExQ1VCZ2VEMGNPc0dIT0R0QnNydGMGYXBwX2lkEDIyMjAzOTE3ODgyMDA4OTIAAR69NL2qqO249abRCfByTEGFSdt9FMkIysqWYVvEKti6yJAyWylidAcld0zkCA_aem_9WDJv1VaIVqmuMjQgaDzqg)

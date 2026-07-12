(function(){
  'use strict';
  const escText=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const strip=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const date=s=>String(s||'').slice(0,10);
  const readingTime=p=>Math.max(3,Math.ceil(strip(p.content||p.body||p.excerpt||'').length/450));
  const postUrl=p=>'/post/'+encodeURIComponent(p.slug||p.id)+'/';
  const normalizeCat=c=>c==='雲端'?'Cloud':c==='資安'?'Cyber Security':c;
  // 單集標題開頭的真實集數碼（EP59、AI41…）；沒有就退回推算值
  const epCode=(title,fallback)=>{const m=String(title||'').match(/^[A-Za-z]{1,4}\d{1,4}/);return m?m[0]:'EP.'+fallback;};
  function article(p,feature){
    if(!p)return '';
    const href=postUrl(p),img=p.image||('/images/posts/post-'+p.id+'.jpg');
    // 整張卡片本身就是 <a>：不依賴絕對定位的空浮層，CSS 沒載到也一樣可點
    return '<a class="op-article'+(feature?' op-article-feature':'')+'" href="'+escText(href)+'" aria-label="閱讀：'+escText(p.title)+'"><div class="op-article-img"><img src="'+escText(img)+'" alt="'+escText(p.title)+'" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'/default.png\'"></div><div class="op-article-body"><div class="op-article-meta"><span class="op-category">'+escText(normalizeCat(p.category))+'</span><span>'+escText(date(p.date))+'</span><span>'+readingTime(p)+' 分鐘</span>'+(p.views>0?'<span>'+p.views+' 次瀏覽</span>':'')+'</div><h3>'+escText(p.title)+'</h3><p>'+escText(strip(p.excerpt))+'</p></div></a>';
  }
  function sectionHead(eyebrow,title,desc,link,label){return '<div class="op-section-head"><div><div class="op-eyebrow">'+eyebrow+'</div><h2 class="op-title">'+title+'</h2>'+(desc?'<p class="op-desc">'+desc+'</p>':'')+'</div>'+(link?'<a class="op-text-link" href="'+link+'">'+label+' <span>→</span></a>':'')+'</div>'}
  async function load(){
    const [pr,er]=await Promise.allSettled([fetch('/posts.json',{cache:'no-cache'}).then(r=>r.json()),fetch('/episodes.json',{cache:'no-cache'}).then(r=>r.json())]);
    const posts=pr.status==='fulfilled'?(pr.value.posts||pr.value||[]):[];
    const episodes=er.status==='fulfilled'?(er.value.episodes||er.value||[]):[];
    // 即時瀏覽數：posts.json 是排程快照，這裡向 Worker 對齊（失敗或舊版 Worker 就用快照值）
    try{
      if(window.api&&api.getPostViews){
        const vm=await api.getPostViews();
        if(vm)posts.forEach(p=>{if(vm[p.id]!=null)p.views=vm[p.id];});
      }
    }catch(_){}
    return {posts:posts.filter(p=>!p.status||p.status==='published'),episodes};
  }
  function platformLinks(ep){
    const links=[];
    if(ep.soundon)links.push(['SoundOn',ep.soundon]);
    if(ep.spot)links.push(['Spotify',ep.spot]);
    return links.map(x=>'<a href="'+escText(x[1])+'" target="_blank" rel="noopener">'+x[0]+'</a>').join('');
  }
  function podcast(ep,others){
    if(!ep)return '';
    return '<section class="op-section op-section-soft" id="podcast"><div class="op-shell">'+sectionHead('Listen','最新 Podcast','把重要科技變化帶進通勤與日常，以聲音快速掌握脈絡。','/podcast.html','所有單集')+'<div class="op-podcast-grid"><div class="op-podcast-feature"><img class="op-podcast-cover" src="'+escText(ep.art||'/logo.jpg')+'" alt="操作一下 Podcast：'+escText(ep.title)+'" loading="lazy"><div class="op-podcast-info"><span class="op-chip">最新單集 · '+escText(date(ep.date))+'</span><h3>'+escText(ep.title)+'</h3><p>'+escText(strip(ep.desc))+'</p><div class="op-actions"><a class="op-btn op-btn-primary" href="'+escText(ep.soundon||'/podcast.html')+'"'+(ep.soundon?' target="_blank" rel="noopener"':'')+'>▶ 播放單集</a></div><div class="op-platforms">'+platformLinks(ep)+'</div></div></div><div class="op-podcast-list">'+others.slice(0,3).map((x,i)=>'<a class="op-episode" href="'+escText(x.soundon||'/podcast.html')+'"'+(x.soundon?' target="_blank" rel="noopener"':'')+'><small>'+escText(epCode(x.title,others.length-i))+'</small><h4>'+escText(x.title)+'</h4><span>'+escText(date(x.date))+' · '+escText(x.dur||'--')+' 分鐘</span></a>').join('')+'</div></div></div></section>';
  }
  function categoryBlock(title,desc,cat,posts,href){
    const items=posts.filter(p=>cat.includes(p.category)).slice(0,3);
    if(!items.length)return '';
    return '<section class="op-category-block"><div class="op-category-head"><div><h3>'+title+'</h3><p>'+desc+'</p></div><a class="op-text-link" href="'+href+'">查看全部 <span>→</span></a></div><div class="op-category-grid">'+items.map(p=>article(p,false)).join('')+'</div></section>';
  }
  function build(data){
    const home=document.getElementById('v-home');if(!home||!data.posts.length)return;
    // 保留 v1「最新文章」區（分類篩選＋文章格＋載入更多＋瀏覽數）：先取參照，重繪後塞回原位
    const legacy=document.getElementById('posts');
    const posts=data.posts,eps=data.episodes,hero=posts[0],featured=posts.slice(0,4);
    const html='<main class="op-home">'+
      '<section class="op-hero"><div class="op-shell op-hero-grid"><div class="op-hero-copyblock"><div class="op-kicker"><i></i>AI · Cloud · Cyber Security · Podcast</div><h1><span>把複雜的科技，</span><span class="op-gradient-text">說得清楚，也說得有用。</span></h1><p class="op-hero-copy">提供 AI、Cloud、Cyber Security、企業科技與數位轉型觀點，幫你用更少時間掌握真正重要的變化。</p><div class="op-actions"><a class="op-btn op-btn-primary" href="#featured">開始閱讀 <span>→</span></a><a class="op-btn op-btn-secondary" href="/podcast.html">▶ 收聽 Podcast</a></div><div class="op-trustline"><span>深度文章</span><span>Podcast</span><span>持續更新</span></div></div><div class="op-hero-visual" aria-label="最新內容"><a class="op-hero-card" href="'+postUrl(hero)+'"><img src="'+escText(hero.image||'/default.png')+'" alt="'+escText(hero.title)+'"><div class="op-hero-card-meta"><span>Latest story</span><span>'+escText(date(hero.date))+'</span></div><h2>'+escText(hero.title)+'</h2><p>'+escText(strip(hero.excerpt))+'</p></a>'+(eps[0]?'<a class="op-hero-podcast" href="/podcast.html"><img src="'+escText(eps[0].art||'/logo.jpg')+'" alt=""><div><span>NEW PODCAST · '+escText(eps[0].dur||'--')+' MIN</span><strong>'+escText(eps[0].title)+'</strong></div><b>▶</b></a>':'')+'</div></div></section>'+
      '<section class="op-stats"><div class="op-shell op-stats-grid"><div class="op-stat"><strong>'+posts.length+' 篇</strong><span>持續更新的深度文章</span></div><div class="op-stat"><strong>'+eps.length+' 集</strong><span>Podcast 聲音內容</span></div><div class="op-stat"><strong>5 大主題</strong><span>AI / 雲端 / 資安 / 閱讀 / 成長</span></div><div class="op-stat"><strong>文章 + 聲音</strong><span>適合不同閱讀情境</span></div></div></section>'+
      podcast(eps[0],eps.slice(1))+
      '<section class="op-section" id="featured"><div class="op-shell">'+sectionHead('Editor\'s picks','精選內容','從近期內容中快速進入最值得關注的科技議題。','#posts','所有文章')+'<div class="op-featured-grid">'+article(featured[0],true)+'<div class="op-featured-side">'+featured.slice(1).map(p=>article(p,false)).join('')+'</div></div></div></section>'+
      '<div id="op-legacy-slot"></div>'+
      '<section class="op-section" id="about"><div class="op-shell"><div class="op-about"><div class="op-about-media"><img src="/profile.jpg" alt="Jin，操作一下作者" loading="lazy"></div><div><div class="op-eyebrow">About Jin</div><h2 class="op-title">我是 Jin，操作一下</h2><p>一位喜歡探索新趨勢、學習新事物的 PM。實踐的過程中，常有朋友問我：「這要怎麼操作？怎麼開始？」網路上的文章總是碎片化、少了整合性，於是我把它們整理成自己的版本，加入實際操作的經驗與觀點——這就是「操作一下」的起點。</p><p>在這裡，我會分享雲端、資安、AI、閱讀與成長各面向的操作，也會邀請各產業的朋友，分享屬於他們領域的學習歷程。願你找到屬於自己最自信的操作方針，並從中感受熱情！</p><div class="op-tags"><span>Cloud</span><span>AI</span><span>Cyber Security</span><span>Podcast</span></div><div class="op-actions"><a class="op-btn op-btn-primary" href="/faq/">常見問題</a><a class="op-btn op-btn-secondary" href="mailto:keepfighting510@gmail.com">合作邀約</a></div></div></div></div></section>'+
      '<section class="op-section" id="newsletter"><div class="op-shell"><div class="op-newsletter"><div class="op-eyebrow" style="justify-content:center">Weekly brief</div><h2 class="op-title">每週用幾分鐘，掌握 AI、雲端與資安的重要變化。</h2><p class="op-desc">精選科技新聞、AI 趨勢分析、Cloud 與資安重點，以及最新 Podcast。</p><div class="op-benefits"><span>精選科技新聞</span><span>AI 趨勢分析</span><span>Cloud 與資安重點</span><span>最新 Podcast</span></div><div class="op-form"><label class="sr-only" for="nl-email">Email</label><input type="email" id="nl-email" placeholder="your@email.com" autocomplete="email"><input type="text" id="nl-hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"><button class="op-btn op-btn-primary" type="button" onclick="nlSubmit()">訂閱電子報</button></div><div class="op-status" id="nl-msg" role="status" aria-live="polite"></div><p class="op-privacy">不發廣告，可隨時取消訂閱；Email 僅用於寄送操作一下內容。</p></div></div></section></main>';
    home.innerHTML=html;
    // 把 v1 最新文章區塞回「依主題探索」的位置，原生篩選/載入更多/瀏覽數全數保留
    const slot=document.getElementById('op-legacy-slot');
    if(slot&&legacy)slot.replaceWith(legacy);
    try{if(typeof D!=='undefined'&&D.posts&&D.posts.length&&typeof renderHome==='function')renderHome();}catch(_){}
  }
  function enhanceNav(){
    // 主題按鈕沿用 SPA 既有的 applyFilterGlobal（回首頁 → 套分類篩選 → 捲到文章區）
    const links=document.querySelector('.nav-links');if(links)links.innerHTML='<button onclick="applyFilterGlobal(\'AI\')">AI</button><button onclick="applyFilterGlobal(\'雲端\')">Cloud</button><button onclick="applyFilterGlobal(\'資安\')">Cyber Security</button><button onclick="applyFilterGlobal(\'閱讀\')">閱讀</button><button onclick="applyFilterGlobal(\'成長\')">成長</button><a href="/podcast.html" class="nav-podcast">Podcast</a><button onclick="goHome();gotoSection(\'about\')">關於我</button><button onclick="goHome();gotoSection(\'newsletter\')">訂閱</button>';
  }
  function enhanceFooter(){
    const f=document.querySelector('footer');if(!f)return;
    f.innerHTML='<div class="op-footer-brand"><div class="logo-text">操作一下</div><p>把複雜的 AI、雲端與資安，用文章與 Podcast 說清楚。</p></div><div class="op-footer-links"><div><h4>主題</h4><a href="/category/AI/">AI</a><a href="/category/%E9%9B%B2%E7%AB%AF/">Cloud</a><a href="/category/%E8%B3%87%E5%AE%89/">Cyber Security</a><a href="/category/%E9%96%B1%E8%AE%80/">閱讀</a><a href="/category/%E6%88%90%E9%95%B7/">成長</a></div><div><h4>探索</h4><a href="/podcast.html">Podcast</a><a href="/faq/">常見問題</a><a href="/glossary/">術語庫</a><a href="mailto:keepfighting510@gmail.com">合作邀約</a><a href="/#newsletter">訂閱</a></div><div><h4>Follow</h4><a href="https://www.instagram.com/operation.tw/" target="_blank" rel="noopener">Instagram</a><a href="https://www.threads.net/@operation.tw" target="_blank" rel="noopener">Threads</a><a href="https://www.youtube.com/@%E6%93%8D%E4%BD%9C%E4%B8%80%E4%B8%8B" target="_blank" rel="noopener">YouTube</a></div></div><div class="op-footer-bottom">© 2025–'+new Date().getFullYear()+' 操作一下 · operation.tw</div>';
  }
  document.addEventListener('DOMContentLoaded',function(){enhanceNav();enhanceFooter();load().then(build).catch(()=>{});});
})();

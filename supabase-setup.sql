-- ============================================================
-- operation.tw — Supabase 資料庫初始化 SQL
-- 請在 Supabase Dashboard → SQL Editor 執行此檔案
-- ============================================================

-- 1. 文章資料表
create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  title       text not null default '',
  category    text not null default 'AI',
  date        date not null default current_date,
  status      text not null default 'draft',
  excerpt     text not null default '',
  image       text not null default '',
  body        text not null default '',
  created_at  timestamptz not null default now()
);

-- 2. 設定資料表（首頁、關於我、頁尾）
create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

-- 3. 開啟 Row Level Security
alter table public.posts    enable row level security;
alter table public.settings enable row level security;

-- ============================================================
-- 4. RLS 政策：anon（一般訪客）只能讀，authenticated（後台登入）才能寫
-- ============================================================

-- 先移除舊的開放政策（如果存在）
drop policy if exists "posts_all"    on public.posts;
drop policy if exists "settings_all" on public.settings;

-- ── posts ──
-- 訪客：只能看「已發布」文章
create policy "posts_public_read"
  on public.posts for select
  to anon
  using (status = 'published');

-- 後台管理員：登入後可讀取全部（含草稿）、新增、修改、刪除
create policy "posts_admin_select"
  on public.posts for select
  to authenticated
  using (true);

create policy "posts_admin_insert"
  on public.posts for insert
  to authenticated
  with check (true);

create policy "posts_admin_update"
  on public.posts for update
  to authenticated
  using (true) with check (true);

create policy "posts_admin_delete"
  on public.posts for delete
  to authenticated
  using (true);

-- ── settings ──
-- 訪客：可讀取所有設定（首頁、關於我、頁尾需要公開顯示）
create policy "settings_public_read"
  on public.settings for select
  to anon
  using (true);

-- 後台管理員：登入後才能修改設定
create policy "settings_admin_all"
  on public.settings for all
  to authenticated
  using (true) with check (true);

-- ============================================================
-- 5. 在 Supabase Dashboard → Authentication → Users
--    手動建立你的管理員帳號（Email + Password）
--    不需要額外設定，登入後即為 authenticated role
-- ============================================================

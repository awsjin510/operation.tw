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

-- 4. 允許 anon 完整存取（admin 目前無驗證機制，與原設計一致）
create policy "posts_all"    on public.posts    for all using (true) with check (true);
create policy "settings_all" on public.settings for all using (true) with check (true);

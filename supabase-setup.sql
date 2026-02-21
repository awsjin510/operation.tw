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

-- ============================================================
-- 6. 瀏覽數功能
-- ============================================================

-- 6.1 文章瀏覽數欄位
alter table public.posts add column if not exists views bigint not null default 0;

-- 6.2 網站總覽表（累積瀏覽 + 今日瀏覽）
create table if not exists public.site_stats (
  id         text primary key,
  count      bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- 初始化 total 記錄
insert into public.site_stats (id, count) values ('total', 0) on conflict (id) do nothing;

-- 6.3 RLS
alter table public.site_stats enable row level security;

drop policy if exists "site_stats_public_read" on public.site_stats;
create policy "site_stats_public_read"
  on public.site_stats for select
  to anon
  using (true);

drop policy if exists "site_stats_admin_all" on public.site_stats;
create policy "site_stats_admin_all"
  on public.site_stats for all
  to authenticated
  using (true) with check (true);

-- 6.4 RPC：遞增文章瀏覽數（anon 可呼叫）
create or replace function increment_post_views(post_id bigint)
returns void
language plpgsql
security definer
as $$
begin
  update public.posts set views = views + 1 where id = post_id and status = 'published';
end;
$$;

grant execute on function increment_post_views(bigint) to anon;

-- 6.5 RPC：遞增網站瀏覽數（anon 可呼叫）
create or replace function increment_site_views()
returns void
language plpgsql
security definer
as $$
declare
  today_key text := current_date::text;
begin
  -- 累積總瀏覽
  insert into public.site_stats (id, count) values ('total', 1)
  on conflict (id) do update set count = site_stats.count + 1, updated_at = now();
  -- 今日瀏覽
  insert into public.site_stats (id, count) values (today_key, 1)
  on conflict (id) do update set count = site_stats.count + 1, updated_at = now();
end;
$$;

grant execute on function increment_site_views() to anon;

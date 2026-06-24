-- ============================================================
-- operation.tw — Cloudflare D1 schema（從 Supabase/Postgres 移植）
-- 套用：wrangler d1 execute operation-tw --remote --file=cloudflare/schema.sql
-- D1 是 SQLite，故型別與預設值與 Postgres 版略有差異：
--   bigint identity      → integer primary key autoincrement
--   jsonb                → text（存 JSON 字串）
--   timestamptz/date     → text（datetime('now') / date('now')）
-- 權限（RLS）不在 DB 層，改由 Worker 程式碼判斷（見 worker.js）。
-- ============================================================

-- 1. 文章
create table if not exists posts (
  id          integer primary key autoincrement,
  title       text    not null default '',
  category    text    not null default 'AI',
  date        text    not null default (date('now')),
  status      text    not null default 'draft',
  excerpt     text    not null default '',
  image       text    not null default '',
  body        text    not null default '',
  views       integer not null default 0,
  slug        text,
  created_at  text    not null default (datetime('now'))
);
create index if not exists idx_posts_status_date on posts(status, date desc);
create index if not exists idx_posts_category    on posts(category);

-- 2. 設定（hp / about / footer）— value 存 JSON 字串
create table if not exists settings (
  key   text primary key,
  value text not null
);

-- 3. 網站瀏覽統計（total + 每日 yyyy-mm-dd）
create table if not exists site_stats (
  id         text primary key,
  count      integer not null default 0,
  updated_at text    not null default (datetime('now'))
);
insert into site_stats (id, count) values ('total', 0)
  on conflict(id) do nothing;

-- 4. 電子報訂閱
create table if not exists subscribers (
  id         integer primary key autoincrement,
  email      text not null unique,
  source     text default 'homepage',
  created_at text not null default (datetime('now'))
);

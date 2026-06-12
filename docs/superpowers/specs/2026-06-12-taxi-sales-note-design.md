# タクシー売上ノート — 設計書

- 日付: 2026-06-12
- ステータス: 承認済み（ユーザー承認 2026-06-12）
- 種別: 新規・個人完結アプリ（静的PWA）

## 1. 目的とスコープ

タクシー乗務員が、自分の売上を**自分のスマホだけ**で記録・集計し、必要に応じて
Excel / CSV に出力できる、個人完結のPWAアプリ。

- 多数の乗務員が各自のスマホで利用する（配布はPWA）。
- データは**端末内（IndexedDB）のみ**に保存し、サーバー送信・外部集約は一切しない。
- 会社側の集約・管理者画面は**作らない**（既存 `taxicrew-portal` とは別物）。

### やらないこと（YAGNI）

- サーバー・API・アカウント同期
- 管理者/会社による集約・閲覧
- 1端末を複数人で使い分ける複数プロファイル（1台＝1人）
- IndexedDB の本格暗号化（v1では非対応。将来拡張）
- Google スプレッドシートへの直接書き込み連携（端末内完結を優先）

## 2. アーキテクチャ

- 完全クライアント完結。フレームワークなし（Vanilla JS, ES Modules）。
- 構成ファイル:
  - `index.html` — 画面マークアップ
  - `app.js` — 画面制御・状態
  - `lib/` — 純粋ロジック（`db.js` 保存層 / `calc.js` 集計 / `exporter.js` Excel・CSV / `auth.js` ロック）
  - `styles.css` — スタイル（デザイントークン）
  - `manifest.webmanifest` — PWAマニフェスト
  - `sw.js` — Service Worker（アプリシェルのオフラインキャッシュ）
  - `icons/` — PWAアイコン（192/512）
  - `vendor/xlsx.full.min.js` — SheetJS を**同梱**（CDN依存にしない＝オフライン保証）
  - `_selftest.html` — ブラウザ内テスト
- ビルド工程なし。`index.html` を開けば動作（DL形式・GitHub Pages 双方で動く）。

## 3. データモデル

### 3.1 売上レコード（IndexedDB ストア `entries`）

1乗務日＝1レコード。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | string (uuid) | 主キー |
| `date` | string `YYYY-MM-DD` | 乗務日 |
| `trips` | number | 営業回数 |
| `km` | number | 走行距離(km) |
| `cash` | number | 現金売上 |
| `card` | number | カード売上 |
| `ic` | number | 交通系IC売上 |
| `qr` | number | QR決済売上 |
| `ticket` | number | チケット売上 |
| `total` | number | 売上合計（= cash+card+ic+qr+ticket、保存時に自動計算） |
| `workStart` | string `HH:MM` \| null | 出庫時刻 |
| `workEnd` | string `HH:MM` \| null | 帰庫時刻 |
| `breakMin` | number | 休憩(分) |
| `fuel` | number | 燃料費 |
| `expenseOther` | number | その他経費 |
| `memo` | string | 自由メモ |
| `createdAt` | string ISO | 作成日時 |
| `updatedAt` | string ISO | 更新日時 |

- インデックス: `date`（月別集計・並び替え用）。
- 入力バリデーション: 数値は0以上、`date` 必須、`workEnd >= workStart`（日跨ぎ考慮）。

### 3.2 設定・認証（IndexedDB ストア `settings`、単一レコード `key='app'`）

| フィールド | 型 | 説明 |
|---|---|---|
| `driverName` | string | 乗務員名（表示用） |
| `authMode` | `'none' \| 'idpw'` | ロック方式 |
| `userId` | string \| null | ログインID（idpw時） |
| `passwordHash` | string \| null | PBKDF2(SHA-256) ハッシュ（Base64） |
| `salt` | string \| null | ランダムソルト（Base64） |
| `createdAt` / `updatedAt` | string ISO | |

- パスワード照合は WebCrypto の PBKDF2（SHA-256, 反復 ≥ 100,000）で行う。平文保存しない。

## 4. 画面構成とフロー

1. **初回セットアップ**: `settings` 未作成時に表示。乗務員名入力 → 認証方式選択
   （「ID/PWを設定」=ID・パスワード入力 / 「ロックなし」=即利用）。
2. **ロック画面**: `authMode='idpw'` かつ未解錠のとき起動時に表示。ID/PW照合で解錠。
3. **ホーム**: 今月の「売上合計」「営業回数」サマリーカード＋当月レコード一覧＋「入力」ボタン。
4. **入力（新規/編集）**: 3.1 の全項目フォーム。合計はリアルタイム表示。保存/削除。
5. **履歴**: 月セレクタで切替。一覧から編集・削除。月合計を表示。
6. **エクスポート**: 期間選択（当月 / 任意期間 / 全期間）→ Excel(.xlsx)・CSV を端末生成しダウンロード。
7. **設定**: 乗務員名変更 / 認証方式変更（none↔idpw、パス再設定）/
   **バックアップ（全データJSON書出し）・復元（JSON読込み）** / 全データ削除（確認ダイアログ）。

## 5. エクスポート仕様

### 5.1 共通列（出力順）

`日付, 営業回数, 走行km, 現金, カード, IC, QR, チケット, 売上合計, 出庫, 帰庫, 休憩(分), 燃料費, その他経費, 手取り概算, メモ`

- `手取り概算 = 売上合計 − 燃料費 − その他経費`（参考値）。
- 末尾に**期間合計行**（数値列を合算、`手取り概算`も合算）。

### 5.2 Excel(.xlsx)

- SheetJS で生成。シート名「売上」。ヘッダ行＋データ行＋合計行。
- 数値列は数値型で出力（集計しやすいよう文字列化しない）。

### 5.3 CSV

- **UTF-8 BOM 付き**（Excel・Google スプレッドシートで日本語が文字化けしない）。
- 区切りはカンマ、値のカンマ・改行・引用符は RFC4180 準拠でエスケープ。

### 5.4 ファイル名

- `taxi-uriage_<期間>_<生成日>.xlsx` / `.csv`
  例: `taxi-uriage_2026-06_20260612.xlsx`

## 6. バックアップ / 復元（データ保全）

- ローカルのみ＝端末紛失・故障でデータが消えるため標準装備。
- **書出し**: `entries`＋`settings`（passwordHash除く or 含む選択）を1つのJSONに。
- **復元**: JSON読込み → 既存と「マージ / 置換」を選択。`id` 重複は `updatedAt` 新しい方を採用。
- 機種変更時はこのJSONで新端末へ移行。

## 7. セキュリティ / 正直な制約

- ID/PW ロックは「他人に画面を覗かれない」程度の**ソフトな鍵**。
- IndexedDB のデータは端末上で技術的には参照可能（devtools等）。本格保護＝データ暗号化は
  将来拡張（v1非対応）。この制約はREADMEにも明記する。
- 外部送信が無いため、情報漏えい経路は「端末そのもの」に限定される（プライバシー上は堅い）。

## 8. 配布（PWA / git / DL）

- 新規 git リポジトリで管理。GitHub の公開リポジトリ → **GitHub Pages** で配信。
- 利用者: 公開URLをスマホで開く →「**ホーム画面に追加**」でアプリ化（standalone・オフライン動作）。
- 「DL形式」: リポジトリ一式（zip）を配布しても、`index.html` を開けば動作。
  - 注意: Service Worker によるオフラインキャッシュは https（=GitHub Pages）または localhost でのみ有効。
    `file://` 直開きでもアプリ機能自体は動く（保存はIndexedDB）。
- `manifest.webmanifest`: name「タクシー売上ノート」, short_name「売上ノート」, display `standalone`,
  theme/background color, icons 192/512。

## 9. テスト方針

- 純粋ロジックを `lib/` に分離し、`_selftest.html` でブラウザ内アサーション（既存インベーダーと同方式）。
- 重点テスト:
  - `calc.js`: 合計・月別集計・手取り概算
  - `exporter.js`: CSV のBOM/エスケープ、xlsx 行マッピング、合計行
  - `auth.js`: PBKDF2 ハッシュ生成と照合（正/誤）
  - `db.js`: 保存→取得→更新→削除の往復、バリデーション

## 10. 受け入れ基準（Definition of Done）

- [ ] 初回セットアップで「ID/PW設定」「ロックなし」両方が選べ、再起動時の挙動が仕様どおり。
- [ ] 売上を新規入力・編集・削除でき、合計が自動計算される。
- [ ] ホーム/履歴で当月・任意月の合計と一覧が正しく表示される。
- [ ] Excel(.xlsx) と CSV(BOM付き) を期間指定でダウンロードでき、日本語が文字化けしない。
- [ ] バックアップ(JSON)書出し・復元ができ、別端末へ移行できる。
- [ ] PWAとして「ホーム画面に追加」でき、オフラインで起動・利用できる。
- [ ] `_selftest.html` の全アサーションがパスする。
- [ ] ソースが git 管理され、GitHub Pages で公開URLが開ける。

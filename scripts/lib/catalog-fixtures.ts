import { validateDefinition, validateSnapshot, type Definition, type ResolvedEvaluationInput, type Snapshot } from '@imicue/core';

export const CATALOG_FIXTURE_VERSION = 'catalog-v2';
export const CATALOG_FIXTURE_TIME = Date.parse('2026-09-27T00:00:00Z');
export type CatalogSuite = 'pilot' | 'dev' | 'holdout' | 'stability';
export type CatalogSituation = 'features' | 'cases' | 'paraphrase' | 'none' | 'ambiguous' | 'long';
export type CatalogOrder = 'original' | 'reverse' | 'shuffle';
export interface CatalogFamily { id: string; subject: string; paraphrase: string; split: 'dev' | 'holdout' }
const family = (id: string, subject: string, paraphrase: string, split: 'dev' | 'holdout'): CatalogFamily => ({ id, subject, paraphrase, split });
// Human review is pending. Families, including paraphrases, do not cross the split.
export const catalogFamilies: readonly CatalogFamily[] = [
  family('sharing', '文書の社外共有リンクに有効期限を設定する', '取引先に渡した書類のURLを指定した日以降は使えなくする', 'dev'),
  family('ocr', '画像PDFの文字をOCRで読み取り検索する', 'スキャンした書類に写る文字列を探せるようにする', 'dev'),
  family('tasks', 'タスクの締め切り前に担当者へ通知する', '仕事の期限が近づいたら受け持つ人へ知らせる', 'dev'),
  family('reports', '月別の売上を部署ごとに集計する', '各部門の販売額を毎月まとめる', 'dev'),
  family('customers', '顧客の問い合わせ履歴を担当者間で引き継ぐ', '相談された内容を次の窓口担当にも分かるように残す', 'dev'),
  family('inventory', '商品の在庫が下限を割ったら補充を通知する', '倉庫に残る品数が少なくなったとき発注担当へ知らせる', 'dev'),
  family('captions', '動画の音声から字幕を作成する', '映像の話し声を画面下の文字にする', 'holdout'),
  family('bookings', '診療予約の時間帯ごとの空きを管理する', '受診できる時刻と埋まっている枠を整理する', 'holdout'),
  family('temperature', '冷蔵設備の温度異常を検知する', '低温で保存する装置が熱くなったら知らせる', 'holdout'),
  family('keys', '施設の電子鍵を曜日ごとに利用制限する', '建物の入室用キーを使える日だけ有効にする', 'holdout'),
  family('routes', '配送先の巡回順を地図上で組み立てる', '荷物を届ける場所を回る順番を決める', 'holdout'),
  family('receipts', '経費の領収書を申請に添付する', '立て替えた支出の証票を精算の手続きにつける', 'holdout'),
  family('subtitles', '多言語の商品説明を言語別に管理する', '販売する品物の紹介文を翻訳先ごとに保存する', 'holdout'),
  family('seats', 'オフィスの座席を日単位で予約する', '出社する日の仕事用の席を確保する', 'holdout'),
  family('training', '社員研修の受講履歴を記録する', '従業員がどの講習を終えたか残す', 'holdout'),
  family('equipment', '貸出機材の返却予定日を管理する', '借り出された装置がいつ戻るか確認する', 'holdout'),
  family('surveys', 'アンケートの回答を設問ごとに集計する', '質問票に寄せられた答えを問い別にまとめる', 'holdout'),
  family('reading-habits', '読書中の本に進捗を記録する', '読み進めたページ数や感想を本ごとに残す', 'holdout'),
  family('maintenance', '設備点検の予定と実施履歴を残す', '装置の検査をいつ行い何を確認したか記録する', 'holdout'),
  family('attendance', '従業員の出退勤時刻を記録する', '職場で働き始めた時刻と終えた時刻を残す', 'holdout'),
  family('menus', '食堂メニューのアレルギー情報を表示する', '提供する料理に含まれる特定原材料を知らせる', 'holdout'),
  family('parking', '駐車場の空き区画を管理する', '車を停められる場所が残っているか把握する', 'holdout'),
  family('waste', '廃棄物の種類別の回収量を記録する', '集めたごみの重さを分類ごとに残す', 'holdout'),
  family('accessibility', '文書内の画像に代替テキストを登録する', '挿絵が見えない場合に伝える説明文をつける', 'holdout'),
  family('backups', 'データのバックアップから特定の版を復元する', '保存しておいた記録を以前の状態に戻す', 'holdout'),
  family('recruiting', '採用面接の日程を応募者と調整する', '選考で話を聞く日時を候補者と決める', 'holdout'),
];

export interface CatalogFixture {
  id: string;
  groupId: string;
  familyId: string;
  split: 'dev' | 'holdout';
  situation: CatalogSituation;
  order: CatalogOrder;
  seed: number;
  source: Definition;
  snapshot: Snapshot;
  canonicalIds: Readonly<Record<string, string>>;
  acceptable: readonly string[];
  acceptableRecommendationIds: readonly string[];
  humanReview: 'pending_ai_authored';
}
export function orderCatalog<T>(items: readonly T[], order: CatalogOrder, seed = 17): T[] {
  const result = [...items];
  if (order === 'reverse') return result.reverse();
  if (order === 'shuffle') {
    let state = seed >>> 0;
    for (let i = result.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
  }
  return result;
}

type Role = 'features' | 'cases' | 'pricing' | 'administration';
function describe(subject: string, role: Role): string {
  if (role === 'features') return `${subject}ための機能一覧、設定項目と具体的な操作手順。導入事例や料金は扱わない。`;
  if (role === 'cases') return `${subject}仕組みを導入した組織の事例。導入前の課題、担当部署、運用の経緯を説明する。設定手順や料金は扱わない。`;
  if (role === 'pricing') return `${subject}製品の利用料金、契約プランと請求単位。機能の設定手順や導入事例は扱わない。`;
  return `${subject}製品の契約者向けに、請求先住所と経理担当者の登録情報を変更する手順。製品の操作や導入事例は扱わない。`;
}

/** Synthetic, headless data; never imports server SDKs and never contains a real site URL. */
export function makeCatalogFixture(options: {
  familyId?: string; situation?: CatalogSituation; count?: number; order?: CatalogOrder; seed?: number;
} = {}): CatalogFixture {
  const focus = catalogFamilies.find(item => item.id === (options.familyId ?? 'sharing'));
  if (!focus) throw new Error('unknown_catalog_family');
  const situation = options.situation ?? 'features';
  const count = options.count ?? 100;
  if (!Number.isInteger(count) || count < 2 || count > 100) throw new Error('invalid_catalog_count');
  const candidates = catalogFamilies.filter(item => item.split === focus.split).flatMap(item => (['features', 'cases', 'pricing', 'administration'] as const)
    .filter(itemRole => !(item.id === focus.id && (itemRole === 'features' || itemRole === 'cases')))
    .flatMap(itemRole => Array.from({ length: focus.split === 'dev' ? 5 : 2 }, (_, variant) => ({
      title: itemRole === 'cases' ? '導入事例' : itemRole === 'features' ? '機能ガイド' : '利用案内',
      description: `${describe(item.subject, itemRole)}説明資料${variant + 1}。`, relatedSignalIds: [] as string[] }))));
  const featureTarget = { title: '機能ガイド', description: `${describe(focus.subject, 'features')}説明資料1。`, relatedSignalIds: ['features', 'paraphrase'] };
  const caseTarget = { title: '導入事例', description: `${describe(focus.subject, 'cases')}説明資料1。`, relatedSignalIds: ['cases'] };
  // The same catalog is shared across feature/case/paraphrase/no-match visits. Only browsing changes.
  const selected = [...candidates.slice(0, count - 2), caseTarget, featureTarget];
  if (situation === 'ambiguous') selected[count - 2] = { ...featureTarget };
  if (situation === 'long') {
    for (let index = 0; index < selected.length; index++) {
      const item = selected[index]!;
      const padding = 'この説明は架空の評価用データです。閲覧した事実から利用者の購入意思や読了を確定しません。';
      // Retain the complete meaning at the beginning; exercise the allowed long-description boundary.
      item.description = (item.description + padding.repeat(30)).slice(0, 1000);
    }
  }
  const source: Definition = {
    schemaVersion: '0.1', siteId: 'synthetic-catalog', definitionVersion: CATALOG_FIXTURE_VERSION,
    signals: {
      overview: { kind: 'content', description: '架空の業務サービスの製品概要。ここには個別機能や事例の内容を特定する説明はない。' },
      features: { kind: 'content', description: `${focus.subject}ための設定項目と操作方法を紹介する機能セクション。` },
      cases: { kind: 'content', description: `${focus.subject}仕組みを導入した組織の課題と運用の経緯を紹介する事例セクション。` },
      paraphrase: { kind: 'content', description: `${focus.paraphrase}ための機能と設定方法の説明。` },
      unrelated: { kind: 'content', description: '天体写真の撮影に使う望遠鏡の焦点距離と露出時間の説明。業務サービスの機能は扱わない。' },
    },
    contents: Object.fromEntries(orderCatalog(selected.map((item, index) => {
      const id = `c${String(index).padStart(3, '0')}`;
      return [id, { title: item.title, description: item.description, href: `/synthetic-guides/${id}/`, enabled: true,
        ...(item.relatedSignalIds.length ? { relatedSignalIds: item.relatedSignalIds } : {}) }] as const;
    }), options.order ?? 'original', options.seed)),
    pages: { home: {} },
  };
  const focusSignal = situation === 'cases' ? 'cases' : situation === 'paraphrase' ? 'paraphrase' : situation === 'none' ? 'unrelated' : 'features';
  const snapshot: Snapshot = { schemaVersion: '0.1', siteId: source.siteId, definitionVersion: source.definitionVersion,
    snapshotId: 'catalog-snapshot', revision: 1, pageViewId: 'catalog-page', pageId: 'home', windowMs: 1_800_000,
    observations: [
      { signalId: 'overview', source: 'direct', qualifiedViews: 1, visibleMs: 6_000, clicks: 0, actions: 0, lastSeenAgoMs: 70_000 },
      { signalId: focusSignal, source: 'direct', qualifiedViews: 1, visibleMs: 60_000, clicks: 0, actions: 0, lastSeenAgoMs: 0 },
    ], recent: [
      { signalId: focusSignal, source: 'direct', kind: 'qualified-view', ageMs: 0 },
      { signalId: 'overview', source: 'direct', kind: 'qualified-view', ageMs: 70_000 },
    ], outcomes: [], coverage: { truncated: false } };
  const ids = Array.from({ length: count }, (_, index) => `c${String(index).padStart(3, '0')}`);
  const assignedIds = orderCatalog(ids, options.order ?? 'original', options.seed);
  const canonicalIds = Object.fromEntries(assignedIds.map((id, index) => [id, ids[index]!]));
  const finalSource: Definition = { ...source, contents: Object.fromEntries(ids.map((id, index) => [assignedIds[index]!, {
    ...source.contents[id]!, href: `/synthetic-guides/${assignedIds[index]!}/`,
  }])) };
  const recommendationIds = situation === 'none' || situation === 'ambiguous' ? [] : [assignedIds[count - (situation === 'cases' ? 2 : 1)]!];
  const groupId = `${focus.id}-${situation}-${count}`;
  return { id: `${groupId}-${options.order ?? 'original'}-${options.seed ?? 17}`, groupId, familyId: focus.id,
    split: focus.split, situation, order: options.order ?? 'original', seed: options.seed ?? 17, source: finalSource, snapshot, canonicalIds,
    acceptable: recommendationIds.length ? recommendationIds : ['abstain'], acceptableRecommendationIds: recommendationIds,
    humanReview: 'pending_ai_authored' };
}

export function catalogFixtures(suite: CatalogSuite): CatalogFixture[] {
  const situations = ['features', 'cases', 'paraphrase', 'none', 'ambiguous'] as const;
  if (suite === 'dev' || suite === 'holdout') return catalogFamilies.filter(item => item.split === suite)
    .flatMap(item => {
      const seed = [...item.id].reduce((value, character) => Math.imul(value, 31) + character.charCodeAt(0), 17) >>> 0;
      return situations.map(situation => makeCatalogFixture({ familyId: item.id, situation, order: 'shuffle', seed }));
    });
  if (suite === 'pilot') return ['sharing', 'ocr'].flatMap(familyId =>
    [...situations, 'long' as const].map(situation => makeCatalogFixture({ familyId, situation })));
  return ['sharing', 'ocr'].flatMap(familyId => (['features', 'cases'] as const).flatMap(situation =>
      [makeCatalogFixture({ familyId, situation }), makeCatalogFixture({ familyId, situation, order: 'reverse' }),
        ...[17, 42, 101].map(seed => makeCatalogFixture({ familyId, situation, order: 'shuffle', seed }))]));
}

/** Fixtures have no excluded candidates. Request-order probes deliberately retain insertion order. */
export function catalogEvaluationInput(fixture: CatalogFixture): ResolvedEvaluationInput {
  const definition = validateDefinition(fixture.source);
  const snapshot = validateSnapshot(fixture.snapshot, definition);
  return { topics: definition.topics ?? {}, snapshot, page: definition.pages[snapshot.pageId]!,
    observations: snapshot.observations.map(row => ({ ...row, definition: definition.signals[row.signalId]! })),
    candidates: Object.entries(definition.contents).map(([contentId, content]) => ({ ...content, contentId })) };
}

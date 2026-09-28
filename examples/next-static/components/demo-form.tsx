'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useImicueActions } from './tracker-session';
export function DemoForm({ kind }: { kind: 'resources' | 'contact' }) {
  const { complete } = useImicueActions();
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => setReady(true), []);
  useEffect(() => { if (done) result.current?.focus(); }, [done]);
  if (done) return <div className="form-panel completion" ref={result} tabIndex={-1} role="status"><span className="complete-mark" aria-hidden>✓</span><h2>{kind === 'resources' ? '資料請求の完了表示です' : 'お問い合わせの完了表示です'}</h2><p>デモ内で手続きが完了しました。入力内容は送信・保存していません。</p>{kind === 'resources' && <div className="sample-document"><p className="eyebrow">PACELET / 製品資料のサンプル</p><h3>タスク、予定、共有範囲。</h3><p>ボードで担当と進捗を共有し、予定表で流れを確認。チームに合った役割とプランを選ぶ、架空の製品です。</p></div>}<Link className="button" href="/">製品紹介に戻る →</Link></div>;
  return <form className="form-panel" data-imicue-ignore autoComplete="off" onSubmit={(event) => { event.preventDefault(); event.currentTarget.reset(); complete(); setDone(true); }}>
    <p className="form-notice" id="form-notice">入力内容は送信・保存しません。実際の情報は入力しないでください。</p>
    <fieldset disabled={!ready} aria-describedby="form-notice"><legend className="sr-only">{kind === 'resources' ? '資料請求' : 'お問い合わせ'}のデモ</legend>
      <label htmlFor="purpose">{kind === 'resources' ? '確認したいこと' : '相談したいこと'}</label><select id="purpose" defaultValue=""><option value="">選択してください</option><option>機能とプラン</option><option>チームの運用</option><option>移行の進め方</option></select>
      <label htmlFor="demo-name">お名前 <span>（任意）</span></label><input id="demo-name" placeholder="例：デモ利用者" maxLength={80} />
      <label htmlFor="demo-email">メールアドレス <span>（任意）</span></label><input id="demo-email" type="email" placeholder="例：demo@example.test" maxLength={120} />
      {kind === 'contact' && <><label htmlFor="demo-message">相談内容 <span>（任意）</span></label><textarea id="demo-message" rows={4} placeholder="試すための文章を入力してください" maxLength={500} /></>}
      <button className="button" type="submit">{kind === 'resources' ? '資料請求の完了表示を試す' : '送信完了の表示を試す'}</button>
    </fieldset>{!ready && <p id="form-unavailable">完了表示を試すにはJavaScriptを有効にしてください。フォームは送信できません。</p>}
  </form>;
}

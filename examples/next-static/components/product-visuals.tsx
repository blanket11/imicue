/** Decorative examples of the fictional product; these are not working application controls. */
export function Board({ compact = false }: { compact?: boolean }) {
  const columns = [
    ['これから', '構成案をまとめる', '素材を整理する'],
    ['進行中', 'トップページを作る', '紹介文を見直す'],
    ['確認待ち', 'デザインを確認する', '公開の準備をする'],
  ];
  return <div className={`product-window ${compact ? 'compact' : ''}`} aria-label="担当と進行状況を整理したボードのイメージ" role="img">
    <div className="window-top"><span className="window-dots">● ● ●</span><span>PACELET / サイトリニューアル</span><span className="avatar">P</span></div>
    <div className="board-toolbar"><strong>プロジェクトボード</strong><span>ボード <span className="muted"> / 予定表</span></span></div>
    <div className="board-columns">{columns.map(([title, ...tasks], i) => <div className={`board-column column-${i}`} key={title}><div className="column-title">{title} <span>2</span></div>{tasks.map((task, n) => <div className="task" key={task}><strong>{task}</strong><span className="task-label">{n === 0 ? '制作' : '運用'}</span><div className="task-bottom"><span className="avatar">{['A', 'B', 'C'][i]}</span><span>4 / {12 + i * 3 + n}</span></div></div>)}</div>)}</div>
  </div>;
}
export function Timeline() {
  return <div className="product-window timeline" role="img" aria-label="企画、制作、確認、公開の予定が並ぶ予定表のイメージ"><div className="board-toolbar"><strong>プロジェクトの予定</strong><span>4月</span></div><div className="timeline-weeks"><span>第1週</span><span>第2週</span><span>第3週</span><span>第4週</span></div>{['企画をまとめる', 'デザイン・制作', 'チームで確認', '公開の準備'].map((label, i) => <div className={`timeline-row timeline-${i}`} key={label}><span>{label}</span><i /></div>)}</div>;
}
export function Roles() {
  return <div className="roles product-window"><h3>プロジェクトの共有範囲</h3>{[['管理者', 'メンバーと設定を管理'], ['編集者', 'タスクと予定を更新'], ['閲覧者', 'プロジェクトの状況を確認']].map(([role, detail], i) => <div key={role}><span className="role-icon" aria-hidden>0{i + 1}</span><strong>{role}</strong><span>{detail}</span></div>)}</div>;
}

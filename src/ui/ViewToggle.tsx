import type { View } from '../scene/layout.ts';
import { useStore } from '../store.ts';

const VIEWS: { id: View; label: string }[] = [
  { id: 'spines', label: 'Spines' },
  { id: 'covers', label: 'Covers' },
];

/** Switch between the bookcase and the face-out display. Kept in the URL so it can be shared. */
export function ViewToggle() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const focused = useStore((s) => s.focused);
  const pick = (v: View) => {
    if (v === view) return;
    const url = new URL(location.href);
    if (v === 'covers') url.searchParams.set('view', 'covers');
    else url.searchParams.delete('view');
    url.hash = '';
    history.replaceState(null, '', url);
    setView(v);
  };
  return (
    <div className={`view-toggle${focused ? ' hidden' : ''}`} role="radiogroup" aria-label="View">
      {VIEWS.map((v) => (
        <button key={v.id} role="radio" aria-checked={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => pick(v.id)}>
          {v.label}
        </button>
      ))}
    </div>
  );
}

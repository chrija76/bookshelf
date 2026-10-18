import { useCallback, useEffect, useMemo, useState } from 'react';
import { categorySpot, computeLayout, type Layout } from './scene/layout.ts';
import { Scene } from './scene/Scene.tsx';
import { useStore } from './store.ts';
import type { Library } from './types.ts';
import { CategoryNav } from './ui/CategoryNav.tsx';
import { FocusPanel } from './ui/FocusPanel.tsx';
import { Tooltip } from './ui/Tooltip.tsx';
import { ViewToggle } from './ui/ViewToggle.tsx';

/** `#book/{id}` opens a book pulled out; `#category/{slug}` flies to a bay. */
function applyHash(library: Library, layout: Layout) {
  const [kind, value] = decodeURIComponent(location.hash.slice(1)).split('/');
  const s = useStore.getState();
  if (kind === 'book' && value && library.books.some((b) => b.id === value)) {
    if (s.focused?.id !== value) s.focus(value);
  } else if (kind === 'category' && value) {
    const spot = categorySpot(layout, value);
    if (spot) {
      s.setTargetX(Math.min(layout.maxX, Math.max(layout.minX, spot.x + 350)));
      s.setTargetY(spot.y + 170);
      s.setDistance(2300);
    }
  }
}

export function App() {
  const library = useStore((s) => s.library);
  const setLibrary = useStore((s) => s.setLibrary);
  const sort = useStore((s) => s.sort);
  const view = useStore((s) => s.view);
  const [ready, setReady] = useState(false);
  const layout = useMemo(
    () => (library ? computeLayout(library.books, library.categories, sort, view) : null),
    [library, sort, view],
  );

  useEffect(() => {
    fetch('/data/books.json')
      .then((r) => r.json() as Promise<Library>)
      .then(setLibrary)
      .catch((err: unknown) => console.error('Failed to load library', err));
  }, [setLibrary]);

  const onReady = useCallback(() => setReady(true), []);

  // Deep links in, once the scene is up; and keep the hash in step with the focused book.
  useEffect(() => {
    if (!ready || !library || !layout) return;
    const apply = () => applyHash(library, layout);
    // Let the shelf settle in before pulling a book out.
    const t = setTimeout(apply, 900);
    window.addEventListener('hashchange', apply);
    const unsub = useStore.subscribe((now, before) => {
      if (now.focused?.id === before.focused?.id) return;
      if (now.focused) history.replaceState(null, '', `${location.search}#book/${now.focused.id}`);
      else if (location.hash.startsWith('#book/')) history.replaceState(null, '', `${location.pathname}${location.search}`);
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener('hashchange', apply);
      unsub();
    };
  }, [ready, library, layout]);

  return (
    <main className={`app${ready ? ' ready' : ''}`}>
      {library && layout && <Scene library={library} layout={layout} onReady={onReady} />}
      {library && layout && <CategoryNav layout={layout} library={library} />}
      {library && <ViewToggle />}
      {library && <Tooltip library={library} />}
      {library && <FocusPanel library={library} />}
      <div className="loading" aria-hidden={ready}>
        <span>Bookshelf</span>
      </div>
      <footer className="credit">Covers via Goodreads, Amazon and Open Library.</footer>
    </main>
  );
}

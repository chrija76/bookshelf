import { useEffect } from 'react';
import { useStore } from '../store.ts';
import type { Library } from '../types.ts';

/** Controls for the pulled-out book: open or close it, and the outbound links. */
export function FocusPanel({ library }: { library: Library }) {
  const focused = useStore((s) => s.focused);
  const open = useStore((s) => s.open);
  const close = useStore((s) => s.close);
  const book = focused ? library.books.find((b) => b.id === focused.id) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const visible = !!book && !focused?.closing;
  return (
    <div className={`focus-panel${visible ? ' visible' : ''}`} aria-hidden={!visible}>
      {book && (
        <>
          <button className="pill" onClick={open}>
            {focused?.phase === 'open' ? 'Close cover' : 'Open'}
          </button>
          <a className="pill" href={book.links.goodreads} target="_blank" rel="noreferrer noopener">
            Goodreads
          </a>
          <a className="pill" href={book.links.amazon} target="_blank" rel="noreferrer noopener">
            Amazon
          </a>
          <button className="pill icon" onClick={close} aria-label="Put back">
            ✕
          </button>
        </>
      )}
    </div>
  );
}

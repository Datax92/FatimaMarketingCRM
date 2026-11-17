'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { AccountButton } from '@/components/mobile/MobileAccount';
import { useAppearance } from '@/context/AppearanceContext';
import { SHORTCUTS, MAX_SHORTCUTS, findWallpaper, type ShortcutDef } from '@/lib/appearance';
import { navFor, allItems } from '@/lib/navigation';
import { AppIcon } from './AppIcons';
import { Icon } from './Icons';
import { Wallpaper } from './Wallpapers';
import { HomeSections, loadHomeView, saveHomeView, type HomeSection, type HomeTile, type HomeView } from './HomeSections';

/* The home layout is a list of grid cells, each holding a tile id (the page's path) or nothing.
   Dragging a tile drops it into the cell under the pointer, swapping with whatever was there.
   Kept in this browser, per role, since each role has its own apps. */
const SPARE = 6;

function withSpare(cells: (string | null)[]) {
  const out = cells.slice();
  while (out.length && out[out.length - 1] == null) out.pop();
  const target = Math.ceil((out.length + SPARE) / 6) * 6;
  while (out.length < target) out.push(null);
  return out;
}

function loadLayout(key: string, fallback: string[]): (string | null)[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const cells: (string | null)[] = parsed.map((x: unknown) => (typeof x === 'string' ? x : null));
      // Apps added since the layout was saved go into the first free places.
      fallback.forEach((id) => {
        if (cells.includes(id)) return;
        const free = cells.indexOf(null);
        if (free >= 0) cells[free] = id;
        else cells.push(id);
      });
      return cells;
    }
  } catch {
    /* storage blocked or corrupt: the default */
  }
  return fallback.slice();
}

function saveLayout(key: string, cells: (string | null)[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(cells));
  } catch {
    /* the layout simply is not remembered */
  }
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Karachi' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomeLauncher() {
  const router = useRouter();
  const { user, role, isHr } = useAuth();
  const { look, update, surprise } = useAppearance();
  const isMobile = useIsMobile();
  const tone = findWallpaper(look.wallpaper).tone;
  const r = (role ?? 'employee') as 'admin' | 'subadmin' | 'employee';

  const sections = useMemo(() => navFor(role, isHr), [role, isHr]);
  const TILES = useMemo(() => {
    const out: Record<string, HomeTile> = {};
    for (const item of allItems(sections)) out[item.path] = { icon: item.icon, label: item.tile ?? item.label, value: item.hint, go: item.path };
    return out;
  }, [sections]);
  const defaultLayout = useMemo(() => Object.keys(TILES), [TILES]);
  const defaultSections: HomeSection[] = useMemo(
    () => sections.map((s) => ({ id: s.id, title: s.label, items: s.items.map((i) => i.path) })),
    [sections]
  );
  const layoutKey = `fm-home-layout-v1:${r}`;

  const shortcutPath = useCallback(
    (s: ShortcutDef) => (s.hrOnly && r === 'subadmin' && !isHr ? undefined : s.paths[r]),
    [r, isHr]
  );
  // A shortcut a role has no page for is "denied"; tiles always belong to the role.
  const denied = useCallback(
    (need?: string) => {
      if (!need) return false;
      const sc = SHORTCUTS.find((s) => s.id === need);
      return sc ? !shortcutPath(sc) : false;
    },
    [shortcutPath]
  );

  const [cells, setCells] = useState<(string | null)[]>(() => withSpare(defaultLayout));
  useEffect(() => {
    setCells(withSpare(loadLayout(layoutKey, defaultLayout).filter((id) => id == null || TILES[id])));
  }, [layoutKey, defaultLayout, TILES]);
  const commit = useCallback(
    (next: (string | null)[]) => {
      const tidy = withSpare(next);
      setCells(tidy);
      saveLayout(layoutKey, tidy);
    },
    [layoutKey]
  );

  const [editing, setEditing] = useState(false);
  const [view, setViewState] = useState<HomeView>('icons');
  useEffect(() => setViewState(loadHomeView()), []);
  const setView = (v: HomeView) => {
    setViewState(v);
    saveHomeView(v);
  };
  const [sectionsReset, setSectionsReset] = useState(0);
  const [picker, setPicker] = useState<number | null>(null);
  const [scPicker, setScPicker] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number | null; x: number; y: number } | null>(null);
  const pending = useRef<{ from: number; x: number; y: number; id: number } | null>(null);
  const justDragged = useRef(false);

  // Warm the pages people are most likely to open next.
  useEffect(() => {
    defaultLayout.slice(0, 8).forEach((p) => router.prefetch(p));
  }, [defaultLayout, router]);

  const visible = (id: string | null) => !!id && !!TILES[id];
  const hidden = Object.keys(TILES).filter((id) => !cells.includes(id));

  const cellAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell = el && (el.closest('[data-cell]') as HTMLElement | null);
    return cell ? +(cell.dataset.cell as string) : null;
  };

  const onPointerDown = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || (!editing && e.pointerType !== 'mouse')) return;
    pending.current = { from: i, x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      e.preventDefault();
      setDrag({ from: p.from, over: cellAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.id) return;
      pending.current = null;
      if (!drag) return;
      const to = cellAt(e.clientX, e.clientY);
      setDrag(null);
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (to == null || to === p.from) return;
      const next = cells.slice();
      [next[p.from], next[to]] = [next[to], next[p.from]];
      commit(next);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, cells, commit]);

  const open = (t: HomeTile) => {
    if (justDragged.current || editing) return;
    router.push(t.go);
  };

  const remove = (i: number) => {
    const next = cells.slice();
    next[i] = null;
    commit(next);
  };

  const add = (id: string) => {
    if (picker == null) return;
    const next = cells.slice();
    next[picker] = id;
    commit(next);
    setPicker(null);
  };

  const shortcuts = look.shortcuts
    .map((id) => SHORTCUTS.find((s) => s.id === id))
    .filter((s): s is ShortcutDef => !!s && !!shortcutPath(s));
  const scHidden = SHORTCUTS.filter((s) => !look.shortcuts.includes(s.id) && !!shortcutPath(s));
  const runShortcut = (s: ShortcutDef) => {
    if (editing) return;
    const path = shortcutPath(s);
    if (path) router.push(path);
  };

  const dragTile = drag ? cells[drag.from] : null;
  let lastFilled = cells.length - 1;
  while (lastFilled >= 0 && !visible(cells[lastFilled])) lastFilled--;

  const who = user?.email?.split('@')[0] ?? '';

  return (
    <div className="page o-home" data-tone={tone}>
      <Wallpaper id={look.wallpaper} seed={look.seed} themeKey={look.theme + (look.uniqueName || '')} />

      <div className="fm-hello fm-hello-row">
        <div>
          <h1>
            {greeting()}
            {who && <span>, {who}</span>}
          </h1>
          <p>{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Karachi' }).format(new Date())}</p>
        </div>
        {/* On a phone there is no navbar, so sign-out and the account live here. */}
        {isMobile && <AccountButton />}
      </div>

      {(shortcuts.length > 0 || editing) && (
        <div className="shortcuts" data-noprint="1">
          {shortcuts.map((s, i) => (
            <div key={s.id} className="shortcut-wrap">
              <button type="button" className={`shortcut sc-v${i % 3}`} onClick={() => runShortcut(s)}>
                <span className="sc-ic">
                  <AppIcon name={s.icon} size={30} />
                </span>
                <span className="sc-t">
                  <b>{s.label}</b>
                  <small>{s.sub}</small>
                </span>
                <span className="sc-plus">
                  <Icon name="next" />
                </span>
              </button>
              {editing && (
                <button
                  type="button"
                  className="shortcut-x"
                  aria-label={`Remove the ${s.label} shortcut`}
                  onClick={() => update({ shortcuts: look.shortcuts.filter((x) => x !== s.id) })}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {editing && shortcuts.length < MAX_SHORTCUTS && scHidden.length > 0 && (
            <button type="button" className="shortcut-add" onClick={() => setScPicker(true)}>
              <Icon name="plus" /> Add a shortcut
            </button>
          )}
        </div>
      )}

      <div className="launch-bar" data-noprint="1">
        <span className="kicker">
          {!editing
            ? 'Your apps'
            : view === 'icons'
            ? 'Drag icons to move them · × removes · + adds'
            : 'Rename a heading by typing in it · drag cards between headings · × removes · + adds'}
        </span>
        <span className="spacer" />
        <span className="seg" role="group" aria-label="Home view">
          <button type="button" aria-pressed={view === 'icons'} onClick={() => setView('icons')} title="Icons in a grid">
            Icons
          </button>
          <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')} title="Cards under headings">
            Cards
          </button>
          <button type="button" aria-pressed={view === 'big'} onClick={() => setView('big')} title="Big cards with large labels">
            Big cards
          </button>
        </span>
        {!editing && (
          <>
            <button type="button" className="btn sm dice" onClick={surprise} title="A new matching theme, wallpaper and icon pack">
              <Icon name="dice" /> Surprise me
            </button>
            <button type="button" className="btn sm" onClick={() => router.push('/appearance')}>
              <Icon name="palette" /> Appearance
            </button>
          </>
        )}
        {editing && (
          <button
            type="button"
            className="btn sm"
            onClick={() => (view === 'icons' ? commit(defaultLayout.slice()) : setSectionsReset((n) => n + 1))}
          >
            Reset
          </button>
        )}
        <button
          type="button"
          className={`btn sm ${editing ? 'pri' : ''}`}
          onClick={() => {
            setEditing(!editing);
            setPicker(null);
          }}
        >
          {editing ? (
            <>
              <Icon name="ok" /> Done
            </>
          ) : (
            <>
              <Icon name="grid" /> Customize
            </>
          )}
        </button>
      </div>

      {view !== 'icons' && (
        <HomeSections
          tiles={TILES}
          view={view}
          editing={editing}
          denied={denied}
          openTile={open}
          runShortcut={runShortcut}
          resetKey={sectionsReset}
          defaults={defaultSections}
          storageKey={`fm-home-sections-v1:${r}`}
        />
      )}

      {view === 'icons' && (
        <nav className={`launch ${editing ? 'editing' : ''} ${drag ? 'dragging' : ''}`} aria-label="All apps">
          {(editing || drag ? cells : cells.slice(0, lastFilled + 1)).map((id, i) => {
            const t = id && visible(id) ? TILES[id] : null;
            const isOver = drag && drag.over === i && drag.from !== i;
            if (!t) {
              return (
                <div key={'empty-' + i} data-cell={i} className={`cell empty ${isOver ? 'over' : ''}`}>
                  {editing && (
                    <button type="button" className="cell-add" onClick={() => setPicker(i)} aria-label="Add an icon here" disabled={!hidden.length}>
                      <Icon name="plus" />
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div key={id} data-cell={i} className={`cell ${isOver ? 'over' : ''} ${drag && drag.from === i ? 'lifted' : ''}`}>
                <button
                  type="button"
                  className="tile"
                  title={t.value ? `${t.label} — ${t.value}` : t.label}
                  style={{ '--i': i } as React.CSSProperties}
                  onPointerDown={(e) => onPointerDown(e, i)}
                  onMouseEnter={() => router.prefetch(t.go)}
                  onClick={() => open(t)}
                >
                  <span className="tile-ic">
                    <AppIcon name={t.icon} />
                  </span>
                  <span className="tile-l">{t.label}</span>
                </button>
                {editing && (
                  <button type="button" className="tile-x" onClick={() => remove(i)} aria-label={`Remove ${t.label}`}>
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </nav>
      )}

      {drag &&
        dragTile &&
        TILES[dragTile] &&
        createPortal(
          <div className="tile-ghost" data-tone={tone} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            <span className="tile-ic">
              <AppIcon name={TILES[dragTile].icon} />
            </span>
            <span className="tile-l">{TILES[dragTile].label}</span>
          </div>,
          document.body
        )}

      {scPicker && (
        <div className="overlay" onClick={() => setScPicker(false)}>
          <div className="modal tile-picker" role="dialog" aria-modal="true" aria-label="Add a shortcut" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h2>Add a shortcut</h2>
                <p>Up to {MAX_SHORTCUTS} shortcuts sit on top of the home screen.</p>
              </div>
              <button type="button" className="x" onClick={() => setScPicker(false)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-b">
              <div className="picker-grid wide">
                {scHidden.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="sc-pick"
                    onClick={() => {
                      update({ shortcuts: [...look.shortcuts, s.id].slice(0, MAX_SHORTCUTS) });
                      setScPicker(false);
                    }}
                  >
                    <span className="sc-ic">
                      <AppIcon name={s.icon} size={28} />
                    </span>
                    <span>
                      <b>{s.label}</b>
                      <small>{s.sub}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {picker != null && (
        <div className="overlay" onClick={() => setPicker(null)}>
          <div className="modal tile-picker" role="dialog" aria-modal="true" aria-label="Add an icon" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <h2>Add an icon</h2>
                <p>Pick the icon to put in this place.</p>
              </div>
              <button type="button" className="x" onClick={() => setPicker(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-b">
              <div className="picker-grid">
                {hidden.map((id) => (
                  <button key={id} type="button" className="tile" onClick={() => add(id)}>
                    <span className="tile-ic">
                      <AppIcon name={TILES[id].icon} />
                    </span>
                    <span className="tile-l">{TILES[id].label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

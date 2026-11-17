'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { NotificationsPanel } from '@/components/NotificationsPanel';
import { activeItem, type NavSection } from '@/lib/navigation';
import { COMPANY_SHORT } from '@/lib/brand';
import { BrandMark } from './Brand';
import { Icon } from './Icons';

type MenuId = 'account' | 'section' | 'apps';

/** Top navbar: apps button, the open section's name and its menus, then search, alerts and the account. */
export function Navbar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, role, logout, getIdToken } = useAuth();
  const [menu, setMenu] = useState<{ id: MenuId; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');

  const hit = activeItem(sections, pathname);
  const isHome = pathname === '/home';
  const section = isHome ? null : hit?.section ?? null;
  const brand = section ? section.label : pathname === '/appearance' ? 'Appearance' : COMPANY_SHORT;

  const name = user?.email?.split('@')[0] || 'User';
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const open = (id: MenuId, width: number) => (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ id, x: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), y: r.bottom + 2 });
  };
  const go = (path: string) => {
    setMenu(null);
    router.push(path);
  };

  return (
    <>
      <header className="o-nav" id="topbar" data-noprint="1">
        <button type="button" className="o-nav-apps" title="Home menu" aria-label="Home menu" onClick={() => router.push('/home')}>
          <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden="true">
            {[2, 7, 12].map((y) => [2, 7, 12].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="2.4" height="2.4" rx=".5" />))}
          </svg>
        </button>

        <Link href="/home" className="o-nav-logo" title={COMPANY_SHORT} aria-label="Home">
          <BrandMark size={24} />
        </Link>
        <button
          type="button"
          className="o-nav-brand"
          title={brand}
          onClick={() => router.push(section ? section.items[0].path : '/home')}
        >
          <span className="o-nav-brand-t">{brand}</span>
        </button>

        {section && section.items.length > 0 && (
          <>
            <nav className="o-nav-menu" aria-label="Section menu">
              {section.items.map((item) => (
                <Link
                  key={item.path}
                  href={item.path}
                  prefetch
                  className={`o-nav-item ${hit?.item.path === item.path ? 'on' : ''}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <button type="button" className="o-nav-ic burger" aria-label="Menu" onClick={open('section', 250)}>
              <Icon name="burger" />
            </button>
          </>
        )}

        <span className="spacer" />

        {role === 'admin' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = query.trim();
              router.push(q ? `/admin/search?q=${encodeURIComponent(q)}` : '/admin/search');
            }}
            style={{ display: 'flex' }}
          >
            <input
              className="navsearch"
              placeholder="Search leads…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search leads and customers"
            />
          </form>
        )}

        <button type="button" className="o-nav-ic" title="All apps" aria-label="All apps" onClick={open('apps', 280)}>
          <Icon name="grid" />
        </button>

        {user && <NotificationsPanel variant="nav" getIdToken={getIdToken} uid={user.uid} role={role ?? undefined} />}

        <button type="button" className="o-nav-user" onClick={open('account', 250)}>
          <span className="ini">{initials || 'U'}</span>
          <span className="nm">{name}</span>
        </button>
      </header>

      {menu && (
        <>
          <div className="scrim" onClick={() => setMenu(null)} />
          <div className="menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {menu.id === 'account' && (
              <>
                <h5>Signed in as</h5>
                <button type="button" onClick={() => go('/appearance')}>
                  <Icon name="user" />
                  <span className="row2">
                    {user?.email}
                    <small style={{ textTransform: 'capitalize' }}>{role === 'subadmin' ? 'Manager' : role}</small>
                  </span>
                </button>
                <div className="sep" />
                <button type="button" onClick={() => go('/home')}>
                  <Icon name="home" /> Home
                </button>
                <button type="button" onClick={() => go('/appearance')}>
                  <Icon name="palette" /> Appearance
                </button>
                <div className="sep" />
                <button
                  type="button"
                  style={{ color: 'var(--bad)' }}
                  onClick={async () => {
                    setMenu(null);
                    await logout();
                    router.replace('/');
                  }}
                >
                  <Icon name="logout" /> Sign out
                </button>
              </>
            )}
            {menu.id === 'section' && section && (
              <>
                <h5>{section.label}</h5>
                {section.items.map((item) => (
                  <button key={item.path} type="button" className={hit?.item.path === item.path ? 'on' : ''} onClick={() => go(item.path)}>
                    {item.label}
                  </button>
                ))}
              </>
            )}
            {menu.id === 'apps' && (
              <>
                <h5>Go to</h5>
                <button type="button" onClick={() => go('/home')}>
                  <Icon name="home" /> Home
                </button>
                {sections.map((s) => (
                  <button key={s.id} type="button" className={section?.id === s.id ? 'on' : ''} onClick={() => go(s.items[0].path)}>
                    <Icon name="grid" /> {s.label}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

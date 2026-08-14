import { useRef } from 'react'
import type { MenuPopupRequest } from '@shared/types'

interface Props {
  inspectorOpen: boolean
  onToggleInspector: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

export default function TabBar({
  inspectorOpen,
  onToggleInspector,
  sidebarCollapsed,
  onToggleSidebar
}: Props): JSX.Element {
  const menuRefs = useRef<Record<MenuPopupRequest['menu'], HTMLButtonElement | null>>({
    file: null,
    edit: null,
    view: null,
    help: null
  })

  const openMenu = (menu: MenuPopupRequest['menu']): void => {
    const button = menuRefs.current[menu]
    if (!button) return
    const rect = button.getBoundingClientRect()
    void window.prime.menuPopup({
      menu,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom)
    })
  }

  return (
    <div className="codex-topbar">
      <div className="topbar-leading">
        <button
          className="topbar-nav-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
        >
          <SidebarIcon />
        </button>
        <button className="topbar-nav-btn" disabled title="Back" aria-label="Back">
          <ChevronIcon direction="left" />
        </button>
        <button className="topbar-nav-btn" disabled title="Forward" aria-label="Forward">
          <ChevronIcon direction="right" />
        </button>
        <div className="topbar-menu" role="menubar" aria-label="Application menu">
          {(['File', 'Edit', 'View', 'Help'] as const).map((label) => (
            <button
              key={label}
              ref={(button) => { menuRefs.current[label.toLowerCase() as MenuPopupRequest['menu']] = button }}
              className="topbar-menu-btn"
              onClick={() => openMenu(label.toLowerCase() as MenuPopupRequest['menu'])}
              role="menuitem"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="topbar-drag-region" />
      <button
        className={`topbar-inspector-btn ${inspectorOpen ? 'active' : ''}`}
        onClick={onToggleInspector}
        title={inspectorOpen ? 'Close inspector' : 'Open inspector'}
        aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.5" y="3" width="15" height="14" rx="2.5" />
          <path d="M12.5 3v14" />
        </svg>
      </button>
    </div>
  )
}

function SidebarIcon(): JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }): JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden><path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} /></svg>
}

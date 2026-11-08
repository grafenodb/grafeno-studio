import { type ReactNode, useState } from "react";

import { Icon } from "../icons.tsx";

/** A reusable, compact inspector surface for the currently selected object. */
export function InspectorPanel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={`panel contextual-inspector ${collapsed ? "collapsed" : ""} ${className}`.trim()} aria-label={`${title} inspector`}>
      <header className="panel-heading inspector-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <button
          className="ghost icon-button"
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          title={collapsed ? "Expand inspector" : "Collapse inspector"}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Icon name={collapsed ? "chevronLeft" : "chevronRight"} size={15} />
        </button>
      </header>
      {!collapsed && <div className="inspector-content">{children}</div>}
    </aside>
  );
}

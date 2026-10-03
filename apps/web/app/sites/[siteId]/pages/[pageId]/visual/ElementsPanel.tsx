"use client";

import type { ReusableElement } from "./VisualEditorClient";

/** Keeps categories in a fixed, sensible reading order instead of whatever order the bridge's scan
 * happened to encounter them in (which follows document order, so e.g. a footer's "Buttons & links"
 * could otherwise sort ahead of the hero's "Headings"). Any category not listed here (there
 * currently aren't any, but this keeps the panel correct if the scanner ever grows a new one
 * without a matching update here) falls back to appearing after all the known ones, not silently
 * disappearing.
 */
const CATEGORY_ORDER = ["Headings", "Buttons & links", "Images", "Repeating blocks"];

function groupByCategory(items: ReusableElement[]): Array<[string, ReusableElement[]]> {
  const groups = new Map<string, ReusableElement[]>();
  for (const item of items) {
    const list = groups.get(item.category);
    if (list) list.push(item);
    else groups.set(item.category, [item]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    const indexA = CATEGORY_ORDER.indexOf(a);
    const indexB = CATEGORY_ORDER.indexOf(b);
    return (indexA === -1 ? CATEGORY_ORDER.length : indexA) - (indexB === -1 ? CATEGORY_ORDER.length : indexB);
  });
}

/**
 * Drag-and-drop source for elements the bridge scanned out of the CURRENT page itself (see
 * scanReusableElements in apps/preview/src/server.ts) — not a hardcoded generic component library,
 * so every candidate already matches this specific template's own styling. Dragging one onto the
 * canvas inserts a real copy of it; see VisualEditorClient's "dropAccepted" message handling for
 * where the drop actually lands.
 */
export function ElementsPanel({
  items,
  onDragStart,
  onDragEnd
}: {
  items: ReusableElement[];
  onDragStart: (item: ReusableElement) => void;
  onDragEnd: () => void;
}) {
  if (items.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Scanning this page for reusable buttons, headings, images, and repeating blocks&hellip;
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
        Drag one of these onto the canvas to add another copy, already matching this page&apos;s own styling.
      </p>
      {groupByCategory(items).map(([category, groupItems]) => (
        <div key={category} className="settings-section">
          <p className="settings-section-title" style={{ margin: 0 }}>
            {category}
          </p>
          <div style={{ display: "grid", gap: 2 }}>
            {groupItems.map((item) => (
              <div
                key={item.nodeId}
                className="layers-row"
                draggable
                onDragStart={(event) => {
                  // The payload itself travels in React state (see VisualEditorClient's
                  // draggingElement), not dataTransfer — this call is only here because some
                  // browsers refuse to start a drag at all unless setData is called at least once.
                  event.dataTransfer.setData("text/plain", "igle-element");
                  event.dataTransfer.effectAllowed = "copy";
                  onDragStart(item);
                }}
                onDragEnd={onDragEnd}
                style={{ cursor: "grab" }}
                title={`Drag onto the canvas to insert a copy of this <${item.tagName}>`}
              >
                <span className="layers-row-tag">{item.tagName}</span>
                {item.label ? <span className="layers-row-label muted">{item.label}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { NavPage, TreeNode } from "./VisualEditorClient";

/** body + its direct children expanded, everything deeper collapsed — mirrors how a fresh VS Code
 * explorer or Figma layer tree starts: the root is open, one level in is visible, no further. */
function defaultExpanded(root: TreeNode | null): Set<number> {
  const next = new Set<number>();
  if (!root) return next;
  next.add(root.nodeId);
  for (const child of root.children) next.add(child.nodeId);
  return next;
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedNodeId,
  onSelectNode
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (nodeId: number) => void;
  selectedNodeId: number | null;
  onSelectNode: (nodeId: number) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.nodeId);
  return (
    <>
      <div
        className={`layers-row${node.nodeId === selectedNodeId ? " is-selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelectNode(node.nodeId)}
      >
        <button
          type="button"
          className="layers-row-toggle"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(node.nodeId);
          }}
          aria-label={isExpanded ? "Collapse" : "Expand"}
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
        >
          {isExpanded ? "▾" : "▸"}
        </button>
        <span className="layers-row-tag">{node.tagName}</span>
        {node.label ? <span className="layers-row-label muted">{node.label}</span> : null}
      </div>
      {hasChildren && isExpanded
        ? node.children.map((child) => (
            <TreeRow
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))
        : null}
    </>
  );
}

/**
 * Left-sidebar panel: this site's page list + a live Layers tree of the current page — both
 * "VS Code/Figma-flavored" navigation on top of data the rest of the app already has. See
 * visual/page.tsx for where `pages` comes from, and buildTree (the preview bridge) for where
 * `treeRoot` comes from.
 */
export function LayersPanel({
  siteId,
  pageId,
  pages,
  treeRoot,
  selectedNodeId,
  selectedAncestorIds,
  onSelectNode
}: {
  siteId: string;
  pageId: string;
  pages: NavPage[];
  treeRoot: TreeNode | null;
  selectedNodeId: number | null;
  selectedAncestorIds: number[];
  onSelectNode: (nodeId: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => defaultExpanded(treeRoot));

  // A fresh tree snapshot means node ids may have shifted (see buildTree's doc comment in the
  // preview bridge) — expand state is only ever valid for the snapshot it was built against, so it
  // resets to the default rather than trying to carry stale ids forward.
  useEffect(() => {
    setExpanded(defaultExpanded(treeRoot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeRoot]);

  // Clicking an element in the canvas should reveal it in the tree even if its ancestors were
  // collapsed — selected.ancestors already gives us exactly the ids to open.
  useEffect(() => {
    if (selectedAncestorIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of selectedAncestorIds) next.add(id);
      return next;
    });
  }, [selectedAncestorIds]);

  function toggle(nodeId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="settings-section">
        <p className="settings-section-title" style={{ margin: 0 }}>
          Pages
        </p>
        <div style={{ display: "grid", gap: 2 }}>
          {pages.map((page) =>
            page.id === pageId ? (
              <span key={page.id} className="layers-row is-selected">
                {page.internalName}
              </span>
            ) : (
              <Link key={page.id} href={`/sites/${siteId}/pages/${page.id}/visual`} className="layers-row">
                {page.internalName}
              </Link>
            )
          )}
        </div>
      </div>

      <div className="settings-section">
        <p className="settings-section-title" style={{ margin: 0 }}>
          Layers
        </p>
        {treeRoot ? (
          <div>
            <TreeRow node={treeRoot} depth={0} expanded={expanded} onToggle={toggle} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Loading page structure&hellip;
          </p>
        )}
      </div>
    </div>
  );
}

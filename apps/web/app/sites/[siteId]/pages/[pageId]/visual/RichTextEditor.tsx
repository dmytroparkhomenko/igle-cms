"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";

const RICH_TEXT_ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "strike",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td"
]);

const RICH_TEXT_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]),
  th: new Set(["colspan", "rowspan"]),
  td: new Set(["colspan", "rowspan"])
};

/** Whether this HTML fragment only uses tags/attributes the schema below (StarterKit + Table) can
 * actually represent. Real section markup is full of classes, wrapper divs and icon tags that have
 * no matching schema node — parsing that into the editor and back out silently drops them. Gating
 * on this keeps such content on the Raw HTML tab, untouched, instead of losing it to an edit here. */
export function canUseRichText(html: string): boolean {
  if (typeof document === "undefined") return false;
  const container = document.createElement("div");
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as Element | null;
  while (node) {
    const tag = node.tagName.toLowerCase();
    if (!RICH_TEXT_ALLOWED_TAGS.has(tag)) return false;
    const allowedAttrs = RICH_TEXT_ALLOWED_ATTRS[tag];
    for (const attr of Array.from(node.attributes)) {
      if (!allowedAttrs?.has(attr.name)) return false;
    }
    node = walker.nextNode() as Element | null;
  }
  return true;
}

function setLink(editor: Editor) {
  const previousUrl = (editor.getAttributes("link").href as string | undefined) ?? "";
  const url = window.prompt("Link URL (leave blank to remove)", previousUrl || "https://");
  if (url === null) return;
  if (url.trim() === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  title
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      className={`rich-text-toolbar-button${active ? " is-active" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

/** WYSIWYG editor for the "Edit as HTML" modal's Rich text tab — built on a deliberately small
 * schema (StarterKit + Table) so its output stays plain, predictable markup. Only ever mounted by
 * the caller when `canUseRichText(html)` above is true; the caller is responsible for keeping
 * content this schema can't represent (custom classes, embeds, arbitrary divs) on the Raw HTML tab
 * instead, since editing it here would silently drop that markup on apply. */
export function RichTextEditor({ html, onChange }: { html: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell
    ],
    content: html,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-text-editor-content"
      }
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML())
  });

  if (!editor) return null;

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar">
        <ToolbarButton label="B" title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
        <ToolbarButton label="I" title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <ToolbarButton label="S" title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <ToolbarButton label="U" title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <ToolbarButton label="{ }" title="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />
        <span className="rich-text-toolbar-sep" />
        <ToolbarButton label="H1" title="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolbarButton label="H2" title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolbarButton label="H3" title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
        <ToolbarButton label="P" title="Paragraph" active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()} />
        <span className="rich-text-toolbar-sep" />
        <ToolbarButton label="• List" title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolbarButton label="1. List" title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolbarButton label="” Quote" title="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolbarButton label="—" title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <span className="rich-text-toolbar-sep" />
        <ToolbarButton label="Link" title="Add or edit link" active={editor.isActive("link")} onClick={() => setLink(editor)} />
        <ToolbarButton label="Table" title="Insert 3x3 table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <span className="rich-text-toolbar-sep" />
        <ToolbarButton label="↶" title="Undo (in this editor)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
        <ToolbarButton label="↷" title="Redo (in this editor)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

"use client";
import { formatRanges, selectionAtomCount, selectionToRanges } from "../../lib/lab/selection";
import type { SelectionBookmark } from "../../lib/lab/bookmarks";
import { TinyText, Tooltip } from "./ui";
import { TrayButton } from "./StyleTray";

// The saved-selection stack: numbered buttons to the left of the density icon.
// Left click resurrects the bookmark's SELECTION (the stored RepStyle is no longer
// applied — restoring it silently restyled the whole structure); the corner cross
// (shown on hover) deletes it, right click still works as a shortcut. Renders
// nothing while the entry has no bookmarks.

export default function BookmarkTray({
  bookmarks,
  onApply,
  onDelete,
}: {
  bookmarks: readonly SelectionBookmark[];
  onApply: (b: SelectionBookmark) => void;
  onDelete: (id: string) => void;
}) {
  if (bookmarks.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {bookmarks.map((b, i) => {
        const label = formatRanges(selectionToRanges(b.selection), { maxSegments: 3 });
        const atoms = selectionAtomCount(b.selection);
        const desc = `${label}${atoms ? ` (${atoms} atoms)` : ""}`;
        return (
          <Tooltip
            key={b.id}
            content={
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">bookmark {i + 1}</span>
                <span>{desc}</span>
                <TinyText>click to restore the selection; the corner cross deletes it</TinyText>
              </div>
            }
          >
            <span className="group relative inline-flex">
              <TrayButton
                active={false}
                label={`bookmark ${i + 1}: ${desc}`}
                onClick={() => onApply(b)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onDelete(b.id);
                }}
              >
                <span className="text-[10.5px] tabular-nums">{i + 1}</span>
              </TrayButton>
              <button
                type="button"
                aria-label={`delete bookmark ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(b.id);
                }}
                className="absolute -right-1 -top-1 hidden h-3 w-3 items-center justify-center rounded-full border border-line-strong bg-white text-[8px] leading-none text-ink-muted hover:border-danger hover:text-danger group-hover:flex"
              >
                {"×"}
              </button>
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

"use client";
import { formatRanges, selectionAtomCount, selectionToRanges } from "@/lib/lab/selection";
import type { SelectionBookmark } from "@/lib/lab/bookmarks";
import { TrayButton } from "./StyleTray";

// The saved-selection stack: numbered buttons to the left of the density icon.
// Left click resurrects the bookmark (selection + the RepStyle it was saved with),
// right click deletes it (the viewer wrapper already suppresses the native menu).
// Renders nothing while the entry has no bookmarks.

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
          <TrayButton
            key={b.id}
            active={false}
            label={`bookmark ${i + 1}: ${desc}`}
            title={`${desc} — click to restore, right click to delete`}
            onClick={() => onApply(b)}
            onContextMenu={(e) => {
              e.preventDefault();
              onDelete(b.id);
            }}
          >
            <span className="text-[10.5px] tabular-nums">{i + 1}</span>
          </TrayButton>
        );
      })}
    </div>
  );
}

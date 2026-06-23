import { useEffect, useRef, useState } from "react";
import type { Tile, NoteChecklistItem, TileSettings } from "@workspace/api-client-react";
import { useUpdateTile, getGetTilesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X, Check, Eraser } from "lucide-react";

// Preset post-it colors shown in the editor's color picker. The default is the
// classic sticky-note yellow.
export const NOTE_PRESET_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#fef08a" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Orange", value: "#fed7aa" },
  { label: "Purple", value: "#e9d5ff" },
];

export const DEFAULT_NOTE_COLOR = "#fef08a";
// A dark, slightly warm gray that reads well over every preset post-it color.
export const DEFAULT_NOTE_TEXT_COLOR = "#3f3f46";

export const NOTE_FONT_SIZES = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
] as const;

export type NoteFontSize = (typeof NOTE_FONT_SIZES)[number]["value"];

// Tailwind text-size classes for the note body per font-size setting. Checklist
// rows render one step smaller so the free text stays the focal point.
const BODY_FONT_CLASS: Record<string, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};
const ITEM_FONT_CLASS: Record<string, string> = {
  sm: "text-[11px]",
  md: "text-xs",
  lg: "text-sm",
};

const SAVE_DEBOUNCE_MS = 600;

interface NoteTileProps {
  tile: Tile;
  // In edit (layout) mode the tile is a drag/resize target, so inline editing is
  // disabled — content editing happens in locked mode.
  editMode: boolean;
}

// A post-it style note tile. Its content (free text + checklist) is created and
// edited in-place by the user and debounced back to the server through the
// normal tile-update flow; its appearance (color, font size, text color) is set
// from the tile editor modal.
export default function NoteTile({ tile, editMode }: NoteTileProps) {
  const queryClient = useQueryClient();
  const updateTile = useUpdateTile({
    mutation: {
      onSuccess: (updated) => {
        // Reconcile the saved note into the tile list cache so a later refetch
        // doesn't clobber what the user just typed.
        queryClient.setQueryData<Tile[]>(getGetTilesQueryKey(), (old) =>
          old?.map((t) => (t.id === updated.id ? updated : t)),
        );
      },
    },
  });

  const color = tile.tileSettings?.noteColor || DEFAULT_NOTE_COLOR;
  const textColor = tile.tileSettings?.noteTextColor || DEFAULT_NOTE_TEXT_COLOR;
  const fontSize = tile.tileSettings?.noteFontSize ?? "md";
  const bodyClass = BODY_FONT_CLASS[fontSize] ?? BODY_FONT_CLASS["md"]!;
  const itemClass = ITEM_FONT_CLASS[fontSize] ?? ITEM_FONT_CLASS["md"]!;

  const [body, setBody] = useState(tile.tileSettings?.noteBody ?? "");
  const [items, setItems] = useState<NoteChecklistItem[]>(
    tile.tileSettings?.noteItems ?? [],
  );

  // Reset local content only when a different tile mounts in this slot — never on
  // every prop change, so an in-flight save round-trip can't overwrite live typing.
  const lastIdRef = useRef(tile.id);
  useEffect(() => {
    if (lastIdRef.current !== tile.id) {
      lastIdRef.current = tile.id;
      setBody(tile.tileSettings?.noteBody ?? "");
      setItems(tile.tileSettings?.noteItems ?? []);
    }
  }, [tile]);

  // Latest values for the debounced/unmount flush, kept current via refs so the
  // timer always persists the freshest content (and the freshest appearance).
  const tileRef = useRef(tile);
  tileRef.current = tile;
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function persistNow(nextBody: string, nextItems: NoteChecklistItem[]) {
    const current = tileRef.current;
    // Preserve every other tileSettings key (appearance, scrollable, …) since a
    // PUT replaces the whole settings blob.
    const settings: TileSettings = {
      ...(current.tileSettings ?? {}),
      noteBody: nextBody,
      noteItems: nextItems,
    };
    updateTile.mutate({ id: current.id, data: { tileSettings: settings } });
  }

  function scheduleSave(nextBody: string, nextItems: NoteChecklistItem[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      persistNow(nextBody, nextItems);
    }, SAVE_DEBOUNCE_MS);
  }

  // Flush a pending save on unmount so a fast edit just before navigating away
  // isn't lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        persistNow(bodyRef.current, itemsRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-grow the body textarea to fit its content; the surrounding body scrolls.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, fontSize]);

  function handleBodyChange(value: string) {
    setBody(value);
    scheduleSave(value, itemsRef.current);
  }

  function updateItems(next: NoteChecklistItem[]) {
    setItems(next);
    scheduleSave(bodyRef.current, next);
  }

  function toggleItem(index: number) {
    updateItems(
      items.map((it, i) => (i === index ? { ...it, done: !it.done } : it)),
    );
  }

  function changeItemText(index: number, text: string) {
    updateItems(items.map((it, i) => (i === index ? { ...it, text } : it)));
  }

  function removeItem(index: number) {
    updateItems(items.filter((_, i) => i !== index));
  }

  function addItem() {
    updateItems([...items, { text: "", done: false }]);
  }

  // Wipe the note clean — clear both the body text and the whole checklist in a
  // single save.
  function clearNote() {
    setBody("");
    setItems([]);
    scheduleSave("", []);
  }

  const readOnly = editMode;
  const hasContent = body.trim().length > 0 || items.length > 0;

  return (
    <div
      className="group absolute inset-0 flex flex-col overflow-hidden"
      style={{ background: color, color: textColor }}
    >
      <div className="flex-1 min-h-0 overflow-auto p-2.5 flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          readOnly={readOnly}
          placeholder="Write a note…"
          rows={2}
          aria-label="Note text"
          className={`w-full resize-none overflow-hidden bg-transparent outline-none border-none leading-snug placeholder:opacity-40 ${bodyClass}`}
          style={{ color: textColor }}
        />

        {(items.length > 0 || !readOnly) && (
          <div className="flex flex-col gap-1">
            {items.map((item, index) => (
              <div key={index} className="flex items-center gap-1.5 group/item">
                <button
                  type="button"
                  onClick={() => !readOnly && toggleItem(index)}
                  disabled={readOnly}
                  aria-label={item.done ? "Mark not done" : "Mark done"}
                  aria-pressed={item.done}
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[3px] border transition-colors"
                  style={{
                    borderColor: textColor,
                    background: item.done ? textColor : "transparent",
                  }}
                >
                  {item.done && (
                    <Check className="h-3 w-3" style={{ color: color }} />
                  )}
                </button>
                <input
                  value={item.text}
                  onChange={(e) => changeItemText(index, e.target.value)}
                  readOnly={readOnly}
                  placeholder="List item"
                  aria-label="Checklist item"
                  className={`flex-1 min-w-0 bg-transparent outline-none border-none placeholder:opacity-40 ${itemClass} ${
                    item.done ? "line-through opacity-60" : ""
                  }`}
                  style={{ color: textColor }}
                />
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    aria-label="Remove item"
                    className="flex-shrink-0 opacity-0 transition-opacity group-hover/item:opacity-70 hover:!opacity-100"
                    style={{ color: textColor }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!readOnly && (
              <button
                type="button"
                onClick={addItem}
                className={`flex items-center gap-1 self-start opacity-60 transition-opacity hover:opacity-100 ${itemClass}`}
                style={{ color: textColor }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add item
              </button>
            )}
          </div>
        )}
      </div>

      {/* Clear button: wipes the note's text and checklist. Only available in
          locked mode (editing is disabled while arranging the layout), and only
          when there is something to clear. */}
      {!readOnly && hasContent && (
        <button
          type="button"
          onClick={clearNote}
          aria-label="Clear note"
          title="Clear note"
          className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-70 hover:!opacity-100"
          style={{ color: textColor }}
        >
          <Eraser className="h-3 w-3" />
          Clear
        </button>
      )}

      {/* A subtle folded corner gives the tile its playful post-it character. */}
      <div
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 border-b-[14px] border-l-[14px] border-l-transparent"
        style={{ borderBottomColor: "rgba(0,0,0,0.12)" }}
      />
    </div>
  );
}

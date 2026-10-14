import { useEffect, useRef } from "react";
import { type Action, type Menu, SCENE_H, SCENE_W } from "../engine";

interface Props {
  menu: Menu;
  onChoose(action: Action["id"]): void;
  onClose(): void;
}

// kept inside the room's picture, in hundredths of it
const within = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

// What you could do with the piece of the room that was clicked, at the click: a
// list of buttons, the first of which has the keyboard. Escape puts it away, and
// so does a click anywhere else (the room's own, in OfficeCanvas).
export function ActionMenu({ menu, onChoose, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    // Escape is kept from the room behind and the session view, which have uses of their own for it
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [menu, onClose]);

  return (
    <div
      className="actions"
      ref={box}
      role="menu"
      aria-label={`What to do with the ${menu.name.toLowerCase()}`}
      style={{ left: `${within((menu.sx / SCENE_W) * 100, 12, 88)}%`, top: `${within((menu.sy / SCENE_H) * 100, 4, 78)}%` }}
    >
      <p>{menu.name}</p>
      {menu.actions.map((action) => (
        <button key={action.id} type="button" role="menuitem" disabled={action.taken} onClick={() => onChoose(action.id)}>
          {action.label}
          {action.taken && <span> · taken</span>}
        </button>
      ))}
    </div>
  );
}

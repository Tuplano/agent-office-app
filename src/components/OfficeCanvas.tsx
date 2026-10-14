import { type DragEvent, type MouseEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { useOfficeState } from "../data/useOfficeState";
import { type Action, createOffice, type Menu, type Office, SCENE_H, SCENE_W } from "../engine";
import { carried } from "../lib/carried";
import type { Pointed } from "../lib/pointed";
import { ActionMenu } from "./ActionMenu";

interface Props {
  pointed: Pointed | null;
  onPoint(pointed: Pointed | null): void;
  picked: string | null; // the session whose view is open
  onPick(id: string): void;
  // hands the office up once it is made, and null when it is gone
  onReady(office: Office | null): void;
  editing: boolean; // the room is being rearranged: the name tags are out of the way
}

export function OfficeCanvas({ pointed, onPoint, picked, onPick, onReady, editing }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const office = useRef<Office | null>(null);
  const { state, loaded } = useOfficeState();
  const hot = pointed?.on === "card" ? pointed.id : null;
  // what you could do with the piece of the room last clicked
  const [menu, setMenu] = useState<Menu | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const choose = (action: Action["id"]) => {
    if (menu) office.current?.act(menu, action);
    setMenu(null);
  };

  // the latest way to open a session, for the office made once
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!canvas.current || !tags.current) return;
    const made = createOffice(canvas.current, tags.current, { menu: setMenu, talk: (id) => pick.current(id) });
    office.current = made;
    onReady(made);
    return () => {
      office.current = null;
      onReady(null);
      made.destroy();
    };
  }, [onReady]);

  // after the effect above, so the office is there to take the first state; nothing
  // is shown before a real one has arrived, so that one is the first load
  useEffect(() => {
    if (loaded) office.current?.apply(state);
  }, [state, loaded]);

  useEffect(() => {
    office.current?.point(hot);
  }, [hot]);

  useEffect(() => {
    office.current?.pickOut(picked);
  }, [picked]);

  // put away while the room is edited
  useEffect(() => {
    if (editing) setMenu(null);
  }, [editing]);

  // a press anywhere but on the menu puts it away; one on the room may open another
  const pressed = (event: PointerEvent) => {
    if (menu && !(event.target as Element).closest(".actions")) setMenu(null);
  };

  // the engine makes the name tags; the pointer passing over one, and a click on
  // one, are caught here
  const tagged = (event: MouseEvent) => (event.target as Element).closest<HTMLElement>(".tag:not(.gone)")?.dataset.session;
  const over = (event: MouseEvent) => {
    const id = tagged(event);
    onPoint(id ? { id, on: "tag" } : null);
  };
  // a tag is a link to its card, and the click opens the session in place of following it
  const click = (event: MouseEvent) => {
    const id = tagged(event);
    if (!id) return;
    event.preventDefault();
    onPick(id);
  };

  // A piece dragged out of the list to add from is shown where it would go while
  // it is over the room, and put down where it is let go.
  const inScene = (event: DragEvent): [number, number] => {
    const box = canvas.current!.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * SCENE_W, ((event.clientY - box.top) / box.height) * SCENE_H];
  };
  const carry = (event: DragEvent) => {
    if (!carried.kind || !office.current || !canvas.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    office.current.edit.carry(carried.kind, ...inScene(event));
  };
  const put = (event: DragEvent) => {
    if (!carried.kind || !office.current || !canvas.current) return;
    event.preventDefault();
    office.current.edit.put(carried.kind, ...inScene(event));
    carried.kind = null;
  };

  return (
    <div className={editing ? "stage editing" : "stage"} onDragOver={carry} onDrop={put} onDragLeave={() => office.current?.edit.letGo()} onPointerDownCapture={pressed}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="The office: one seat per session, each listed in full in the session list"
      />
      <div className="tags" ref={tags} onMouseOver={over} onMouseOut={() => onPoint(null)} onClick={click} />
      {menu && !editing && <ActionMenu menu={menu} onChoose={choose} onClose={close} />}
    </div>
  );
}

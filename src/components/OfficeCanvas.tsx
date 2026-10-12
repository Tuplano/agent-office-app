import { type MouseEvent, useEffect, useRef } from "react";
import { useOfficeState } from "../data/useOfficeState";
import { createOffice, type Office } from "../engine";
import type { Pointed } from "../lib/pointed";

interface Props {
  pointed: Pointed | null;
  onPoint(pointed: Pointed | null): void;
  // hands the office up once it is made, and null when it is gone
  onReady(office: Office | null): void;
  editing: boolean; // the room is being rearranged: the name tags are out of the way
}

export function OfficeCanvas({ pointed, onPoint, onReady, editing }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const office = useRef<Office | null>(null);
  const { state, loaded } = useOfficeState();
  const hot = pointed?.on === "card" ? pointed.id : null;

  useEffect(() => {
    if (!canvas.current || !tags.current) return;
    const made = createOffice(canvas.current, tags.current);
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

  // the engine makes the name tags; the pointer passing over one is caught here
  const over = (event: MouseEvent) => {
    const id = (event.target as Element).closest<HTMLElement>(".tag:not(.gone)")?.dataset.session;
    onPoint(id ? { id, on: "tag" } : null);
  };

  return (
    <div className={editing ? "stage editing" : "stage"}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="The office: one seat per session, each listed in full in the session list"
      />
      <div className="tags" ref={tags} onMouseOver={over} onMouseOut={() => onPoint(null)} />
    </div>
  );
}

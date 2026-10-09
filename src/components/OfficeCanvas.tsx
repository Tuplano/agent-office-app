import { type MouseEvent, useEffect, useRef } from "react";
import { useOfficeState } from "../data/useOfficeState";
import { createOffice, type Office } from "../engine";
import type { Pointed } from "../lib/pointed";

interface Props {
  pointed: Pointed | null;
  onPoint(pointed: Pointed | null): void;
}

export function OfficeCanvas({ pointed, onPoint }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const office = useRef<Office | null>(null);
  const { state } = useOfficeState();
  const hot = pointed?.on === "card" ? pointed.id : null;

  useEffect(() => {
    if (!canvas.current || !tags.current) return;
    const made = createOffice(canvas.current, tags.current);
    office.current = made;
    return () => {
      office.current = null;
      made.destroy();
    };
  }, []);

  // after the effect above, so the office is there to take the first state
  useEffect(() => {
    office.current?.apply(state);
  }, [state]);

  useEffect(() => {
    office.current?.point(hot);
  }, [hot]);

  // the engine makes the name tags; the pointer passing over one is caught here
  const over = (event: MouseEvent) => {
    const id = (event.target as Element).closest<HTMLElement>(".tag")?.dataset.session;
    onPoint(id ? { id, on: "tag" } : null);
  };

  return (
    <div className="stage">
      <canvas
        ref={canvas}
        role="img"
        aria-label="The office: one seat per session, each listed in full in the session list"
      />
      <div className="tags" ref={tags} onMouseOver={over} onMouseOut={() => onPoint(null)} />
    </div>
  );
}

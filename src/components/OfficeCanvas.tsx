import { useEffect, useRef } from "react";
import { useOfficeState } from "../data/useOfficeState";
import { createOffice, type Office } from "../engine";

export function OfficeCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);
  const office = useRef<Office | null>(null);
  const { state } = useOfficeState();

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

  return (
    <div className="stage">
      <canvas
        ref={canvas}
        role="img"
        aria-label="The office: one seat per session, each listed in full in the session list"
      />
      <div className="tags" ref={tags} />
    </div>
  );
}

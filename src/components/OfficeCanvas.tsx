import { useEffect, useRef } from "react";
import { createOffice } from "../engine";

export function OfficeCanvas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tags = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvas.current || !tags.current) return;
    const office = createOffice(canvas.current, tags.current);
    return office.destroy;
  }, []);

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

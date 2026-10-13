import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { type Editor, drawPreview, LIMITS, type Model, previewPoint, SCENE_H, SCENE_W, TABLE_TOP, type View } from "../engine";
import { readModel, type Source } from "../import/read";
import { CUBE, fitting, makeModel, markAt, Refusal, type SeatMark, seatHeight, sizeOf } from "../import/voxels";

interface Props {
  file: File;
  editor: Editor;
  onDone(): void;
}

const SIZES = [0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 2, 2.5, 3, 4]; // times the size it comes in
const TURN: Record<SeatMark["dir"], SeatMark["dir"]> = { S: "W", W: "N", N: "E", E: "S" };
const why = (error: unknown) => (error instanceof Refusal ? error.message : "It could not be read.");

// What is asked about a model before it becomes a piece: its name, how big it is,
// which way it faces, whether it stands or lies, whether it has a top to work at,
// and where people sit on it. The model is shown as it will be, and turns about.
export function ImportForm({ file, editor, onDone }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [refused, setRefused] = useState("");
  const [name, setName] = useState("");
  const [by, setBy] = useState(1);
  const [turn, setTurn] = useState(0);
  const [flat, setFlat] = useState(false);
  const [top, setTop] = useState<number | null>(null);
  // where people sit, on the model as it came and at the size it came in
  const [seats, setSeats] = useState<SeatMark[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [yaw, setYaw] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const press = useRef<{ x: number; yaw: number; moved: boolean } | null>(null);

  const most = source ? fitting(source.size) : 1;
  const sizes = useMemo(() => [...SIZES.filter((size) => size < most), ...(most < SIZES[SIZES.length - 1] ? [most] : [])], [most]);

  // the file is read once, and what the form starts from is worked out from what was in it
  useEffect(() => {
    let dropped = false;
    file
      .arrayBuffer()
      .then((bytes) => readModel(file.name, bytes))
      .then((read) => {
        if (dropped) return;
        const fits = fitting(read.size);
        const start = Math.min(1, fits);
        const { voxels, seats: marked } = read.blocks(start);
        const [w, d, h] = sizeOf(voxels);
        const chair = Math.min(w, d) >= 5 && Math.max(w, d) <= 12 && h >= 8 && h <= 26; // the size of something to sit on
        const middle: SeatMark = { x: w / 2, y: d / 2, z: seatHeight(voxels, w / 2, d / 2), dir: "S" };
        const sat = marked.length ? marked : chair ? [middle] : [];
        setSource(read);
        setName(read.name);
        setBy(start);
        setSeats(sat.slice(0, LIMITS.seats).map((seat) => ({ ...seat, x: seat.x / start, y: seat.y / start, z: seat.z / start })));
        setFlat(h <= 1);
        setTop(!sat.length && h >= 8 && h <= 16 ? h : null);
      })
      .catch((error) => !dropped && setRefused(why(error)));
    return () => {
      dropped = true;
    };
  }, [file]);

  const blocks = useMemo(() => {
    if (!source) return null;
    try {
      return source.blocks(by).voxels;
    } catch (error) {
      return why(error);
    }
  }, [source, by]);
  const made = useMemo((): Model | string | null => {
    if (!blocks || typeof blocks === "string") return blocks;
    try {
      return makeModel(blocks, { name, turn, flat, top, seats: seats.map((seat) => ({ ...seat, x: seat.x * by, y: seat.y * by, z: seat.z * by })) });
    } catch (error) {
      return why(error);
    }
  }, [blocks, name, turn, flat, top, seats, by]);
  const model = made && typeof made !== "string" ? made : null;
  const trouble = refused || (typeof made === "string" ? made : "");

  useEffect(() => {
    if (canvas.current && model) view.current = drawPreview(canvas.current, model, yaw, picked);
  }, [model, yaw, picked]);

  // a point of the page as a point of the picture
  const inPicture = (event: PointerEvent): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * SCENE_W, ((event.clientY - box.top) / box.height) * SCENE_H];
  };
  // A click on the model: on someone sitting there, it picks them out; anywhere
  // else on its floor, it sits someone down, looking the way the model faces.
  const click = (event: PointerEvent) => {
    if (!model || !view.current || !blocks || typeof blocks === "string") return;
    const [sx, sy] = inPicture(event);
    const near = model.seats.findIndex((seat) => {
      const [x, y] = previewPoint(view.current!, sx, sy, seat.z + 6);
      return Math.hypot(x - seat.x, y - seat.y) < 4;
    });
    if (near >= 0) return setPicked(near === picked ? null : near);
    if (seats.length >= LIMITS.seats) return;
    const [fx, fy] = previewPoint(view.current, sx, sy, 0);
    if (fx < 0 || fy < 0 || fx > model.box[0] || fy > model.box[1]) return setPicked(null);
    // first where it would be on the floor, then on top of whatever of the model is there
    const low = markAt(blocks, turn, fx, fy, 0, "S");
    const z = seatHeight(blocks, low.x, low.y);
    const [x, y] = previewPoint(view.current, sx, sy, z);
    const mark = markAt(blocks, turn, Math.max(0, Math.min(model.box[0], x)), Math.max(0, Math.min(model.box[1], y)), z, "S");
    setSeats([...seats, { ...mark, x: mark.x / by, y: mark.y / by, z: mark.z / by }]);
    setPicked(seats.length);
  };
  const change = (index: number, to: (seat: SeatMark) => SeatMark) => setSeats(seats.map((seat, i) => (i === index ? to(seat) : seat)));
  const step = (way: number) => {
    const at = sizes.findIndex((size) => size >= by - 1e-9);
    setBy(sizes[Math.max(0, Math.min(sizes.length - 1, (at < 0 ? sizes.length - 1 : at) + way))]);
  };

  const add = () => {
    if (!model) return;
    editor.importModel(model);
    onDone();
  };

  return (
    <div className="import" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="sheet">
        <h2 id="import-title">Bring in a model</h2>
        <div className="look">
          <canvas
            ref={canvas}
            width={SCENE_W}
            height={SCENE_H}
            role="img"
            aria-label="The model as it will look in the room"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              press.current = { x: event.clientX, yaw, moved: false };
            }}
            onPointerMove={(event) => {
              const held = press.current;
              if (!held) return;
              if (Math.abs(event.clientX - held.x) > 4) held.moved = true;
              if (held.moved) setYaw(held.yaw + (event.clientX - held.x) * 0.012);
            }}
            onPointerUp={(event) => {
              const held = press.current;
              press.current = null;
              if (held && !held.moved) click(event);
            }}
          />
          <p className="hint">Drag to turn it about · the orange line is its front · click on it to sit someone down</p>
        </div>
        <div className="fields">
          {!source && !refused && <p className="empty">Reading {file.name}…</p>}
          <p className="note" role="alert">
            {trouble}
          </p>
          {source && (
            <>
              <label className="field">
                <span>Name</span>
                <input type="text" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
              </label>
              <div className="size">
                <span>Size</span>
                <button type="button" aria-label="Smaller" disabled={by <= sizes[0] + 1e-9} onClick={() => step(-1)}>
                  −
                </button>
                <output>×{Number(by.toFixed(2))}</output>
                <button type="button" aria-label="Bigger" disabled={by >= sizes[sizes.length - 1] - 1e-9} onClick={() => step(1)}>
                  +
                </button>
              </div>
              {model && (
                <p className="meta">
                  {model.box[0]} by {model.box[1]} of floor, {model.high} high, in {model.boxes.length} boxes.
                  {most < 1 && " It was made smaller to fit."}
                </p>
              )}
              <div className="tools">
                <button type="button" onClick={() => setTurn((turn + 1) & 3)}>
                  Turn its front
                </button>
              </div>
              <label className="tick">
                <input type="checkbox" checked={flat} onChange={(event) => setFlat(event.target.checked)} />
                <span>Lies flat like a rug, and is walked over</span>
              </label>
              <label className="tick">
                <input type="checkbox" checked={top !== null} disabled={flat} onChange={(event) => setTop(event.target.checked ? Math.min(model?.high ?? TABLE_TOP, LIMITS.high) : null)} />
                <span>Has a top to work at</span>
              </label>
              {top !== null && !flat && (
                <label className="field">
                  <span>Top height</span>
                  <input type="number" min={0} max={LIMITS.high} step={CUBE} value={top} onChange={(event) => setTop(Math.max(0, Math.min(LIMITS.high, Number(event.target.value) || 0)))} />
                </label>
              )}
              <h3>Seats</h3>
              {seats.length === 0 && <p className="empty">Nobody sits on it. Click on the model to sit someone down.</p>}
              <ul className="seats">
                {seats.map((seat, index) => (
                  <li key={index}>
                    <button type="button" aria-pressed={index === picked} onClick={() => setPicked(index === picked ? null : index)}>
                      Seat {index + 1}
                    </button>
                    <button type="button" aria-label={`Turn seat ${index + 1}`} onClick={() => change(index, (one) => ({ ...one, dir: TURN[one.dir] }))}>
                      Turn
                    </button>
                    <button type="button" aria-label={`Lower seat ${index + 1}`} onClick={() => change(index, (one) => ({ ...one, z: Math.max(0, one.z - CUBE / by) }))}>
                      −
                    </button>
                    <output>{Number((seat.z * by).toFixed(1))}</output>
                    <button type="button" aria-label={`Raise seat ${index + 1}`} onClick={() => change(index, (one) => ({ ...one, z: one.z + CUBE / by }))}>
                      +
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove seat ${index + 1}`}
                      onClick={() => {
                        setSeats(seats.filter((_, i) => i !== index));
                        setPicked(null);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="tools ends">
            <button type="button" onClick={onDone}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={!model} onClick={add}>
              Add to the room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

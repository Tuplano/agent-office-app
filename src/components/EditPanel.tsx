import { Fragment, useEffect, useRef, useState } from "react";
import { CUT, drawThumb, type Editor, type EditState, GROW, lookOf, PLAIN, randomFinish, randomTint, READY_ROOMS, SIDE, THUMB } from "../engine";
import { carried } from "../lib/carried";

interface Props {
  editor: Editor;
  edit: EditState;
}

interface StartProps {
  edit: EditState;
  // the rooms there are to start from are asked for, to choose from
  onChoose(): void;
}

interface PanelProps extends Props, StartProps {
  // a model file has been chosen, to be made a piece of
  onImport(file: File): void;
}

interface ColourProps {
  label: string;
  picked: string; // the colour it is now
  onPick(hex: string): void;
}

// A colour to choose, any at all, from the picker.
function Colour({ label, picked, onPick }: ColourProps) {
  const picker = useRef<HTMLInputElement>(null);
  // The picker says `input` all the while a colour is being dragged about in it and
  // `change` once it is let go; React's onChange is the first, and only the second
  // is a colour chosen.
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    const chosen = () => onPick(input.value);
    input.addEventListener("change", chosen);
    return () => input.removeEventListener("change", chosen);
  }, [onPick, picked]); // the picker is made afresh whenever the colour changes

  return <input key={picked} ref={picker} type="color" className="mix" defaultValue={picked} aria-label={label} />;
}

// A room to start from: one of the ready-made ones, or a bare one, which are chosen
// from over the middle of the page.
function StartFrom({ edit, onChoose }: StartProps) {
  return (
    <section aria-labelledby="start-from">
      <h2 id="start-from">Start from</h2>
      <div className="tools">
        <button type="button" onClick={onChoose}>
          Ready-made rooms…
        </button>
      </div>
      <p className="empty">{READY_ROOMS.find((ready) => ready.id === edit.ready)?.name ?? "A room of your own"} is the room now.</p>
    </section>
  );
}

interface TileProps {
  editor: Editor;
  kind: string;
  name: string;
}

interface DrawnProps extends TileProps {
  drawing: boolean; // it is the kind being drawn now
}

// A kind of wall in the list: it is not added but drawn. A click takes it up, and
// then a click in the room is where a wall of it starts and the next where it ends.
function DrawnTile({ editor, kind, name, drawing }: DrawnProps) {
  const picture = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (picture.current) drawThumb(picture.current, kind);
  }, [kind]);

  return (
    <div
      className="tile"
      role="button"
      tabIndex={0}
      aria-pressed={drawing}
      title="Click it, then click in the room where the wall starts and where it ends"
      onClick={() => editor.build(kind)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        editor.build(kind);
      }}
    >
      <canvas ref={picture} width={THUMB.w} height={THUMB.h} aria-hidden="true" />
      <span>{name}</span>
    </div>
  );
}

// A kind of piece in the list to add from: a small picture of it over its name.
// A click adds one to the middle of the room; dragged, it is carried into the room
// and put down where it is let go. It is not a <button>, which some browsers will
// not let be dragged, but it does what one does.
function Tile({ editor, kind, name }: TileProps) {
  const picture = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (picture.current) drawThumb(picture.current, kind);
  }, [kind]);

  return (
    <div
      className="tile"
      role="button"
      tabIndex={0}
      draggable
      title="Click to add it, or drag it into the room"
      onClick={() => editor.add(kind)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        editor.add(kind);
      }}
      onDragStart={(event) => {
        carried.kind = kind;
        event.dataTransfer.setData("text/plain", name);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={() => {
        carried.kind = null;
        editor.letGo();
      }}
    >
      <canvas ref={picture} width={THUMB.w} height={THUMB.h} aria-hidden="true" />
      <span>{name}</span>
    </div>
  );
}

interface OwnProps {
  editor: Editor;
  piece: EditState["palette"][number];
}

// A piece that was brought in from a 3D tool, in the list to add from: it is added
// like any other, and it can be given another name or be forgotten. Forgetting one
// that is in the room takes those out too, so that is asked about first.
function OwnPiece({ editor, piece }: OwnProps) {
  const { kind, name, used } = piece;
  const [draft, setDraft] = useState<string | null>(null); // the name while it is being changed
  const [asking, setAsking] = useState(false);
  const rename = () => {
    if (draft !== null && draft.trim() && draft.trim() !== name) editor.renameModel(kind, draft);
    setDraft(null);
  };

  return (
    <li>
      <Tile editor={editor} kind={kind} name={name} />
      {draft !== null && (
        <input
          type="text"
          aria-label={`A new name for ${name}`}
          value={draft}
          maxLength={40}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === "Enter") rename();
            if (event.key === "Escape") setDraft(null);
          }}
        />
      )}
      <div className="tools">
        <button type="button" aria-label={`Rename ${name}`} onClick={() => setDraft(name)}>
          Rename
        </button>
        <button type="button" aria-label={`Delete ${name}`} onClick={() => (used ? setAsking(true) : editor.deleteModel(kind))}>
          Delete
        </button>
      </div>
      {asking && (
        <p className="ask" role="alertdialog" aria-label={`Delete ${name}?`}>
          {used === 1 ? "There is one in the room, and it goes too." : `There are ${used} in the room, and they go too.`}
          <button type="button" onClick={() => editor.deleteModel(kind)}>
            Delete anyway
          </button>
          <button type="button" onClick={() => setAsking(false)}>
            Keep
          </button>
        </p>
      )}
    </li>
  );
}

// Beside the room while it is being rearranged, in place of the session list:
// what can be done to the piece picked out, the rooms there are to start from,
// how big the room is and what colours it is finished in, the walls and doors there
// are to divide it with, the pieces there are to add to the floor and to the walls,
// and the ones already in the room.
export function EditPanel({ editor, edit, onImport, onChoose }: PanelProps) {
  const own = edit.palette.filter((piece) => piece.own);
  const picked = edit.pieces.find((piece) => piece.index === edit.selected);
  const { w, d } = edit.size;
  const look = lookOf(edit.finish);
  // the room's own colours; a floor is two tones, and the second is worked out from the one chosen
  const finishes = [
    { name: "Walls", picked: look.walls, pick: (hex: string) => editor.refinish({ walls: hex }) },
    { name: "Floor", picked: look.floor, pick: (hex: string) => editor.refinish({ floor: hex, stripe: null }) },
    { name: "Trim", picked: look.trim, pick: (hex: string) => editor.refinish({ trim: hex }) },
    { name: "Wood", picked: look.wood.mid, pick: (hex: string) => editor.refinish({ wood: hex }) },
  ];
  // what there is to add, a list at a time: the walls that stand in the room, the furniture, what hangs on a wall
  const lists = [
    { title: "Build walls", from: edit.palette.filter((piece) => piece.build), floor: false },
    { title: "Add to the floor", from: edit.palette.filter((piece) => !piece.wall && !piece.build && !piece.own), floor: true },
    { title: "Add to a wall", from: edit.palette.filter((piece) => piece.wall), floor: false },
  ];
  // the room's two measures, and what makes each a step less or a step more
  const sides = [
    { name: "Width", side: w, less: "Narrower", more: "Wider", by: (step: number) => editor.resize(step, 0) },
    { name: "Depth", side: d, less: "Shallower", more: "Deeper", by: (step: number) => editor.resize(0, step) },
  ];

  return (
    <div className="side edit">
      <section aria-label="The piece picked out">
        <h2>{picked ? picked.name : "Nothing picked"}</h2>
        {picked ? (
          <div className="tools">
            {/* a wall that was drawn is drawn again, not turned or copied */}
            {picked.long === undefined && (
              <>
                <button type="button" onClick={editor.turn}>
                  {picked.wall ? "Next wall" : "Turn"}
                </button>
                <button type="button" onClick={editor.duplicate}>
                  Duplicate
                </button>
              </>
            )}
            <button type="button" onClick={editor.remove}>
              Delete
            </button>
          </div>
        ) : (
          <p className="empty">Click a piece in the room, or choose one from the list below.</p>
        )}
        {picked && picked.tint !== null && (
          <div className="finish">
            <span>Colour</span>
            <Colour label="Its colour" picked={picked.tint} onPick={editor.paint} />
            <span />
            <div className="tools">
              <button type="button" onClick={() => editor.paint(randomTint())}>
                Random
              </button>
              <button type="button" onClick={() => editor.paint(null)}>
                As it comes
              </button>
            </div>
          </div>
        )}
        <p className="note" role="status">
          {edit.note}
        </p>
      </section>
      <StartFrom edit={edit} onChoose={onChoose} />
      <section aria-labelledby="room-size">
        <h2 id="room-size">Room size</h2>
        {sides.map(({ name, side, less, more, by }) => (
          <div key={name} className="size">
            <span>{name}</span>
            <button type="button" aria-label={less} disabled={side - GROW < SIDE[0]} onClick={() => by(-1)}>
              −
            </button>
            <output>{side}</output>
            <button type="button" aria-label={more} disabled={side + GROW > SIDE[1]} onClick={() => by(1)}>
              +
            </button>
          </div>
        ))}
      </section>
      <section aria-labelledby="room-colours">
        <h2 id="room-colours">Room colours</h2>
        <div className="finish">
          {finishes.map(({ name, picked: now, pick }) => (
            <Fragment key={name}>
              <span>{name}</span>
              <Colour label={name} picked={now} onPick={pick} />
            </Fragment>
          ))}
        </div>
        <div className="tools themes">
          <button type="button" onClick={() => editor.refinish(randomFinish())}>
            Random colours
          </button>
          <button type="button" disabled={Object.keys(edit.finish).length === 0} onClick={() => editor.refinish(PLAIN)}>
            As it comes
          </button>
        </div>
      </section>
      {lists.map(({ title, from, floor }) => (
        <section key={title} aria-label={title}>
          <h2>{title}</h2>
          <div className="palette">
            {from.map(({ kind, name, drawn }) =>
              drawn ? (
                <DrawnTile key={kind} editor={editor} kind={kind} name={name} drawing={edit.drawing === kind} />
              ) : (
                <Tile key={kind} editor={editor} kind={kind} name={name} />
              ),
            )}
          </div>
          {title === "Build walls" && (
            <>
              <div className="tools themes">
                <button type="button" aria-pressed={edit.drawing === CUT} onClick={() => editor.build(CUT)}>
                  Cut a wall
                </button>
              </div>
              <p className="empty">
                Click a wall, then click in the room where it starts and where it ends. Keep clicking to carry on round a corner; Esc stops. To take part of a wall away, click Cut a wall, then click on
                the wall where the cut starts and where it ends. Drop an office door onto a wall for the way through.
              </p>
            </>
          )}
          {floor && (
            <>
              {own.length > 0 && (
                <ul className="own" aria-label="Pieces you brought in">
                  {own.map((piece) => (
                    <OwnPiece key={piece.kind} editor={editor} piece={piece} />
                  ))}
                </ul>
              )}
              <label className="bring">
                <input
                  type="file"
                  accept=".glb,.vox"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImport(file);
                    event.target.value = ""; // so that the same file can be chosen again
                  }}
                />
                <span>Bring in a model…</span>
              </label>
              <p className="empty">A .glb from Blender or a .vox from MagicaVoxel. Or drop the file on the room.</p>
            </>
          )}
        </section>
      ))}
      <section aria-labelledby="in-the-room">
        <h2 id="in-the-room">In the room</h2>
        <ul className="pieces">
          {edit.pieces.map(({ index, name }) => (
            <li key={index}>
              <button type="button" aria-pressed={index === edit.selected} onClick={() => editor.select(index === edit.selected ? null : index)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

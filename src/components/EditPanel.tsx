import { Fragment, useEffect, useRef } from "react";
import { type Editor, type EditState, GROW, lookOf, PALETTE, PLAIN, randomFinish, randomTint, SIDE } from "../engine";

interface Props {
  editor: Editor;
  edit: EditState;
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

// Beside the room while it is being rearranged, in place of the session list:
// what can be done to the piece picked out, how big the room is and what colours
// it is finished in, the pieces there are to add to the floor and to the walls,
// and the ones already in the room.
export function EditPanel({ editor, edit }: Props) {
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
            <button type="button" onClick={editor.turn}>
              {picked.wall ? "Next wall" : "Turn"}
            </button>
            <button type="button" onClick={editor.duplicate}>
              Duplicate
            </button>
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
      {[false, true].map((wall) => (
        <section key={String(wall)} aria-label={wall ? "Add to a wall" : "Add to the floor"}>
          <h2>{wall ? "Add to a wall" : "Add to the floor"}</h2>
          <div className="palette">
            {PALETTE.filter((piece) => piece.wall === wall).map(({ kind, name }) => (
              <button key={kind} type="button" onClick={() => editor.add(kind)}>
                {name}
              </button>
            ))}
          </div>
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

import { type Editor, type EditState, PALETTE } from "../engine";

interface Props {
  editor: Editor;
  edit: EditState;
}

// Beside the room while it is being rearranged, in place of the session list:
// what can be done to the piece picked out, the pieces there are to add to the
// floor and to the walls, and the ones already in the room.
export function EditPanel({ editor, edit }: Props) {
  const picked = edit.pieces.find((piece) => piece.index === edit.selected);

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
        <p className="note" role="status">
          {edit.note}
        </p>
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

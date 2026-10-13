import { useEffect, useRef, useState } from "react";
import { useOfficeState } from "../data/useOfficeState";
import { BLANK_ID, drawRoom, type Editor, type EditState, READY_ROOMS, SCENE_H, SCENE_W } from "../engine";

interface Props {
  editor: Editor;
  edit: EditState;
  onDone(): void;
}

// What a room is started from, shown over the middle of the page a room at a
// time: the ready-made rooms, each as it would look, and after the last of them
// the choice to begin with a big bare room and build it all oneself.
export function RoomChooser({ editor, edit, onDone }: Props) {
  const own = READY_ROOMS.length; // the slide after the last ready-made room
  const [at, setAt] = useState(() => Math.max(0, READY_ROOMS.findIndex((ready) => ready.id === edit.ready)));
  const picture = useRef<HTMLCanvasElement>(null);
  const ready = READY_ROOMS[at]; // none on the last slide
  const go = (to: number) => setAt(Math.max(0, Math.min(own, to)));
  // Each room is shown with the sessions there are sitting in it, as they would.
  // It is drawn when it is turned to, and not again each time a session stirs.
  const { state } = useOfficeState();
  const sessions = useRef(state.sessions);
  sessions.current = state.sessions;

  useEffect(() => {
    if (picture.current && ready) drawRoom(picture.current, ready.room, sessions.current);
  }, [ready]);

  // The arrows go from room to room and Escape closes, here and not in the room
  // behind, which has uses of its own for them.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setAt((now) => Math.max(0, now - 1));
      else if (event.key === "ArrowRight") setAt((now) => Math.min(own, now + 1));
      else if (event.key === "Escape") onDone();
      else if (event.key !== "Delete" && event.key !== "Backspace" && event.key.toLowerCase() !== "r") return;
      event.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [own, onDone]);

  const start = () => {
    editor.startFrom(ready ? ready.id : BLANK_ID);
    onDone();
  };

  return (
    <div className="import" role="dialog" aria-modal="true" aria-labelledby="chooser-title">
      <div className="sheet chooser">
        <h2 id="chooser-title">Start from</h2>
        <button type="button" className="shut" aria-label="Close" onClick={onDone}>
          ×
        </button>
        <div className="slides">
          <button type="button" className="step" aria-label="The room before" disabled={at === 0} onClick={() => go(at - 1)}>
            ‹
          </button>
          {ready ? (
            <figure>
              <canvas ref={picture} width={SCENE_W} height={SCENE_H} role="img" aria-label={`${ready.name}, as it would look with everyone in it`} />
              <figcaption>
                <strong>{ready.name}</strong>
                <span>{ready.about}</span>
              </figcaption>
            </figure>
          ) : (
            <button type="button" className="yours" onClick={start}>
              <span className="plus" aria-hidden="true">
                +
              </span>
              <strong>Customize your own room</strong>
              <span>A big empty room with nothing in it but the door. Build the walls and furnish it yourself.</span>
            </button>
          )}
          <button type="button" className="step" aria-label="The next room" disabled={at === own} onClick={() => go(at + 1)}>
            ›
          </button>
        </div>
        <div className="dots" role="group" aria-label="Rooms">
          {[...READY_ROOMS.map((one) => one.name), "Your own room"].map((name, index) => (
            <button key={name} type="button" aria-label={name} aria-pressed={index === at} onClick={() => go(index)} />
          ))}
        </div>
        <div className="tools ends">
          {ready && (
            <button type="button" className="primary" disabled={ready.id === edit.ready} onClick={start}>
              {ready.id === edit.ready ? "This is the room now" : "Start from this room"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

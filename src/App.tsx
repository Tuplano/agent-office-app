import { useCallback, useEffect, useState } from "react";
import { DemoNotice } from "./components/DemoNotice";
import { EditPanel } from "./components/EditPanel";
import { Header } from "./components/Header";
import { ImportForm } from "./components/ImportForm";
import { OfficeCanvas } from "./components/OfficeCanvas";
import { RoomChooser } from "./components/RoomChooser";
import { SessionList } from "./components/SessionList";
import { useOfficeFeed } from "./data/useOfficeState";
import type { Office } from "./engine";
import { startMusic } from "./lib/music";
import type { Pointed } from "./lib/pointed";
import { useEdit } from "./lib/useEdit";
import "./App.css";

function App() {
  useOfficeFeed();
  useEffect(startMusic, []);
  const [pointed, setPointed] = useState<Pointed | null>(null);
  const [office, setOffice] = useState<Office | null>(null);
  const editor = office?.edit ?? null;
  const edit = useEdit(editor);
  // The rooms there are to start from, shown over the middle of the page: when
  // the room is first opened to be edited, and whenever they are asked for again.
  const [choosing, setChoosing] = useState(false);
  const chosen = useCallback(() => setChoosing(false), []);
  const startEditing = () => {
    editor?.start();
    setChoosing(true);
  };
  // a model file that was dropped or chosen, while it is being made a piece of
  const [model, setModel] = useState<File | null>(null);
  // In edit mode a file dropped anywhere on the window is a model to bring in. At
  // any other time it is nothing: but it is still taken, or the window would go
  // off and open the file in place of the app.
  const editing = edit.on;
  useEffect(() => {
    const files = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const over = (event: DragEvent) => {
      if (files(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file && editing) setModel(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [editing]);

  return (
    <>
      <DemoNotice />
      <main>
        <div className="room">
          <Header editor={editor} edit={edit} onEdit={startEditing} />
          <div className="fit">
            <OfficeCanvas pointed={pointed} onPoint={setPointed} onReady={setOffice} editing={edit.on} />
          </div>
          <p className="hint">
            {edit.on
              ? "Click a piece to pick it · drag it across the floor or along the walls · R turns it · pull a rug or carpet by its corners to resize it · Delete removes it · Esc lets go · drag a new piece in from the list · to build a wall, choose one and click where it starts and ends · drop a .glb or .vox file to bring it in"
              : "Drag to turn · scroll to zoom · shift-drag to move · double-click to reset"}
          </p>
        </div>
        {edit.on && editor ? <EditPanel editor={editor} edit={edit} onImport={setModel} onChoose={() => setChoosing(true)} /> : <SessionList pointed={pointed} onPoint={setPointed} />}
      </main>
      {choosing && edit.on && editor && !model && <RoomChooser editor={editor} edit={edit} onDone={chosen} />}
      {model && edit.on && editor && <ImportForm key={`${model.name} ${model.lastModified}`} file={model} editor={editor} onDone={() => setModel(null)} />}
    </>
  );
}

export default App;

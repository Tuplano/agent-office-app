import { useState } from "react";
import { DemoNotice } from "./components/DemoNotice";
import { EditPanel } from "./components/EditPanel";
import { Header } from "./components/Header";
import { OfficeCanvas } from "./components/OfficeCanvas";
import { SessionList } from "./components/SessionList";
import { useOfficeFeed } from "./data/useOfficeState";
import type { Office } from "./engine";
import type { Pointed } from "./lib/pointed";
import { useEdit } from "./lib/useEdit";
import "./App.css";

function App() {
  useOfficeFeed();
  const [pointed, setPointed] = useState<Pointed | null>(null);
  const [office, setOffice] = useState<Office | null>(null);
  const editor = office?.edit ?? null;
  const edit = useEdit(editor);

  return (
    <>
      <Header editor={editor} edit={edit} />
      <DemoNotice />
      <main>
        <div className="room">
          <div className="fit">
            <OfficeCanvas pointed={pointed} onPoint={setPointed} onReady={setOffice} editing={edit.on} />
          </div>
          <p className="hint">
            {edit.on
              ? "Click a piece to pick it · drag it across the floor or along the walls · R turns it · Delete removes it · Esc lets go"
              : "Drag to turn · scroll to zoom · shift-drag to move · double-click to reset"}
          </p>
        </div>
        {edit.on && editor ? <EditPanel editor={editor} edit={edit} /> : <SessionList pointed={pointed} onPoint={setPointed} />}
      </main>
    </>
  );
}

export default App;

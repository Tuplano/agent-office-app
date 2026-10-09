import { useState } from "react";
import { Header } from "./components/Header";
import { OfficeCanvas } from "./components/OfficeCanvas";
import { SessionList } from "./components/SessionList";
import { useOfficeFeed } from "./data/useOfficeState";
import type { Pointed } from "./lib/pointed";
import "./App.css";

function App() {
  useOfficeFeed();
  const [pointed, setPointed] = useState<Pointed | null>(null);

  return (
    <>
      <Header />
      <main>
        <div className="room">
          <div className="fit">
            <OfficeCanvas pointed={pointed} onPoint={setPointed} />
          </div>
          <p className="hint">
            Drag to turn · scroll to zoom · shift-drag to move · double-click to
            reset
          </p>
        </div>
        <SessionList pointed={pointed} onPoint={setPointed} />
      </main>
    </>
  );
}

export default App;

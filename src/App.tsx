import { OfficeCanvas } from "./components/OfficeCanvas";
import { useOfficeFeed } from "./data/useOfficeState";
import "./App.css";

function App() {
  useOfficeFeed();

  return (
    <main>
      <div className="room">
        <div className="fit">
          <OfficeCanvas />
        </div>
        <p className="hint">
          Drag to turn · scroll to zoom · shift-drag to move · double-click to
          reset
        </p>
      </div>
    </main>
  );
}

export default App;

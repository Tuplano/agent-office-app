import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { attachTerminal, detachTerminal, resizeTerminal, writeTerminal } from "../data/terminals";

// The terminal draws its own colours: these are the page's, from its theme.
function themeOf(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: token("--surface"),
    foreground: token("--text"),
    cursor: token("--primary"),
    cursorAccent: token("--surface"),
    selectionBackground: token("--line"),
  };
}

const quiet = () => {}; // a terminal that has just ended refuses what comes late, and that is all

interface Props {
  id: number; // the Rust side's number for it
}

// One of the app's own terminals, typed to here. Closing it lets go of nothing but
// the view: the program runs on, and what it printed is shown again next time.
export function TerminalPane({ id }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState<{ code: number | null } | null>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeOf(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current!);
    setEnded(null);

    let live = true;
    let watch: number | null = null;
    attachTerminal(id, (message) => {
      if (message instanceof ArrayBuffer) term.write(new Uint8Array(message));
      else if (live) setEnded({ code: message.exit });
    })
      .then((given) => {
        if (live) watch = given;
        else detachTerminal(id, given).catch(quiet); // let go of before it was held
      })
      .catch(() => live && setEnded({ code: null })); // ended while nobody looked

    const typed = term.onData((data) => writeTerminal(id, data).catch(quiet));
    const resized = term.onResize(({ cols, rows }) => resizeTerminal(id, cols, rows).catch(quiet));
    const refit = () => {
      if (box.current?.clientWidth) fit.fit(); // not while hidden
    };
    refit();
    // the size is told once even when it is the one the terminal started with
    resizeTerminal(id, term.cols, term.rows).catch(quiet);
    const sized = new ResizeObserver(refit);
    sized.observe(box.current!);
    const themed = new MutationObserver(() => (term.options.theme = themeOf()));
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    term.focus();

    return () => {
      live = false;
      sized.disconnect();
      themed.disconnect();
      typed.dispose();
      resized.dispose();
      if (watch !== null) detachTerminal(id, watch).catch(quiet);
      term.dispose();
    };
  }, [id]);

  return (
    <>
      <div className="term" ref={box} />
      {ended && <p className="ended">{ended.code === null ? "It has ended." : `It has ended, with code ${ended.code}.`}</p>}
    </>
  );
}

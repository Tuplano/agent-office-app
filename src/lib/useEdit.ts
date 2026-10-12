import { useSyncExternalStore } from 'react';
import type { Editor, EditState } from '../engine';

// what there is to say before the office is there to be edited
const OFF: EditState = { on: false, selected: null, canUndo: false, canRedo: false, canReset: false, size: { w: 0, d: 0 }, pieces: [], note: '' };
const never = () => () => {};
const off = () => OFF;

// The state of the room's edit mode, kept up with the engine, which owns it:
// picking and dragging happen on the canvas, outside React.
export function useEdit(editor: Editor | null): EditState {
  return useSyncExternalStore(editor ? editor.subscribe : never, editor ? editor.state : off, off);
}

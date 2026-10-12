// The parts of a page the engine runs in front of, made of stand-ins: a canvas that
// draws nothing, tags that go nowhere, the motion preference and storage.
// `painted` collects what is filled in over the picture: the marks above people's heads
export const fakeCanvas = (painted: string[] = []) => ({
  width: 0,
  height: 0,
  getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      painted.push(`${this.fillStyle} ${x} ${y} ${w} ${h}`);
    },
  }),
  addEventListener() {},
});
export const fakeElement = (painted?: string[]) => ({
  ...fakeCanvas(painted),
  classList: { add() {}, remove() {} },
  style: { setProperty() {} },
  dataset: {},
  append() {},
  remove() {},
  replaceChildren() {},
  textContent: '',
});
export const storage = { getItem: () => null, setItem() {} };
export const motionPreference = (reduced: boolean) => (query: string) => ({
  matches: reduced && query.includes('reduced-motion'),
  addEventListener() {},
});

// The session the pointer is on, and which of its two labels: the name tag over
// its worker in the office, or its card in the list. The other one is marked.
export interface Pointed {
  id: string;
  on: 'tag' | 'card';
}

// The kind of piece being dragged out of the list to add from, if one is. A drag
// does not let the page read what is being carried until it is dropped, so the
// list says here what it is, and the room looks here while it is over it.
export const carried: { kind: string | null } = { kind: null };

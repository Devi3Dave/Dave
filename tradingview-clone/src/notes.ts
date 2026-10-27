import { useSyncExternalStore } from "react";
import { addNote, deleteNote, parseNotes, updateNote, type Note } from "../shared/notes";
import { newId } from "./store";

const KEY = "chartai.notes.v1";

function load(): Note[] {
  try {
    return parseNotes(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return [];
  }
}

let notes = load();
const listeners = new Set<() => void>();

function set(next: Note[]) {
  notes = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
  } catch {
    // not remembered
  }
  listeners.forEach((l) => l());
}

export const getNotes = () => notes;

export function useNotes(): Note[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notes,
  );
}

/** Adds a note and returns it (undefined for empty text). */
export function createNote(text: string, symbol: string | null): Note | undefined {
  const id = newId("note");
  set(addNote(notes, text, symbol, Date.now(), id));
  return notes.find((n) => n.id === id);
}

export const editNote = (id: string, patch: Parameters<typeof updateNote>[2]) => set(updateNote(notes, id, patch, Date.now()));
export const removeNote = (id: string) => set(deleteNote(notes, id));

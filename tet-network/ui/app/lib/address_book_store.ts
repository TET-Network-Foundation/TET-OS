export type AddressBookEntryV0 = {
  label: string;
  address: string;
  created_at_ms: number;
};

export type AddressBookV0 = {
  v: 0;
  entries: AddressBookEntryV0[];
};

const KEY = "tet.address_book.v0";

export function loadAddressBook(): AddressBookV0 {
  if (typeof window === "undefined") return { v: 0, entries: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { v: 0, entries: [] };
    const j = JSON.parse(raw) as Partial<AddressBookV0> | null;
    if (!j || j.v !== 0 || !Array.isArray(j.entries)) return { v: 0, entries: [] };
    const entries = j.entries
      .filter((e) => e && typeof e === "object")
      .map((e) => e as Partial<AddressBookEntryV0>)
      .filter((e) => typeof e.label === "string" && typeof e.address === "string" && typeof e.created_at_ms === "number")
      .map((e) => ({ label: e.label!, address: e.address!, created_at_ms: e.created_at_ms! }));
    return { v: 0, entries };
  } catch {
    return { v: 0, entries: [] };
  }
}

export function saveAddressBook(b: AddressBookV0) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(b));
}


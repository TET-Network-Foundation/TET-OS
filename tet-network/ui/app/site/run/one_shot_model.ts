/**
 * /research: a model of a one-shot key (docs/research/ONE_SHOT_TET.md, status idea). Nothing quantum
 * runs here: these are numbers in the tab that imitate a few qubits.
 *
 * The key is QUBITS simulated qubits, each prepared in one of four states (bit 0 or 1, in basis Z or
 * X). Signing a message measures every qubit in a basis picked by the message's SHA-256; measuring
 * collapses each qubit, so after one signature the key's states are gone and the model refuses a
 * second one. The checker in this model is told how the key was prepared, and accepts a signature if
 * every qubit measured in its own basis gave its own bit. How a real scheme would let others check is
 * an open question in the note; this checker is only the model's.
 *
 * "Copy the key" duplicates the numbers, which a simulator can do. The copy then signs too. Real qubits
 * in an unknown state cannot be copied (the no-cloning theorem), which is the whole point of the idea.
 *
 * Randomness is injected so the guard can run the model with a fixed source.
 */
import { sha256 } from "@noble/hashes/sha2";

export const QUBITS = 16;

export type Basis = "Z" | "X";
/** A simulated qubit: its amplitudes in the Z basis (real numbers are enough for these four states). */
export type Qubit = { a0: number; a1: number };
export type Prepared = { basis: Basis; bit: 0 | 1 };
export type Key = { qubits: Qubit[]; used: boolean; label: string };
export type Signature = { msg: string; bases: Basis[]; bits: (0 | 1)[] };

const H = Math.SQRT1_2;
const state = (p: Prepared): Qubit =>
  p.basis === "Z" ? (p.bit === 0 ? { a0: 1, a1: 0 } : { a0: 0, a1: 1 }) : p.bit === 0 ? { a0: H, a1: H } : { a0: H, a1: -H };

export type Rand = () => number;
export const cryptoRand: Rand = () => {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 2 ** 32;
};

/** A new key and the record of how it was prepared (which the model's checker is given). */
export function makeKey(rand: Rand, label = "key"): { key: Key; prepared: Prepared[] } {
  const prepared: Prepared[] = Array.from({ length: QUBITS }, () => ({ basis: rand() < 0.5 ? "Z" : "X", bit: rand() < 0.5 ? 0 : 1 }));
  return { key: { qubits: prepared.map(state), used: false, label }, prepared };
}

/** The basis each qubit is measured in for `msg`: bits of SHA-256(msg). */
export function basesFor(msg: string): Basis[] {
  const h = sha256(new TextEncoder().encode(msg));
  return Array.from({ length: QUBITS }, (_, i) => ((h[i >> 3] >> (i & 7)) & 1 ? "X" : "Z"));
}

/** Measure one qubit in a basis (Born rule), and collapse it to the outcome. */
function measure(q: Qubit, basis: Basis, rand: Rand): 0 | 1 {
  const amp0 = basis === "Z" ? q.a0 : H * (q.a0 + q.a1);
  const bit: 0 | 1 = rand() < amp0 * amp0 ? 0 : 1;
  const after = state({ basis, bit });
  q.a0 = after.a0;
  q.a1 = after.a1;
  return bit;
}

export type Gate = { canSign: (k: Key) => { ok: true } | { ok: false; why: string } };
/** The model's rule: a key that has been measured once is used up. */
export const REAL_GATE: Gate = {
  canSign: (k) => (k.used ? { ok: false, why: "its qubits were measured by the first signature, so the key is gone" } : { ok: true }),
};

export function sign(k: Key, msg: string, rand: Rand, gate: Gate = REAL_GATE): { ok: true; sig: Signature } | { ok: false; why: string } {
  const g = gate.canSign(k);
  if (!g.ok) return g;
  const bases = basesFor(msg);
  const bits = k.qubits.map((q, i) => measure(q, bases[i], rand));
  k.used = true;
  return { ok: true, sig: { msg, bases, bits } };
}

/** The model's checker: every qubit measured in the basis it was prepared in must give its bit. */
export function check(prepared: Prepared[], sig: Signature): { ok: true; matched: number } | { ok: false; why: string } {
  if (sig.bases.join() !== basesFor(sig.msg).join()) return { ok: false, why: "the measured bases are not the ones this message picks" };
  let matched = 0;
  for (let i = 0; i < QUBITS; i++) {
    if (sig.bases[i] !== prepared[i].basis) continue;
    if (sig.bits[i] !== prepared[i].bit) return { ok: false, why: `qubit ${i + 1} gave ${sig.bits[i]}, the key was prepared with ${prepared[i].bit}` };
    matched++;
  }
  return { ok: true, matched };
}

/** What a simulator can do and real qubits cannot: copy the numbers. */
export function copyKey(k: Key, label: string): Key {
  return { qubits: k.qubits.map((q) => ({ ...q })), used: k.used, label };
}

/** What the page shows for a qubit: its prepared state while unmeasured, its outcome after. */
export function show(k: Key, prepared: Prepared[]): string[] {
  return k.qubits.map((q, i) => {
    if (!k.used) return prepared[i].basis === "Z" ? (prepared[i].bit ? "|1⟩" : "|0⟩") : prepared[i].bit ? "|−⟩" : "|+⟩";
    return Math.abs(q.a0 - q.a1) < 1e-9 || Math.abs(q.a0 + q.a1) < 1e-9 ? (q.a0 * q.a1 > 0 ? "|+⟩" : "|−⟩") : q.a0 ? "|0⟩" : "|1⟩";
  });
}

export const ONE_SHOT_SHOWS = [
  "In this model, signing measures the qubits, and a key that has signed once cannot sign again.",
  "Copying the key works here only because a simulation is numbers; the copy signs a second message.",
];
export const ONE_SHOT_DOES_NOT = [
  "That a real one-shot key exists or works: nothing quantum runs here, and TET has no such key.",
  "That this signature is secure: it is a model, with a checker that is told how the key was made.",
  "How others would check a real one-shot signature: that is an open question in the research note.",
];

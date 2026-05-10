import { bytesToHex } from "./encoding";
import * as bip39 from "bip39";

export async function generateMnemonic12(): Promise<{ mnemonic12: string; entropyHex: string }> {
  // Generate a *standard* BIP39 12-word mnemonic (128-bit entropy + checksum)
  // to match Rust's `bip39::Mnemonic::parse_in(Language::English, ...)`.
  for (let tries = 0; tries < 8; tries++) {
    const entropyBytes = new Uint8Array(16); // 128-bit
    crypto.getRandomValues(entropyBytes);
    const entropyHex = bytesToHex(entropyBytes);
    const mnemonic12 = bip39.entropyToMnemonic(entropyHex);
    if (bip39.validateMnemonic(mnemonic12)) {
      return { mnemonic12, entropyHex };
    }
  }
  throw new Error("mnemonic generation failed: bip39 validateMnemonic() returned false");
}


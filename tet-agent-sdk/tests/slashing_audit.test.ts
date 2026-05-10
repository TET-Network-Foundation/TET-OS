import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAttackForTest } from "../examples/attacker.ts";

const STEVEMON = 1_000_000;
const BOND_1000_MICRO = 1000 * STEVEMON;

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.ok) return;
    } catch {
      // ignore
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await sleep(250);
  }
}

describe("ZK-Court slashing audit", () => {
  test("burns exactly 1000 TET bond and increments total_burned by 1000 TET", async () => {
    const port = 5510 + Math.floor(Math.random() * 1000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const dbDir = mkdtempSync(join(tmpdir(), `tet-core-test-${port}-`));

    const adminKey = "test-admin-key";

    // Run tet-core in the repo root workspace.
    const repoRoot = join(process.cwd(), "..");
    const child = spawn(
      "cargo",
      ["run", "-p", "tet-core", "--bin", "TET-Core"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: String(port),
          TET_REST_BIND: `127.0.0.1:${port}`,
          TET_DB_DIR: dbDir,
          TET_DB_ENCRYPT: "false",
          TET_REQUIRE_ATTESTATION: "false",
          TET_ENABLE_P2P: "false",
          RISC0_SKIP_BUILD: "1",
          TET_ADMIN_API_KEY: adminKey,
          TET_MLDSA_SECURITY_LEVEL: "44",
        },
        stdio: "pipe",
      },
    );

    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 50_000) stderr = stderr.slice(stderr.length - 50_000);
    });

    try {
      await waitForHttpOk(new URL("/status", baseUrl).toString(), 60_000);

      const out = await runAttackForTest({
        baseUrl,
        mnemonic: TEST_MNEMONIC,
        adminApiKey: adminKey,
      });

      // Balance: compared to pre-stake, liquid should be down by exactly 1000 TET (stake moved 1000).
      expect(out.balance_before_stake - out.balance_after_slash).toBe(BOND_1000_MICRO);

      // Burned: total_burned should increase by exactly 1000 TET (burned bond).
      expect(out.burned_after - out.burned_before).toBe(BOND_1000_MICRO);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${msg}\n\n--- tet-core stderr (tail) ---\n${stderr}`);
    } finally {
      child.kill("SIGTERM");
      await sleep(500);
      child.kill("SIGKILL");
    }
  }, 180_000);
});


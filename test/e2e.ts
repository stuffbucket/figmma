/**
 * E2E smoke test — connects to the MCP server using the official SDK
 * client, the same way VS Code and Claude connect.
 *
 * Usage:
 *   npx tsx test/e2e.ts            # run all checks
 *   npx tsx test/e2e.ts --tools    # just list tools
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const toolsOnly = process.argv.includes("--tools");

// ── Helpers ──────────────────────────────────────────────────────────────

function pass(label: string): void {
  console.log(`  \x1b[32m✔\x1b[0m ${label}`);
}

function fail(label: string, reason?: string): void {
  console.log(`  \x1b[31m✘\x1b[0m ${label}${reason ? ` — ${reason}` : ""}`);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx/esm", "src/index.ts"],
    cwd: projectRoot,
    env: process.env,
  });

  const client = new Client({ name: "figmma-e2e", version: "1.0.0" });

  console.log("\nConnecting to MCP server…");
  await client.connect(transport);
  pass("Connected");

  // ── tools/list ──
  console.log("\nTools:");
  const { tools } = await client.listTools();
  for (const t of tools) {
    console.log(`    ${t.name}`);
  }

  if (tools.length === 0) {
    fail("tools/list", "no tools returned");
  } else {
    pass(`${tools.length} tool(s) registered`);
  }

  if (toolsOnly) {
    await client.close();
    process.exit(0);
  }

  // ── get_current_user ──
  console.log("\nCalling get_current_user…");
  const userResult = await client.callTool({
    name: "get_current_user",
    arguments: {},
  });

  const userText = userResult.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  if (userResult.isError) {
    fail("get_current_user", userText);
  } else {
    pass("get_current_user");
    console.log(`    ${userText.split("\n")[0]}`);
  }

  // ── parse_figma_url ──
  console.log("\nCalling parse_figma_url…");
  const urlResult = await client.callTool({
    name: "parse_figma_url",
    arguments: { url: "https://www.figma.com/design/abc123/My-File?node-id=1-2" },
  });

  const urlText = urlResult.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  if (urlResult.isError) {
    fail("parse_figma_url", urlText);
  } else {
    pass("parse_figma_url");
    console.log(`    ${urlText.split("\n")[0]}`);
  }

  // ── Summary ──
  console.log("\n" + "─".repeat(40));
  console.log("Done.\n");

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n\x1b[31mFATAL:\x1b[0m", err.message || err);
  process.exit(1);
});

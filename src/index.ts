#!/usr/bin/env node

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { observer } from "./observer.js";
import { searchProjectFiles, getFileComments } from "./figma.js";

const server = new McpServer({
  name: "figmma",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: search_projects
// ---------------------------------------------------------------------------
server.tool(
  "search_projects",
  "Search for Figma files across all projects in a team. Returns matching file names, keys, and which project they belong to.",
  {
    team_id: z.string().describe("The Figma team ID to search within"),
    query: z
      .string()
      .describe("Search query to match against file names (case-insensitive substring match)"),
  },
  async ({ team_id, query }) => {
    observer.log("tool", "search_projects", `Searching team ${team_id} for "${query}"`);
    try {
      const results = await searchProjectFiles(team_id, query);

      if (results.length === 0) {
        const msg = `No files found matching "${query}" in team ${team_id}.`;
        observer.log("tool", "search_projects", msg);
        return { content: [{ type: "text", text: msg }] };
      }

      const formatted = results
        .map((f) =>
          [
            `• ${f.name}`,
            `  Key: ${f.key}`,
            `  Project: ${f.project_name}`,
            `  Last modified: ${f.last_modified}`,
          ].join("\n"),
        )
        .join("\n\n");

      const summary = `Found ${results.length} file(s) matching "${query}":\n\n${formatted}`;
      observer.log("tool", "search_projects", `Returning ${results.length} results`, results);
      return { content: [{ type: "text", text: summary }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      observer.log("error", "search_projects", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_file_comments
// ---------------------------------------------------------------------------
server.tool(
  "get_file_comments",
  "Retrieve all comments on a Figma file. Shows who commented, when, the message content, and whether the comment is resolved.",
  {
    file_key: z
      .string()
      .describe("The Figma file key (from the file URL or search_projects results)"),
    as_md: z.boolean().optional().describe("If true, return comment bodies in Markdown format"),
  },
  async ({ file_key, as_md }) => {
    observer.log("tool", "get_file_comments", `Fetching comments for file ${file_key}`);
    try {
      const comments = await getFileComments(file_key, { as_md });

      if (comments.length === 0) {
        const msg = `No comments found on file ${file_key}.`;
        observer.log("tool", "get_file_comments", msg);
        return { content: [{ type: "text", text: msg }] };
      }

      // Separate top-level comments from replies
      const topLevel = comments.filter((c) => !c.parent_id);
      const replies = comments.filter((c) => c.parent_id);
      const replyMap = new Map<string, typeof comments>();
      for (const r of replies) {
        if (!r.parent_id) continue;
        const list = replyMap.get(r.parent_id) ?? [];
        list.push(r);
        replyMap.set(r.parent_id, list);
      }

      const formatted = topLevel
        .map((c) => {
          const status = c.resolved_at ? "✅ Resolved" : "💬 Open";
          const lines = [`[${status}] ${c.user.handle} — ${c.created_at}`, c.message];

          const threadReplies = replyMap.get(c.id);
          if (threadReplies?.length) {
            lines.push("");
            for (const r of threadReplies) {
              lines.push(`  ↳ ${r.user.handle} (${r.created_at}): ${r.message}`);
            }
          }

          return lines.join("\n");
        })
        .join("\n\n---\n\n");

      const summary = `${comments.length} comment(s) on file ${file_key} (${topLevel.length} threads):\n\n${formatted}`;
      observer.log("tool", "get_file_comments", `Returning ${comments.length} comments`, {
        threads: topLevel.length,
        replies: replies.length,
      });
      return { content: [{ type: "text", text: summary }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      observer.log("error", "get_file_comments", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await observer.start();
  observer.log("lifecycle", "server", "MCP server starting up");

  const transport = new StdioServerTransport();

  // Intercept lifecycle events for observability
  server.server.oninitialized = () => {
    observer.log("lifecycle", "server", "Client connected and initialized");
  };

  server.server.onclose = () => {
    observer.log("lifecycle", "server", "Client disconnected");
    observer.destroy();
  };

  await server.connect(transport);
  observer.log("lifecycle", "server", "MCP server is ready and listening on stdio");
}

main().catch((err) => {
  observer.log("error", "server", `Fatal error: ${err}`);
  process.exit(1);
});

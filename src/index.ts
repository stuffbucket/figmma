#!/usr/bin/env node

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { observer } from "./observer.js";
import {
  getMe,
  getTeamProjects,
  getProjectFiles,
  getFileMeta,
  searchProjectFiles,
  getFileComments,
  parseFigmaUrl,
} from "./figma.js";

const server = new McpServer({
  name: "figmma",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool: get_current_user
// ---------------------------------------------------------------------------
server.tool(
  "get_current_user",
  "Verify your Figma API connection and see who you're authenticated as. Use this first to confirm the token is working.",
  {},
  async () => {
    observer.log("tool", "get_current_user", "Checking current Figma user");
    try {
      const user = await getMe();
      const msg = [
        `Authenticated as: ${user.handle}`,
        user.email ? `Email: ${user.email}` : null,
        `User ID: ${user.id}`,
      ]
        .filter(Boolean)
        .join("\n");
      observer.log("tool", "get_current_user", `Authenticated as ${user.handle}`);
      return { content: [{ type: "text", text: msg }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      observer.log("error", "get_current_user", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: parse_figma_url
// ---------------------------------------------------------------------------
server.tool(
  "parse_figma_url",
  "Extract the file key, file name, and node ID from a Figma URL. Use this when a user provides a Figma link instead of a raw file key.",
  {
    url: z.string().describe("A Figma URL (e.g. https://www.figma.com/design/ABC123/My-File)"),
  },
  async ({ url }) => {
    observer.log("tool", "parse_figma_url", `Parsing URL: ${url}`);
    const parsed = parseFigmaUrl(url);
    if (!parsed) {
      const msg = "Could not parse that URL. Expected a Figma file/design/proto URL.";
      observer.log("error", "parse_figma_url", msg);
      return { content: [{ type: "text", text: msg }], isError: true };
    }

    const lines = [
      `File key: ${parsed.fileKey}`,
      parsed.fileName ? `File name (from URL): ${parsed.fileName}` : null,
      parsed.nodeId ? `Node ID: ${parsed.nodeId}` : null,
    ].filter(Boolean);

    observer.log("tool", "parse_figma_url", `Extracted file key: ${parsed.fileKey}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: list_team_projects
// ---------------------------------------------------------------------------
server.tool(
  "list_team_projects",
  "List all projects in a Figma team. You can find your team ID in the Figma URL when viewing a team page (e.g. figma.com/files/team/TEAM_ID/...).",
  {
    team_id: z.string().describe("The Figma team ID"),
  },
  async ({ team_id }) => {
    observer.log("tool", "list_team_projects", `Listing projects for team ${team_id}`);
    try {
      const projects = await getTeamProjects(team_id);
      if (projects.length === 0) {
        return { content: [{ type: "text", text: `No projects found in team ${team_id}.` }] };
      }
      const formatted = projects
        .map((p) => `• ${p.name} (ID: ${p.id})`)
        .join("\n");
      const summary = `${projects.length} project(s) in team ${team_id}:\n\n${formatted}`;
      observer.log("tool", "list_team_projects", `Found ${projects.length} projects`);
      return { content: [{ type: "text", text: summary }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      observer.log("error", "list_team_projects", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: list_project_files
// ---------------------------------------------------------------------------
server.tool(
  "list_project_files",
  "List all files in a Figma project. Use list_team_projects first to find project IDs.",
  {
    project_id: z.string().describe("The Figma project ID (from list_team_projects results)"),
  },
  async ({ project_id }) => {
    observer.log("tool", "list_project_files", `Listing files for project ${project_id}`);
    try {
      const files = await getProjectFiles(project_id);
      if (files.length === 0) {
        return { content: [{ type: "text", text: `No files found in project ${project_id}.` }] };
      }
      const formatted = files
        .map((f) => `• ${f.name}\n  Key: ${f.key}\n  Last modified: ${f.last_modified}`)
        .join("\n\n");
      const summary = `${files.length} file(s) in project ${project_id}:\n\n${formatted}`;
      observer.log("tool", "list_project_files", `Found ${files.length} files`);
      return { content: [{ type: "text", text: summary }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      observer.log("error", "list_project_files", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_file_info
// ---------------------------------------------------------------------------
server.tool(
  "get_file_info",
  "Get metadata about a Figma file (name, last modified, version) without downloading the full document. Accepts a file key or a Figma URL.",
  {
    file_key_or_url: z.string().describe("A Figma file key or a full Figma URL"),
  },
  async ({ file_key_or_url }) => {
    let fileKey = file_key_or_url;
    const parsed = parseFigmaUrl(file_key_or_url);
    if (parsed) {
      fileKey = parsed.fileKey;
    }

    observer.log("tool", "get_file_info", `Getting metadata for file ${fileKey}`);
    try {
      const meta = await getFileMeta(fileKey);
      const lines = [
        `Name: ${meta.name}`,
        `Last modified: ${meta.lastModified}`,
        `Version: ${meta.version}`,
        meta.editorType ? `Editor: ${meta.editorType}` : null,
        `File key: ${fileKey}`,
      ].filter(Boolean);
      observer.log("tool", "get_file_info", `File: ${meta.name}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      observer.log("error", "get_file_info", msg);
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: search_projects
// ---------------------------------------------------------------------------
server.tool(
  "search_projects",
  "Search for Figma files by name across all projects in a team. If you don't have the team ID, ask the user — it's in the Figma URL when viewing a team page (figma.com/files/team/TEAM_ID/...). Use list_team_projects and list_project_files for browsing instead.",
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
  "Retrieve all comments on a Figma file. Shows who commented, when, the message content, and whether the comment is resolved. Accepts a file key or a Figma URL.",
  {
    file_key_or_url: z
      .string()
      .describe("The Figma file key or a full Figma URL"),
    as_md: z.boolean().optional().describe("If true, return comment bodies in Markdown format"),
  },
  async ({ file_key_or_url, as_md }) => {
    let file_key = file_key_or_url;
    const parsed = parseFigmaUrl(file_key_or_url);
    if (parsed) {
      file_key = parsed.fileKey;
    }

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

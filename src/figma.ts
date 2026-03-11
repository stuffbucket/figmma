import { logger } from "./logger.js";
import { getToken as getConfigToken } from "./config.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";

function getToken(): string {
  const token = getConfigToken();
  if (!token) {
    throw new Error(
      "Missing Figma API token. Set FIGMA_API_TOKEN in your MCP client env, or refresh the dashboard page to run setup.",
    );
  }
  return token;
}

async function figmaFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${FIGMA_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  logger.log("request", "figma-api", `→ GET ${url.pathname}${url.search}`);

  const res = await fetch(url.toString(), {
    headers: { "X-Figma-Token": getToken() },
  });

  if (!res.ok) {
    const body = await res.text();
    logger.log("error", "figma-api", `← ${res.status} ${res.statusText} for ${url.pathname}`, body);
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as T;
  logger.log("response", "figma-api", `← ${res.status} OK for ${url.pathname}`, data);
  return data;
}

// ---- Types matching Figma REST API responses ----

export interface FigmaUser {
  id: string;
  handle: string;
  email?: string;
  img_url?: string;
}

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaProjectFile {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified: string;
}

export interface FigmaComment {
  id: string;
  file_key: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
  user: FigmaUser;
  parent_id?: string;
  order_id?: string;
  reactions?: Array<{ emoji: string; user: FigmaUser }>;
}

export interface FigmaFileMeta {
  name: string;
  version: string;
  lastModified: string;
  editorType?: string;
}

// ---- API methods ----

// Cached user profile — fetched once on first access
let cachedUser: FigmaUser | null = null;

/** GET /v1/me — current authenticated user (cached after first call) */
export async function getMe(): Promise<FigmaUser> {
  if (cachedUser) return cachedUser;
  cachedUser = await figmaFetch<FigmaUser>("/me");
  logger.log("lifecycle", "user-profile", `Authenticated as ${cachedUser.handle}`, cachedUser);
  return cachedUser;
}

/** Returns cached user if already fetched, null otherwise */
export function getCachedUser(): FigmaUser | null {
  return cachedUser;
}

/**
 * Eagerly fetch and cache the user profile.
 * Called at MCP startup — if it fails, we log but don't crash
 * (tools will surface the auth error when actually used).
 */
export async function initializeAuth(): Promise<void> {
  try {
    await getMe();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.log("error", "auth", `Could not authenticate on startup: ${msg}`);
  }
}

/** GET /v1/files/{file_key}/meta — lightweight file metadata */
export async function getFileMeta(fileKey: string): Promise<FigmaFileMeta> {
  const data = await figmaFetch<{ file: FigmaFileMeta }>(`/files/${fileKey}/meta`);
  return data.file;
}

/** GET /v1/teams/{team_id}/projects */
export async function getTeamProjects(teamId: string): Promise<FigmaProject[]> {
  const data = await figmaFetch<{ projects: FigmaProject[] }>(`/teams/${teamId}/projects`);
  return data.projects;
}

/** GET /v1/projects/{project_id}/files */
export async function getProjectFiles(projectId: string): Promise<FigmaProjectFile[]> {
  const data = await figmaFetch<{ files: FigmaProjectFile[] }>(`/projects/${projectId}/files`);
  return data.files;
}

/**
 * Search for files across all projects in a team.
 * Walks team → projects → files and filters by name substring (case-insensitive).
 */
export async function searchProjectFiles(
  teamId: string,
  query: string,
): Promise<Array<FigmaProjectFile & { project_name: string; project_id: string }>> {
  logger.log("info", "search", `Searching team ${teamId} for files matching "${query}"`);

  const projects = await getTeamProjects(teamId);
  logger.log("info", "search", `Scanning ${projects.length} project(s) in team ${teamId}`);

  const projectFiles = await Promise.all(
    projects.map(async (project) => {
      const files = await getProjectFiles(project.id);
      return { project, files };
    }),
  );

  const results: Array<FigmaProjectFile & { project_name: string; project_id: string }> = [];
  const lowerQuery = query.toLowerCase();

  for (const { project, files } of projectFiles) {
    for (const file of files) {
      if (file.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          ...file,
          project_name: project.name,
          project_id: project.id,
        });
      }
    }
  }

  logger.log("info", "search", `Found ${results.length} file(s) matching "${query}"`, results);
  return results;
}

/** GET /v1/files/{file_key}/comments */
export async function getFileComments(
  fileKey: string,
  opts?: { as_md?: boolean },
): Promise<FigmaComment[]> {
  const params: Record<string, string> = {};
  if (opts?.as_md) params.as_md = "true";

  const data = await figmaFetch<{ comments: FigmaComment[] }>(`/files/${fileKey}/comments`, params);
  return data.comments;
}

// ---- URL parsing utility ----

export interface ParsedFigmaUrl {
  fileKey: string;
  fileName?: string;
  nodeId?: string;
}

/**
 * Extracts file key (and optionally node-id) from a Figma URL.
 * Supports formats like:
 *   https://www.figma.com/file/ABC123/My-File
 *   https://www.figma.com/design/ABC123/My-File?node-id=1-23
 *   https://figma.com/file/ABC123
 *   https://www.figma.com/proto/ABC123/...
 *   https://www.figma.com/board/ABC123/...
 */
export function parseFigmaUrl(url: string): ParsedFigmaUrl | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("figma.com")) return null;

    // Path pattern: /(file|design|proto|board)/{fileKey}/{optional-name}
    const match = parsed.pathname.match(/^\/(file|design|proto|board)\/([a-zA-Z0-9]+)/);
    if (!match) return null;

    const result: ParsedFigmaUrl = { fileKey: match[2] };

    // Extract human-readable name from path
    const namePart = parsed.pathname.split("/")[3];
    if (namePart) {
      result.fileName = decodeURIComponent(namePart).replace(/-/g, " ");
    }

    // Extract node-id from query params
    const nodeId = parsed.searchParams.get("node-id");
    if (nodeId) {
      result.nodeId = nodeId;
    }

    return result;
  } catch {
    return null;
  }
}

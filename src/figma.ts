import { observer } from "./observer.js";

const FIGMA_API_BASE = "https://api.figma.com/v1";

function getToken(): string {
  const token = process.env.FIGMA_API_TOKEN ?? process.env.FIGMA_TOKEN;
  if (!token) {
    throw new Error(
      "Missing Figma API token. Set FIGMA_API_TOKEN or FIGMA_TOKEN environment variable.",
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

  observer.log("request", "figma-api", `GET ${url.pathname}${url.search}`);

  const res = await fetch(url.toString(), {
    headers: { "X-Figma-Token": getToken() },
  });

  if (!res.ok) {
    const body = await res.text();
    observer.log("error", "figma-api", `${res.status} ${res.statusText}`, body);
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as T;
  observer.log("response", "figma-api", `${res.status} OK for ${url.pathname}`);
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

// ---- API methods ----

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
  observer.log("info", "search", `Searching team ${teamId} for files matching "${query}"`);

  const projects = await getTeamProjects(teamId);
  observer.log("info", "search", `Found ${projects.length} projects in team ${teamId}`);

  const results: Array<FigmaProjectFile & { project_name: string; project_id: string }> = [];
  const lowerQuery = query.toLowerCase();

  for (const project of projects) {
    const files = await getProjectFiles(project.id);
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

  observer.log("info", "search", `Found ${results.length} files matching "${query}"`);
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

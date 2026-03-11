import { defineConfig } from "astro/config";

const GITHUB_USER = "stuffbucket";
const REPO_NAME = "figmma";

export default defineConfig({
  site: `https://${GITHUB_USER}.github.io`,
  base: `/${REPO_NAME}`,
  markdown: {
    shikiConfig: {
      theme: "github-dark",
    },
  },
});

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import simpleGit from "simple-git";
import {
  CACHE_DIR,
  projects,
  limits,
  type ProjectId,
  PROJECT_IDS,
} from "../config.js";
import type { CommitInfo, PRInfo, IssueInfo } from "../types.js";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function cloneOrPull(projectId: ProjectId) {
  const project = projects[projectId];
  const repoDir = path.join(CACHE_DIR, "repos", projectId);

  if (fs.existsSync(path.join(repoDir, ".git"))) {
    console.log(`[${projectId}] Pulling latest...`);
    const git = simpleGit(repoDir);
    await git.pull();
  } else {
    console.log(`[${projectId}] Cloning ${project.repo}...`);
    ensureDir(path.dirname(repoDir));
    const git = simpleGit();
    await git.clone(`https://github.com/${project.repo}.git`, repoDir);
  }

  return repoDir;
}

async function extractGitLog(
  projectId: ProjectId,
  repoDir: string,
): Promise<CommitInfo[]> {
  console.log(`[${projectId}] Extracting git log...`);
  const git = simpleGit(repoDir);
  const log = await git.log({
    maxCount: limits.maxCommits,
    "--stat": null,
  });

  const commits: CommitInfo[] = log.all.map((entry) => {
    const statMatch = entry.diff;
    return {
      sha: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
      filesChanged: statMatch?.changed ?? 0,
      insertions: statMatch?.insertions ?? 0,
      deletions: statMatch?.deletions ?? 0,
    };
  });

  const outPath = path.join(CACHE_DIR, "git-logs", `${projectId}.json`);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(commits, null, 2));
  console.log(`[${projectId}] Saved ${commits.length} commits to ${outPath}`);
  return commits;
}

function fetchPRs(projectId: ProjectId): PRInfo[] {
  console.log(`[${projectId}] Fetching merged PRs...`);
  const project = projects[projectId];
  const outDir = path.join(CACHE_DIR, "pr-data");
  ensureDir(outDir);

  try {
    const raw = execSync(
      `gh pr list --repo ${project.repo} --state merged --limit ${limits.maxPRs} --json number,title,body,labels,mergedAt,additions,deletions,files`,
      { encoding: "utf-8", timeout: 60000 },
    );
    const prs: PRInfo[] = JSON.parse(raw).map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body || "",
      labels: (pr.labels || []).map((l: any) => l.name),
      mergedAt: pr.mergedAt,
      additions: pr.additions,
      deletions: pr.deletions,
      files: (pr.files || []).map((f: any) => f.path),
    }));

    const outPath = path.join(outDir, `${projectId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(prs, null, 2));
    console.log(`[${projectId}] Saved ${prs.length} PRs`);
    return prs;
  } catch (e) {
    console.warn(`[${projectId}] Failed to fetch PRs: ${e}`);
    return [];
  }
}

function fetchIssues(projectId: ProjectId): IssueInfo[] {
  console.log(`[${projectId}] Fetching issues...`);
  const project = projects[projectId];
  const outDir = path.join(CACHE_DIR, "issues");
  ensureDir(outDir);

  try {
    const raw = execSync(
      `gh issue list --repo ${project.repo} --state all --limit ${limits.maxIssues} --json number,title,body,labels,createdAt,closedAt`,
      { encoding: "utf-8", timeout: 60000 },
    );
    const issues: IssueInfo[] = JSON.parse(raw).map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || "",
      labels: (issue.labels || []).map((l: any) => l.name),
      createdAt: issue.createdAt,
      closedAt: issue.closedAt,
    }));

    const outPath = path.join(outDir, `${projectId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(issues, null, 2));
    console.log(`[${projectId}] Saved ${issues.length} issues`);
    return issues;
  } catch (e) {
    console.warn(`[${projectId}] Failed to fetch issues: ${e}`);
    return [];
  }
}

function snapshotTree(projectId: ProjectId, repoDir: string) {
  console.log(`[${projectId}] Snapshotting directory tree...`);
  try {
    const tree = execSync(
      `find . -type f -not -path './.git/*' -not -path './node_modules/*' -not -path './vendor/*' | head -500 | sort`,
      { cwd: repoDir, encoding: "utf-8", timeout: 30000 },
    );
    const outPath = path.join(CACHE_DIR, "repos", projectId, ".tree.txt");
    fs.writeFileSync(outPath, tree);
    console.log(
      `[${projectId}] Saved tree (${tree.split("\n").length} files)`,
    );
  } catch (e) {
    console.warn(`[${projectId}] Failed to snapshot tree: ${e}`);
  }
}

async function fetchProject(projectId: ProjectId) {
  console.log(`\n=== Fetching ${projects[projectId].name} ===\n`);

  const repoDir = await cloneOrPull(projectId);
  await extractGitLog(projectId, repoDir);
  fetchPRs(projectId);
  fetchIssues(projectId);
  snapshotTree(projectId, repoDir);

  console.log(`\n=== Done: ${projects[projectId].name} ===\n`);
}

// CLI entry
const targetProject = process.argv[2] as ProjectId | undefined;

if (targetProject && projects[targetProject]) {
  await fetchProject(targetProject);
} else if (!targetProject) {
  for (const id of PROJECT_IDS) {
    await fetchProject(id);
  }
} else {
  console.error(
    `Unknown project: ${targetProject}. Available: ${PROJECT_IDS.join(", ")}`,
  );
  process.exit(1);
}

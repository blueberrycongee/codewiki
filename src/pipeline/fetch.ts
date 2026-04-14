import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import simpleGit from "simple-git";
import type { Config, RepoConfig } from "../config/schema.js";
import { repoSlug, repoFullName } from "../config/loader.js";
import type { CommitInfo, PRInfo, IssueInfo, ClosedPR, PRReviewComment } from "../types.js";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function ghCli(args: string): string {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return "[]";
  }
}

async function cloneOrPull(repoUrl: string, repoDir: string): Promise<void> {
  if (fs.existsSync(path.join(repoDir, ".git"))) {
    console.log("  Pulling latest...");
    const git = simpleGit(repoDir);
    await git.pull();
  } else {
    console.log("  Cloning...");
    ensureDir(path.dirname(repoDir));
    await simpleGit().clone(repoUrl, repoDir, ["--depth", "1000"]);
  }
}

async function extractGitLog(
  repoDir: string,
  maxCommits: number,
): Promise<CommitInfo[]> {
  const git = simpleGit(repoDir);
  const log = await git.log({ maxCount: maxCommits, "--stat": null });

  return log.all.map((entry) => {
    const stats = entry.diff;
    return {
      sha: entry.hash,
      message: entry.message.split("\n")[0],
      author: entry.author_name,
      date: entry.date,
      filesChanged: stats?.changed ?? 0,
      insertions: stats?.insertions ?? 0,
      deletions: stats?.deletions ?? 0,
    };
  });
}

function fetchMergedPRs(fullName: string, maxPRs: number): PRInfo[] {
  console.log("  Fetching merged PRs...");
  const json = ghCli(
    `pr list --repo ${fullName} --state merged --limit ${maxPRs} --json number,title,body,labels,mergedAt,additions,deletions,files`,
  );
  const prs = JSON.parse(json);
  return prs.map((pr: any) => ({
    number: pr.number,
    title: pr.title,
    body: (pr.body || "").slice(0, 1000),
    labels: (pr.labels || []).map((l: any) => l.name || l),
    mergedAt: pr.mergedAt,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    files: (pr.files || []).map((f: any) => f.path || f),
  }));
}

function fetchClosedPRs(fullName: string): ClosedPR[] {
  console.log("  Fetching closed (not merged) PRs...");
  const json = ghCli(
    `pr list --repo ${fullName} --state closed --limit 100 --json number,title,body,labels,createdAt,closedAt,mergedAt`,
  );
  const prs = JSON.parse(json);
  return prs
    .filter((pr: any) => !pr.mergedAt)
    .map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      body: (pr.body || "").slice(0, 500),
      labels: (pr.labels || []).map((l: any) => l.name || l),
      createdAt: pr.createdAt,
      closedAt: pr.closedAt,
    }));
}

function fetchPRReviewComments(
  fullName: string,
  prNumbers: number[],
): PRReviewComment[] {
  console.log(`  Fetching review comments for top ${prNumbers.length} PRs...`);
  const comments: PRReviewComment[] = [];

  for (const num of prNumbers.slice(0, 20)) {
    try {
      const json = ghCli(
        `api repos/${fullName}/pulls/${num}/reviews --jq '[.[] | {author: .user.login, body: .body, createdAt: .submitted_at}]'`,
      );
      const reviews = JSON.parse(json || "[]");
      for (const r of reviews) {
        if (r.body && r.body.trim()) {
          comments.push({
            prNumber: num,
            author: r.author || "",
            body: r.body.slice(0, 500),
            createdAt: r.createdAt || "",
          });
        }
      }
    } catch {
      // Skip PRs we can't fetch reviews for
    }
  }

  return comments;
}

function fetchIssues(fullName: string, maxIssues: number): IssueInfo[] {
  console.log("  Fetching issues...");
  const json = ghCli(
    `issue list --repo ${fullName} --state all --limit ${maxIssues} --json number,title,body,labels,createdAt,closedAt`,
  );
  const issues = JSON.parse(json);
  return issues.map((issue: any) => ({
    number: issue.number,
    title: issue.title,
    body: (issue.body || "").slice(0, 1000),
    labels: (issue.labels || []).map((l: any) => l.name || l),
    createdAt: issue.createdAt,
    closedAt: issue.closedAt,
  }));
}

function snapshotTree(repoDir: string): string {
  try {
    return execSync(
      `find . -type f -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/vendor/*' -not -path '*/.cache/*' | head -500 | sort`,
      { cwd: repoDir, encoding: "utf-8", timeout: 10_000 },
    );
  } catch {
    return "";
  }
}

export async function fetchRepo(
  repo: RepoConfig,
  config: Config,
): Promise<void> {
  const slug = repoSlug(repo.url);
  const fullName = repoFullName(repo.url);
  const rawDir = path.join(config.cacheDir, slug, "raw");
  const repoDir = path.join(config.cacheDir, slug, "repo");
  ensureDir(rawDir);

  // Clone or pull
  await cloneOrPull(repo.url, repoDir);

  // Extract git log
  console.log("  Extracting git log...");
  const commits = await extractGitLog(repoDir, config.limits.maxCommits);
  fs.writeFileSync(
    path.join(rawDir, "git-log.json"),
    JSON.stringify(commits, null, 2),
  );
  console.log(`  ${commits.length} commits`);

  // Fetch merged PRs
  const prs = fetchMergedPRs(fullName, config.limits.maxPRs);
  fs.writeFileSync(
    path.join(rawDir, "prs.json"),
    JSON.stringify(prs, null, 2),
  );
  console.log(`  ${prs.length} merged PRs`);

  // Fetch closed PRs (for pitfall layer)
  const closedPRs = fetchClosedPRs(fullName);
  fs.writeFileSync(
    path.join(rawDir, "closed-prs.json"),
    JSON.stringify(closedPRs, null, 2),
  );
  console.log(`  ${closedPRs.length} closed (not merged) PRs`);

  // Fetch PR review comments (for decision/constraint layers)
  const topPRs = prs
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 20)
    .map((p) => p.number);
  const reviews = fetchPRReviewComments(fullName, topPRs);
  fs.writeFileSync(
    path.join(rawDir, "pr-reviews.json"),
    JSON.stringify(reviews, null, 2),
  );
  console.log(`  ${reviews.length} review comments`);

  // Fetch issues
  const issues = fetchIssues(fullName, config.limits.maxIssues);
  fs.writeFileSync(
    path.join(rawDir, "issues.json"),
    JSON.stringify(issues, null, 2),
  );
  console.log(`  ${issues.length} issues`);

  // Directory tree
  const tree = snapshotTree(repoDir);
  fs.writeFileSync(path.join(rawDir, "tree.txt"), tree);
}

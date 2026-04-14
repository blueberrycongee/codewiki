import type { Layer } from "./config/schema.js";

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface PRInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
  mergedAt: string;
  additions: number;
  deletions: number;
  files: string[];
}

export interface PRReviewComment {
  prNumber: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface ClosedPR {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  closedAt: string;
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  closedAt: string | null;
}

export interface ClassifiedItem {
  id: string; // sha for commits, number for PRs/issues
  type: "commit" | "pr" | "issue" | "closed-pr";
  title: string;
  layers: Layer[];
  score: number;
  reasoning: string;
}

export interface ExtractedFact {
  claim: string;
  source: {
    type: "commit" | "pr" | "issue" | "code" | "readme" | "review";
    url: string;
    ref: string;
  };
  confidence: "high" | "medium" | "low";
  relevance: string;
}

// Keep old types for backward compat during migration
export interface ScoredCommit {
  sha: string;
  score: number;
  topicTags: string[];
  message: string;
}

export interface ScoredPR {
  number: number;
  score: number;
  topicTags: string[];
  title: string;
}

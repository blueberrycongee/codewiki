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

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  closedAt: string | null;
}

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

export interface ExtractedFact {
  claim: string;
  source: {
    type: "commit" | "pr" | "issue" | "code" | "readme";
    url: string;
    ref: string;
  };
  confidence: "high" | "medium" | "low";
  relevance: string;
}

export interface CostRecord {
  stage: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  timestamp: string;
}

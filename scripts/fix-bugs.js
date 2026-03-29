#!/usr/bin/env node
/**
 * scripts/fix-bugs.js — Automated Sentry bug fixer
 *
 * Fetches unresolved Sentry issues → asks Claude Code to fix them →
 * triggers an EAS production build → submits to the appropriate store.
 *
 * Usage:
 *   node scripts/fix-bugs.js [options]
 *
 * Options:
 *   --dry-run          Show what would happen without building or submitting
 *   --limit=N          Max issues to process in one run (default: 3)
 *   --platform=<p>     Force platform: ios | android | all (overrides auto-detect)
 *   --issue=<id>       Process a single specific Sentry issue ID
 *
 * Required env vars (add to .env.local):
 *   SENTRY_AUTH_TOKEN  Auth token from https://sentry.io/settings/account/api/auth-tokens/
 *                      Needs scopes: project:read, event:read, issue:write
 *   SENTRY_ORG         Your Sentry organisation slug (from the URL: sentry.io/organizations/<slug>/)
 *   SENTRY_PROJECT     Your Sentry project slug (from sentry.io/organizations/<slug>/projects/<slug>/)
 */

"use strict";

const { execSync, spawnSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Load .env.local ───────────────────────────────────────────────────────────

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const [key, ...rest] = line.split("=");
      if (key && rest.length && !process.env[key.trim()]) {
        process.env[key.trim()] = rest.join("=").trim();
      }
    });
}

// ── Config ────────────────────────────────────────────────────────────────────

const SENTRY_TOKEN   = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG     = process.env.SENTRY_ORG;
const SENTRY_PROJECT = process.env.SENTRY_PROJECT;
// EU Sentry: ingest.de.sentry.io → API is at de.sentry.io
const SENTRY_HOST    = "de.sentry.io";

const DRY_RUN        = process.argv.includes("--dry-run");
const LIMIT          = parseInt(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "3", 10);
const FORCE_PLATFORM = process.argv.find(a => a.startsWith("--platform="))?.split("=")[1];
const SINGLE_ISSUE   = process.argv.find(a => a.startsWith("--issue="))?.split("=")[1];

// Claude Code CLI — try PATH first, fall back to VSCode extension binary
const CLAUDE_CANDIDATES = [
  "claude",
  path.join(process.env.LOCALAPPDATA || "", "Programs", "claude-code", "claude.exe"),
  ...(fs.existsSync(path.join(process.env.USERPROFILE || "", ".vscode", "extensions"))
    ? fs.readdirSync(path.join(process.env.USERPROFILE || "", ".vscode", "extensions"))
        .filter(d => d.startsWith("anthropic.claude-code"))
        .sort()
        .reverse()
        .map(d => path.join(process.env.USERPROFILE, ".vscode", "extensions", d, "resources", "native-binary", "claude.exe"))
    : []),
];

const CLAUDE_BIN = CLAUDE_CANDIDATES.find(bin => {
  try {
    execSync(`"${bin}" --version`, { stdio: "ignore" });
    return true;
  } catch { return false; }
});

// ── Sentry API ────────────────────────────────────────────────────────────────

function sentryRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: SENTRY_HOST,
        path: `/api/0${urlPath}`,
        method,
        headers: {
          Authorization: `Bearer ${SENTRY_TOKEN}`,
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchIssues() {
  if (SINGLE_ISSUE) {
    const { body } = await sentryRequest("GET", `/issues/${SINGLE_ISSUE}/`);
    return [body];
  }
  const { body } = await sentryRequest(
    "GET",
    `/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved&limit=${LIMIT}&sort=date`
  );
  return Array.isArray(body) ? body : [];
}

async function fetchLatestEvent(issueId) {
  const { body } = await sentryRequest("GET", `/issues/${issueId}/events/?limit=1&full=true`);
  return Array.isArray(body) ? body[0] : null;
}

async function markResolved(issueId) {
  return sentryRequest("PUT", `/issues/${issueId}/`, { status: "resolved" });
}

// ── Platform detection ────────────────────────────────────────────────────────

function detectPlatform(event) {
  if (FORCE_PLATFORM) return FORCE_PLATFORM;
  const os = (event?.contexts?.os?.name ?? "").toLowerCase();
  const runtime = (event?.tags?.find(t => t.key === "runtime.name")?.value ?? "").toLowerCase();
  if (os.includes("ios") || os.includes("iphone") || os.includes("ipad")) return "ios";
  if (os.includes("android") || runtime.includes("android")) return "android";
  return "all";
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(issue, event) {
  const exception = event?.entries?.find(e => e.type === "exception");
  const stacktrace = exception?.data?.values
    ?.map(v => {
      const frames = (v.stacktrace?.frames ?? [])
        .filter(f => f.inApp !== false)
        .slice(-8)
        .reverse()
        .map(f => `  at ${f.function ?? "?"} (${f.filename ?? "?"}:${f.lineNo ?? "?"})`)
        .join("\n");
      return `${v.type}: ${v.value}\n${frames}`;
    })
    .join("\n\n") ?? "No stack trace available.";

  const breadcrumbs = event?.entries
    ?.find(e => e.type === "breadcrumbs")
    ?.data?.values
    ?.slice(-8)
    ?.map(b => `[${b.level ?? "info"}] ${b.message ?? b.data?.url ?? JSON.stringify(b.data ?? {})}`)
    ?.join("\n") ?? "";

  const os     = event?.contexts?.os?.name ?? "unknown";
  const device = event?.contexts?.device?.model ?? "";

  return `You are fixing a production crash in the Alba React Native app (Expo SDK 54, RN 0.81.5).

## Sentry Issue
ID: ${issue.id}
Title: ${issue.title}
Culprit: ${issue.culprit ?? "unknown"}
Times seen: ${issue.count} | First: ${issue.firstSeen} | Last: ${issue.lastSeen}
Platform: ${os}${device ? ` / ${device}` : ""}

## Stack trace
\`\`\`
${stacktrace}
\`\`\`
${breadcrumbs ? `\n## Breadcrumbs (last 8 actions before crash)\n\`\`\`\n${breadcrumbs}\n\`\`\`` : ""}

## Instructions
1. Read the file(s) identified in the stack trace to understand the context.
2. Apply the minimal fix that eliminates the root cause.
3. Prefer null checks, optional chaining, or guarding the crash point over large refactors.
4. Do not add comments, docstrings, or change unrelated code.
5. After fixing, briefly confirm what you changed and why.

Fix the crash now.`;
}

// ── Claude invocation ─────────────────────────────────────────────────────────

function runClaude(prompt) {
  if (!CLAUDE_BIN) throw new Error("Claude Code CLI not found. Install it from claude.ai/code.");

  const tmpPrompt = path.join(__dirname, ".prompt-tmp.txt");
  fs.writeFileSync(tmpPrompt, prompt, "utf8");

  let output = "";
  try {
    output = execSync(
      `"${CLAUDE_BIN}" -p --dangerously-skip-permissions --output-format json < "${tmpPrompt}"`,
      {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
        timeout: 5 * 60 * 1000,  // 5-minute ceiling per issue
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    // Parse JSON output to extract the actual text response
    try {
      const parsed = JSON.parse(output);
      return parsed.result ?? parsed.message ?? output;
    } catch {
      return output;
    }
  } finally {
    fs.unlinkSync(tmpPrompt);
  }
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git ${cmd}`, {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  }).trim();
}

function hasChanges() {
  return git("status --porcelain").length > 0;
}

// ── EAS build + submit ────────────────────────────────────────────────────────

function eas(cmd) {
  execSync(`npx eas-cli ${cmd}`, {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    timeout: 40 * 60 * 1000,  // 40-min ceiling for cloud builds
  });
}

function buildAndSubmit(platform) {
  const platforms = platform === "all" ? ["ios", "android"] : [platform];
  for (const p of platforms) {
    log(`\n📦  Building for ${p}…`);
    if (!DRY_RUN) {
      eas(`build --platform ${p} --profile production --non-interactive --wait`);
      log(`\n🚀  Submitting ${p} to store…`);
      eas(`submit --platform ${p} --latest --non-interactive`);
    } else {
      log(`[dry-run] eas build --platform ${p} --profile production --non-interactive --wait`);
      log(`[dry-run] eas submit --platform ${p} --latest --non-interactive`);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(...args) { console.log(...args); }
function hr() { log("─".repeat(64)); }

function preflight() {
  const missing = [];
  if (!SENTRY_TOKEN)   missing.push("SENTRY_AUTH_TOKEN");
  if (!SENTRY_ORG)     missing.push("SENTRY_ORG");
  if (!SENTRY_PROJECT) missing.push("SENTRY_PROJECT");
  if (missing.length) {
    log(`\n❌  Missing required env vars: ${missing.join(", ")}`);
    log(`   Add them to .env.local:\n`);
    missing.forEach(v => log(`   ${v}=...`));
    log();
    process.exit(1);
  }
  if (!CLAUDE_BIN) {
    log("\n❌  Claude Code CLI not found. Install it from claude.ai/code");
    process.exit(1);
  }
  log(`   Claude CLI : ${CLAUDE_BIN}`);
  log(`   Sentry org : ${SENTRY_ORG} / ${SENTRY_PROJECT}`);
  log(`   Dry run    : ${DRY_RUN}`);
  log(`   Limit      : ${LIMIT} issue(s)`);
  if (FORCE_PLATFORM) log(`   Platform   : ${FORCE_PLATFORM} (forced)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log("\n🔧  Alba automated bug fixer");
  hr();
  preflight();

  log(`\n🔍  Fetching unresolved issues from Sentry…`);
  const issues = await fetchIssues();

  if (!issues.length) {
    log("✅  No unresolved issues. Nothing to do.");
    return;
  }

  log(`\nFound ${issues.length} issue(s):`);
  issues.forEach((issue, i) =>
    log(`  ${i + 1}. [${issue.id}] ${issue.title}  (×${issue.count ?? "?"})`)
  );

  const baseBranch = git("branch --show-current");

  for (const issue of issues) {
    hr();
    log(`\n🐛  [${issue.id}] ${issue.title}`);

    const event    = await fetchLatestEvent(issue.id);
    const platform = detectPlatform(event ?? {});
    log(`   platform detected: ${platform}`);

    const fixBranch = `fix/sentry-${issue.id}`;

    try {
      // ── 1. Create isolated branch ───────────────────────────────────────────
      git(`checkout -b ${fixBranch}`);

      // ── 2. Ask Claude Code to fix it ────────────────────────────────────────
      log(`\n🤖  Running Claude Code…`);
      const prompt = buildPrompt(issue, event ?? {});
      const claudeResult = runClaude(prompt);

      const summary = (claudeResult ?? "").slice(0, 600);
      log(`\nClaude summary:\n${summary}${summary.length < claudeResult?.length ? "…" : ""}`);

      // ── 3. Check whether anything changed ──────────────────────────────────
      if (!hasChanges()) {
        log(`\n⚠️   No files were modified — skipping build.`);
        log(`    The crash may require manual investigation or more context.`);
        git(`checkout ${baseBranch}`);
        git(`branch -d ${fixBranch}`);
        continue;
      }

      // ── 4. Commit the fix ───────────────────────────────────────────────────
      git("add -A");
      git(`commit -m "fix: sentry ${issue.id} — ${issue.title.slice(0, 55).replace(/"/g, "'")}

Automated fix generated by Claude Code.
Sentry: https://${SENTRY_HOST}/organizations/${SENTRY_ORG}/issues/${issue.id}/

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`);

      git(`checkout ${baseBranch}`);
      git(`merge --no-ff ${fixBranch} -m "Merge fix/sentry-${issue.id}"`);
      git(`branch -d ${fixBranch}`);
      log(`\n✅  Fix committed to ${baseBranch}.`);

      // ── 5. Build and submit ─────────────────────────────────────────────────
      buildAndSubmit(platform);

      // ── 6. Resolve the Sentry issue ─────────────────────────────────────────
      if (!DRY_RUN) {
        await markResolved(issue.id);
        log(`\n✅  Sentry issue ${issue.id} marked as resolved.`);
      } else {
        log(`[dry-run] Would mark Sentry issue ${issue.id} as resolved.`);
      }

    } catch (err) {
      log(`\n❌  Failed on issue ${issue.id}: ${err.message}`);
      // Roll back to base branch and clean up
      try {
        git(`checkout ${baseBranch}`);
        git(`branch -D ${fixBranch}`);
      } catch {}
    }
  }

  hr();
  log("Done.\n");
}

main().catch(err => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  ashbySlug:    "Nivoda",
  slackToken:   process.env.SLACK_BOT_TOKEN,
  slackChannel: "#talent-team",
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  jobCount:     6,
};
// ─────────────────────────────────────────────────────────────────────────────

async function fetchJobs(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Ashby API error ${res.status}`);
  const data = await res.json();
  return (data.jobs ?? []).map(j => ({
    id:       j.id,
    title:    j.title,
    team:     j.department ?? "General",
    location: j.location   ?? "Unspecified",
    remote:   j.isRemote   ? "Remote OK" : "On-site",
    url:      j.jobUrl,
    posted:   j.publishedAt ?? null,
  }));
}

async function pickAndFormatJobs(jobs, n) {
  const prompt = `
You are a recruiting-comms assistant writing the Hiring Brilliance Bulletin — a weekly internal Slack message encouraging employees to refer people in their network to open roles.

Here is a JSON array of open roles:

${JSON.stringify(jobs, null, 2)}

Task:
1. Pick ${n} roles to highlight this week. Every role must be different — no duplicates by title, team, or seniority level. Prefer maximum diversity across teams, locations, and seniority.
2. For each chosen role write THREE sentences (max 40 words total). First sentence sells the role and its impact. Second sentence describes what the person will actually do day-to-day — write in third person, never use "you" or "your" as these are referral prompts not job ads. Third sentence triggers a referral thought using language like "Know someone who...", "Who's the best X you've ever worked with?", "Ever worked with someone who...", "Thought of anyone who...". Never use "tag", "comment", "you" or "your".
3. Return ONLY a JSON array (no markdown fences, no preamble) with objects:
   { "id", "title", "team", "location", "remote", "url", "hook" }
`.trim();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":         "application/json",
      "x-api-key":            CONFIG.anthropicKey,
      "anthropic-version":    "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages:   [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }
  const data = await res.json();
  const raw  = data.content.find(b => b.type === "text")?.text ?? "[]";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

function getRemoteEmoji(remote) {
  if (remote === "Remote OK") return "🌍";
  if (remote === "Hybrid")    return "🏡";
  return "🏢";
}

function buildSlackBlocks(picks) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "💎 Hiring Brilliance Bulletin 💎", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*${today}* · Know someone brilliant? Here are this week's top roles to share` }],
    },
    { type: "divider" },
  ];

  for (const job of picks) {
    const remoteEmoji = getRemoteEmoji(job.remote);
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${job.url}|${job.title}>*\n${job.hook}`,
        },
        accessory: {
          type: "button",
          text:  { type: "plain_text", text: "Refer →", emoji: true },
          url:   job.url,
          style: "primary",
        },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `${remoteEmoji} ${job.remote}  ·  📍 ${job.location}  ·  🏢 ${job.team}`,
        }],
      },
      { type: "divider" },
    );
  }

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `💡 A referral from you could change someone's career — and earn you a bonus. See all open roles → <https://jobs.ashbyhq.com/${CONFIG.ashbySlug}|jobs.ashbyhq.com/${CONFIG.ashbySlug}>`,
    }],
  });

  return blocks;
}

async function postToSlack(blocks) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json; charset=utf-8",
      "Authorization": `Bearer ${CONFIG.slackToken}`,
    },
    body: JSON.stringify({
      channel: CONFIG.slackChannel,
      text:    "💎 Hiring Brilliance Bulletin 💎",
      blocks,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack error: ${data.error}`);
  return data.ts;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log("📋 Fetching jobs from Ashby for the Hiring Brilliance Bulletin…");
    const jobs = await fetchJobs(CONFIG.ashbySlug);
    console.log(`   Found ${jobs.length} open roles.`);

    console.log("🤖 Asking Claude to pick and write hooks…");
    const picks = await pickAndFormatJobs(jobs, CONFIG.jobCount);
    console.log(`   Selected: ${picks.map(p => p.title).join(", ")}`);

    console.log("📣 Posting Hiring Brilliance Bulletin to Slack…");
    const ts = await postToSlack(buildSlackBlocks(picks));
    console.log(`✅ Hiring Brilliance Bulletin posted! Message timestamp: ${ts}`);
  } catch (err) {
    console.error("❌ Hiring Brilliance Bulletin failed:", err.message);
    process.exit(1);
  }
})();

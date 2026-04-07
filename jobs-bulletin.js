// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  ashbySlug:    "Nivoda",
  slackToken:   process.env.SLACK_BOT_TOKEN,
  slackChannel: "#general",
  geminiKey:    process.env.GEMINI_API_KEY,
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
You are a recruiting-comms assistant for the Hiring Brilliance Bulletin. Here is a JSON array of open roles:

${JSON.stringify(jobs, null, 2)}

Task:
1. Pick the ${n} most compelling / diverse roles to highlight this week.
   Prefer a mix of seniority levels, teams, and location types.
2. For each chosen role write ONE punchy sentence (max 15 words) that makes
   the role sound exciting — focus on impact, not just responsibilities.
3. Return ONLY a JSON array (no markdown fences, no preamble) with objects:
   { "id", "title", "team", "location", "remote", "url", "hook" }
`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const data = await res.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

function buildSlackBlocks(picks) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "💎 Hiring Brilliance Bulletin", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `*${today}* · ${picks.length} roles worth a look` }],
    },
    { type: "divider" },
  ];

  for (const job of picks) {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${job.url}|${job.title}>*\n${job.hook}`,
        },
        accessory: {
          type: "button",
          text:  { type: "plain_text", text: "Apply →", emoji: true },
          url:   job.url,
          style: "primary",
        },
      },
      {
        type: "context",
        elements: [{
          type: "mrkdwn",
          text: `🏢 ${job.team}  ·  📍 ${job.location}  ·  🌐 ${job.remote}`,
        }],
      },
      { type: "divider" },
    );
  }

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `See all open roles → <https://jobs.ashbyhq.com/${CONFIG.ashbySlug}|jobs.ashbyhq.com/${CONFIG.ashbySlug}>`,
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
      text:    "💎 Hiring Brilliance Bulletin",
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

    console.log("🤖 Asking Gemini to pick and write hooks…");
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

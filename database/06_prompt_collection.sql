-- 06_prompt_collection.sql — pre-built prompt library for the Workbench
-- Library tab (h6). idempotent: re-running refreshes content, keeps ids.
INSERT INTO saved_resources(user_id, title, kind, content, category)
SELECT 1, t.title, 'prompt', t.content, t.category
FROM (VALUES
  -- ── Writing ──────────────────────────────────────────────────────────
  ('Polish this writing', 'writing', E'Edit the following text for clarity, flow, and grammar. Keep my voice. Return the edited version plus a 3-bullet list of what you changed and why:\n\n<paste text>'),
  ('Blog post outline', 'writing', E'Create a detailed outline for a blog post titled "<title>" aimed at <audience>. Include: hook, 4-6 H2 sections with 2-3 bullet points each, a counterpoint section, and a CTA. Tone: expert but approachable.'),
  ('Professional email', 'writing', E'Write a concise professional email about <topic>. Context: <context>. Tone: <formal/direct/friendly>. Keep it under 120 words and end with a clear ask.'),
  ('Rewrite for audience', 'writing', E'Rewrite this text for <audience>. Simplify jargon, keep all facts, and make it <tone>:\n\n<paste text>'),
  ('TL;DR any document', 'writing', E'Summarize this document in: 1 one-sentence TL;DR, 5 key bullets, and 3 open questions the reader should ask:\n\n<paste text>'),
  -- ── Coding ───────────────────────────────────────────────────────────
  ('Code review', 'coding', E'Review this code for: correctness, edge cases, performance, security, and naming. Give concrete fixes as diffs, ranked by severity:\n\n```\n<paste code>\n```'),
  ('Explain this code', 'coding', E'Explain what this code does step by step, then list any bugs or risks. Assume I know <language> basics but not this codebase:\n\n```\n<paste code>\n```'),
  ('Write unit tests', 'coding', E'Write thorough unit tests for this code using <framework>. Cover happy path, edge cases, and error handling. Explain any non-obvious assertions:\n\n```\n<paste code>\n```'),
  ('Refactor for clarity', 'coding', E'Refactor this code to be more readable and maintainable without changing behavior. Show the refactored version and explain each change:\n\n```\n<paste code>\n```'),
  ('Debug an error', 'coding', E'I am getting this error:\n\n<error message>\n\nFrom this code:\n\n```\n<paste code>\n```\n\nDiagnose the root cause (not symptoms), give the minimal fix, and explain how to prevent it.'),
  ('SQL query builder', 'coding', E'Write a SQL query for <database>: <description of the data need>. Schema: <paste schema>. Explain the query and note any index that would help.'),
  ('Regex builder', 'coding', E'Create a regex that matches <describe pattern>. Give the regex, a breakdown of each part, and 5 test strings that pass/fail.'),
  -- ── Business ─────────────────────────────────────────────────────────
  ('SWOT analysis', 'business', E'Run a SWOT analysis for <company/product> in <market>. Be specific and evidence-led, not generic. Finish with the single highest-leverage move.'),
  ('Competitive teardown', 'business', E'Compare <our product> vs <competitor> across: positioning, pricing, features, and target customer. Present as a table, then give 3 differentiation moves.'),
  ('Cold outreach message', 'business', E'Write a 3-touch cold outreach sequence for selling <product> to <persona>. Each touch under 80 words, personalized hooks, no fluff.'),
  ('Meeting agenda', 'business', E'Design a 30-minute agenda for a meeting about <topic> with <attendees>. Include time boxes, desired outcome per item, and pre-reads.'),
  ('Pricing page copy', 'business', E'Write pricing page copy for <product> with 3 tiers. For each: name, one-line value prop, 5 feature bullets, and the psychological anchor.'),
  -- ── Analysis ─────────────────────────────────────────────────────────
  ('Analyze this data', 'analysis', E'Analyze this dataset/table. Give: 3 headline findings, 1 surprising insight, 2 things the data cannot tell us, and the chart type that best shows each finding:\n\n<paste data>'),
  ('Decision matrix', 'analysis', E'Build a weighted decision matrix for choosing between <option A> and <option B>. Criteria: <list>. Show scores, weights, math, and a recommendation with caveats.'),
  ('Root cause drill-down', 'analysis', E'Use 5-why root cause analysis on this problem: <problem>. Challenge each level, then propose fixes at the true root, not the symptoms.'),
  ('Risk assessment', 'analysis', E'List the top risks for <project/decision> as: risk, likelihood (H/M/L), impact (H/M/L), mitigation. Sort by severity and flag the one most teams miss.'),
  -- ── Research ─────────────────────────────────────────────────────────
  ('Research a topic deeply', 'research', E'Research <topic> thoroughly. Cover: what it is, why it matters now, the 2-3 leading perspectives with their strongest evidence, open debates, and where to read more. Flag anything uncertain.'),
  ('Literature scan', 'research', E'Give the state of the art on <field/topic>: seminal work, current frontier, and the 3 papers/sources a newcomer should read first — with why each matters.'),
  ('Compare and contrast', 'research', E'Compare <X> and <Y> across history, mechanism, strengths, failure modes, and best-fit use cases. End with: "choose X if…, choose Y if…"'),
  ('Fact-check this claim', 'research', E'Fact-check this claim: "<claim>". Rate it true/partially true/false/unverifiable, show the strongest evidence for and against, and list what evidence would settle it.'),
  -- ── Learning ─────────────────────────────────────────────────────────
  ('Explain like I am 12', 'learning', E'Explain <concept> as if I am 12: one everyday analogy, then the real explanation, then why it matters. No jargon in the first paragraph.'),
  ('Socratic tutor', 'learning', E'Teach me <topic> Socratically: ask me one question at a time, adapt to my answers, and only reveal the answer after I have tried. Start now.'),
  ('Learning roadmap', 'learning', E'Build a <duration>-week learning roadmap for <skill>. Weekly: goal, resources (free where possible), a concrete exercise, and a self-test. Assume <hours/week> available.'),
  ('Flashcards from notes', 'learning', E'Turn these notes into 10 active-recall flashcards (question front, precise answer back), ordered from foundational to advanced:\n\n<paste notes>'),
  -- ── Productivity ─────────────────────────────────────────────────────
  ('Plan my week', 'productivity', E'Here are my tasks and deadlines:\n\n<paste list>\n\nPlan my week: group by energy level, protect 2 deep-work blocks, flag conflicts, and mark the 3 tasks that actually move the needle.'),
  ('Break down a project', 'productivity', E'Break this project into milestones, tasks, and subtasks with estimates. Flag dependencies and the critical path:\n\n<project description>'),
  ('Turn notes into actions', 'productivity', E'Extract from these notes: every decision made, every action item with a suggested owner and due date, and every open question:\n\n<paste notes>'),
  ('Prioritize with RICE', 'productivity', E'Score these tasks with RICE (Reach, Impact, Confidence, Effort) and return a sorted table plus the top 3 I should do today:\n\n<paste tasks>'),
  -- ── Creative ─────────────────────────────────────────────────────────
  ('Story starter', 'creative', E'Write the opening 150 words of a story: genre <genre>, protagonist <who>, setting <where>. End on a hook that demands the next line.'),
  ('Name generator', 'creative', E'Generate 15 names for <thing/product/character>. Mix styles: descriptive, abstract, compound. One line each on the feel it conveys.'),
  ('Image prompt craft', 'creative', E'Turn this idea into a rich image-generation prompt with subject, composition, lighting, lens, mood, and style references. Give one photorealistic and one illustrated variant:\n\n<idea>'),
  ('Video script (60s)', 'creative', E'Write a 60-second video script about <topic>: hook (0-5s), 3 beats with visual directions, and a CTA. Include b-roll suggestions.'),
  -- ── Translation ──────────────────────────────────────────────────────
  ('Translate with nuance', 'translation', E'Translate this into <language>. Give: the translation, a back-translation so I can check accuracy, and notes on any idiom you adapted:\n\n<paste text>'),
  ('Localize, don''t translate', 'translation', E'Localize this marketing copy for <locale>: adapt idioms, units, examples, and tone to feel native — not translated:\n\n<paste text>'),
  ('Bilingual glossary', 'translation', E'Create a bilingual glossary of the key terms in this text (<source> → <target>), then translate the full text using those terms consistently:\n\n<paste text>')
) AS t(title, category, content)
ON CONFLICT DO NOTHING;

-- attach them to the admin user's catalog view
SELECT setval(pg_get_serial_sequence('saved_resources','id'), (SELECT MAX(id) FROM saved_resources));
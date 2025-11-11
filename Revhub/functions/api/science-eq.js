// Cloudflare Pages Function for /api/science-eq
// Local dev: use `wrangler pages dev Revhub` and a .dev.vars file with OPENAI_API_KEY=...

const ALLOWED = {
	'Physics': ['Electricity', 'Forces & Motion'],
	'Chemistry': ['Acids & Bases', 'Atomic Structure'],
	'Biology': ['Genetics', 'Human Body (3 Main Systems)']
};

function getCorsOrigin(request) {
	const origin = request.headers.get('Origin') || '';
	const allowed = new Set([
		'https://artinamr.xyz',
		'http://localhost',
		'http://localhost:3000',
		'http://127.0.0.1:3000',
		'http://127.0.0.1:5500',
		'http://127.0.0.1:8788',
		'http://localhost:8788'
	]);
	try {
		const u = new URL(origin);
		const base = `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
		return allowed.has(base) ? base : 'https://artinamr.xyz';
	} catch {
		return 'https://artinamr.xyz';
	}
}

function jsonResponse(data, init = {}, origin) {
	const headers = new Headers(init.headers || {});
	headers.set('Content-Type', 'application/json');
	if (origin) {
		headers.set('Access-Control-Allow-Origin', origin);
		headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
		headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	}
	return new Response(JSON.stringify(data), { ...init, headers });
}

async function generateQuestion(subject, topic, apiKey) {
	const system = [
		'You are a New Zealand Year 10 Science tutor.',
		'Generate ONE Excellence-level (E) question appropriate for Year 10 difficulty.',
		'It must be strictly relevant to the given subject and topic constraints:',
		'- Physics: Electricity OR Forces & Motion',
		'- Chemistry: Acids & Bases OR Atomic Structure (exclude isotopes)',
		'- Biology: Genetics OR the Human Body (focus on 3 main systems)',
		'Output JSON of the shape: {"question":"..."} and ONLY that JSON.'
	].join(' ');

	const user = `Subject: ${subject}\nTopic: ${topic}\nConstraints:\n- Keep to Year 10 depth.\n- Create a single exam-style prompt that requires reasoning/worked steps.\n- Do not include the answer.\n- Avoid graph images; describe clearly if needed.`;

	const payload = {
		model: 'gpt-4o-mini',
		temperature: 0.7,
		response_format: { type: 'json_object' },
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		]
	};

	const resp = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	if (!resp.ok) throw new Error(`OpenAI error (${resp.status})`);
	const data = await resp.json();
	const content = data?.choices?.[0]?.message?.content || '';
	let parsed;
	try { parsed = JSON.parse(content); } catch { parsed = { question: content?.trim() }; }
	if (!parsed?.question) throw new Error('No question returned from model.');
	return { question: parsed.question };
}

async function gradeAnswer(subject, topic, question, answer, apiKey) {
	const system = [
		'You are a New Zealand Year 10 Science marker.',
		'Mark using NCEA-style bands (Not Achieved, Achieved, Merit, Excellence) and a score out of 8.',
		'Give specific feedback and an improved model answer appropriate for Year 10.',
		'Stay within the exact subject/topic constraints:',
		'- Physics: Electricity OR Forces & Motion',
		'- Chemistry: Acids & Bases OR Atomic Structure (exclude isotopes)',
		'- Biology: Genetics OR the Human Body (focus on 3 main systems).',
		'Respond ONLY as JSON with fields: grade_band, score, feedback, improved_answer.'
	].join(' ');

	const user = [
		`Subject: ${subject}`,
		`Topic: ${topic}`,
		`Question: ${question}`,
		`StudentAnswer: ${answer}`,
		'Requirements:',
		'- Grade band must be one of Not Achieved, Achieved, Merit, Excellence.',
		'- Score is an integer 0–8.',
		'- Feedback should be concise and actionable.',
		'- Improved answer should fully answer the question at Year 10 E-level.'
	].join('\n');

	const payload = {
		model: 'gpt-4o-mini',
		temperature: 0.3,
		response_format: { type: 'json_object' },
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: user }
		]
	};

	const resp = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload)
	});
	if (!resp.ok) throw new Error(`OpenAI error (${resp.status})`);
	const data = await resp.json();
	const content = data?.choices?.[0]?.message?.content || '';
	let parsed;
	try { parsed = JSON.parse(content); } catch { throw new Error('Failed to parse grading JSON.'); }
	if (!parsed?.grade_band || typeof parsed?.score === 'undefined') throw new Error('Incomplete grading response.');
	return {
		grade_band: parsed.grade_band,
		score: parsed.score,
		feedback: parsed.feedback || '',
		improved_answer: parsed.improved_answer || ''
	};
}

export async function onRequestOptions({ request }) {
	const origin = getCorsOrigin(request);
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization'
		}
	});
}

export async function onRequestPost({ request, env }) {
	const origin = getCorsOrigin(request);
	if (!env.OPENAI_API_KEY) {
		return jsonResponse({ error: 'Server not configured: OPENAI_API_KEY missing.' }, { status: 500 }, origin);
	}

	let body;
	try {
		body = await request.json();
	} catch {
		return jsonResponse({ error: 'Invalid JSON body.' }, { status: 400 }, origin);
	}

	const { action, subject, topic } = body || {};
	if (!action || !subject || !topic) {
		return jsonResponse({ error: 'Missing required fields: action, subject, topic.' }, { status: 400 }, origin);
	}
	if (!ALLOWED[subject] || !ALLOWED[subject].includes(topic)) {
	 return jsonResponse({ error: 'Invalid subject/topic selection.' }, { status: 400 }, origin);
	}

	try {
		if (action === 'generate') {
			const result = await generateQuestion(subject, topic, env.OPENAI_API_KEY);
			return jsonResponse(result, { status: 200 }, origin);
		}
		if (action === 'grade') {
			const { question, answer } = body || {};
			if (!question || !answer) {
				return jsonResponse({ error: 'Missing question or answer for grading.' }, { status: 400 }, origin);
			}
			const result = await gradeAnswer(subject, topic, question, answer, env.OPENAI_API_KEY);
			return jsonResponse(result, { status: 200 }, origin);
		}
		return jsonResponse({ error: 'Unknown action.' }, { status: 400 }, origin);
	} catch (e) {
		return jsonResponse({ error: e.message || 'Internal error.' }, { status: 500 }, origin);
	}
}



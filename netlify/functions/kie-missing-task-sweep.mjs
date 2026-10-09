import submission from '../../lib/kie/submission.cjs';

export const config = { schedule: '* * * * *' };

export default async request => {
  const payload = await request.json().catch(() => null);
  if (!payload?.next_run) return new Response(null, { status: 401 });
  try {
    const result = await submission.resolveMissingTask();
    return Response.json({ ok: !result.errors, ...result }, { status: result.errors ? 500 : 200 });
  } catch (error) {
    console.error('KIE missing task recovery:', error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
};

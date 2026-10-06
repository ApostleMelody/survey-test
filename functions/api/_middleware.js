/**
 * 想法共创问卷 · 后端（Pages Functions 中间件）
 *
 * 文件路径严格为：functions/api/_middleware.js
 *
 * 为什么用中间件：
 *  - 文件名 _middleware.js 不含方括号 → GitHub 网页上传不会报错
 *  - 不使用 [[...slug]].js 这类动态路由 → 不会触发 Cloudflare 路由参数报错
 *  - 它接管所有 /api/* 请求（任意层级），不再依赖路由文件名
 *
 * 部署后接口地址（和你问卷页面同一个 pages.dev 域名）：
 *   POST /api/submit        提交答案
 *   POST /api/admin/login   管理员登录
 *   GET  /api/results       导出结果（format=json 或 format=csv）
 *
 * 存储：KV 命名空间，绑定名 SURVEY_KV
 * 密码：Pages 项目「设置→环境变量」里的机密变量 ADMIN_PASSWORD
 */

export async function onRequest(context) {
  const { request, env } = context;

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  function json(data, status = 200, extra = {}) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...extra },
    });
  }

  function escapeCsv(s) {
    const str = String(s == null ? '' : s);
    if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  const url = new URL(request.url);

  // 跨域预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const path = url.pathname;

  // ---------- 提交答案 ----------
  if (path === '/api/submit' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (!Array.isArray(body.answers)) return json({ ok: false, error: '数据格式错误' }, 400);
      const id = crypto.randomUUID();
      const rec = { id, at: new Date().toISOString(), answers: body.answers };
      await env.SURVEY_KV.put('sub:' + id, JSON.stringify(rec));
      const rawIdx = await env.SURVEY_KV.get('index:subs', 'json');
      const list = rawIdx || [];
      list.push(id);
      await env.SURVEY_KV.put('index:subs', JSON.stringify(list));
      return json({ ok: true, id });
    } catch (e) {
      return json({ ok: false, error: '数据格式错误' }, 400);
    }
  }

  // ---------- 管理员登录 ----------
  if (path === '/api/admin/login' && request.method === 'POST') {
    try {
      const body = await request.json();
      if (body.password === env.ADMIN_PASSWORD) {
        const token = crypto.randomUUID();
        await env.SURVEY_KV.put('token:' + token, '1', { expirationTtl: 2 * 3600 });
        return json({ ok: true, token });
      }
      return json({ ok: false, error: '密码错误' }, 403);
    } catch (e) {
      return json({ ok: false, error: '请求格式错误' }, 400);
    }
  }

  // ---------- 导出结果 ----------
  if (path === '/api/results') {
    const auth = (request.headers.get('Authorization') || url.searchParams.get('token') || '').replace('Bearer ', '').trim();
    if (!auth) return json({ ok: false, error: '未登录' }, 401);
    const valid = await env.SURVEY_KV.get('token:' + auth);
    if (valid !== '1') return json({ ok: false, error: '会话已失效，请重新登录' }, 401);

    const rawIdx = await env.SURVEY_KV.get('index:subs', 'json');
    const subs = [];
    for (const id of (rawIdx || [])) {
      const raw = await env.SURVEY_KV.get('sub:' + id);
      if (raw) {
        try { subs.push(JSON.parse(raw)); } catch (e) { /* 跳过损坏记录 */ }
      }
    }

    if (url.searchParams.get('format') === 'csv') {
      let csv = '\uFEFF提交时间,题目,答案\n';
      for (const s of subs) {
        for (const q of s.answers) {
          csv += escapeCsv(s.at) + ',' + escapeCsv(q.title) + ',' + escapeCsv(q.answer) + '\n';
        }
      }
      return new Response(csv, {
        headers: {
          ...CORS,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="survey-results.csv"',
        },
      });
    }

    return json({ ok: true, total: subs.length, results: subs });
  }

  return json({ ok: false, error: '接口不存在' }, 404);
}
//（注：内容由AI生成）

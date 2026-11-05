// ローカルLLM（Ollama）の検証スクリプト
// 使い方: node ollama-check.mjs [モデル名 ...]
//   例) node ollama-check.mjs qwen3:8b qwen3:30b-a3b
// 必要: Node 18 以上（fetch 内蔵）、Ollama が起動していること
// 調べること: GPUへの載り方、生成速度、パラメータJSONの正確さ、字幕JSONの形

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const models = process.argv.length > 2 ? process.argv.slice(2) : ['qwen3:8b', 'qwen3:30b-a3b'];

// 会戦ビュワーの params() と同じ項目（内部定数は含めない）
const paramSchema = {
  type: 'object',
  properties: {
    Zin:   { type: 'integer', minimum: 0, maximum: 200 },
    Zback: { type: 'integer', minimum: 0, maximum: 300 },
    place: { type: 'string', enum: ['lane', 'H2'] },
    R:     { type: 'integer', minimum: 0, maximum: 240 },
    N0:    { type: 'integer', minimum: 0, maximum: 20 },
    G0:    { type: 'integer', minimum: 0, maximum: 200 },
    thr:   { type: 'integer', minimum: 1, maximum: 300 },
    title: { type: 'string' }
  },
  required: ['Zin', 'Zback', 'place', 'R', 'N0', 'G0', 'thr', 'title']
};
const base = { Zin: 30, Zback: 50, place: 'lane', R: 20, N0: 3, G0: 24, thr: 40 };
const paramCases = [
  { request: '後続をH2に温存して、ザイレンの反応時間を40分に遅らせた版', ok: p => p.place === 'H2' && p.R === 40 && p.G0 === 24 },
  { request: 'ガード級を倍にして、ノード艦を1隻に減らした版',             ok: p => p.G0 === 48 && p.N0 === 1 && p.Zin === 30 },
  { request: 'ザイレンのH2在艦を60隻に増やした版',                         ok: p => p.Zin === 60 && p.Zback === 50 }
];

const captionSchema = {
  type: 'object',
  properties: {
    captions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { t: { type: 'integer' }, text: { type: 'string' } },
        required: ['t', 'text']
      }
    }
  },
  required: ['captions']
};
const eventLog = [
  { t: 0,  ev: '人類増援が妨害場外縁の外に出現。ロックタイム45分が始まる' },
  { t: 2,  ev: 'ザイレンが光学観測で人類艦隊に気づく。H2が警戒態勢' },
  { t: 5,  ev: 'エルダ級2隻がH2から人類艦隊へレーン延伸を開始（約80分）' },
  { t: 15, ev: '通信艦の再同期が終わり、議会との通信が復帰' },
  { t: 45, ev: 'ロックタイム明け。人類がH2至近へ任意座標ジャンプ' },
  { t: 60, ev: '妨害場の展開完了。H2が妨害場の内側に入る' }
];
const result = '人類勝ち（H2無力化）';

async function chat(model, messages, format) {
  const t0 = Date.now();
  const body = { model, messages, format, stream: false, options: { temperature: 0.2, num_ctx: 8192 } };
  if (model.startsWith('qwen3')) body.think = false; // qwen3 は考える過程を切ると速い
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return {
    content: d.message.content,
    tps: d.eval_count / (d.eval_duration / 1e9),
    loadSec: (d.load_duration || 0) / 1e9,
    wallSec: (Date.now() - t0) / 1000
  };
}

async function gpuShare(model) {
  const d = await (await fetch(`${OLLAMA_URL}/api/ps`)).json();
  const m = (d.models || []).find(x => x.name === model || x.model === model);
  if (!m) return null;
  return { totalGB: m.size / 1e9, gpuPct: Math.round((m.size_vram / m.size) * 100) };
}

async function checkModel(model) {
  console.log(`\n===== ${model} =====`);
  const report = { model, paramsOk: 0, paramsTotal: paramCases.length, tps: [], errors: [] };

  // 1. パラメータJSON
  for (const c of paramCases) {
    try {
      const r = await chat(model, [
        { role: 'system', content: 'あなたは会戦シミュレータのパラメータ係。設定の議論はしない。基準値から、依頼に必要な項目だけ変えたJSONを返す。' },
        { role: 'user', content: `基準値: ${JSON.stringify(base)}\n依頼: ${c.request}` }
      ], paramSchema);
      const p = JSON.parse(r.content);
      const ok = c.ok(p);
      if (ok) report.paramsOk++;
      report.tps.push(r.tps);
      if (r.loadSec > 1) console.log(`  (モデル読み込み ${r.loadSec.toFixed(1)}秒)`);
      console.log(`  [${ok ? 'OK' : 'NG'}] ${c.request}`);
      console.log(`       → ${JSON.stringify(p)}  ${r.tps.toFixed(1)} tok/s, ${r.wallSec.toFixed(1)}秒`);
    } catch (e) {
      report.errors.push(e.message);
      console.log(`  [ERR] ${c.request}: ${e.message}`);
    }
  }

  // 2. GPU への載り方（読み込み後に確認）
  const g = await gpuShare(model).catch(() => null);
  report.gpu = g;
  console.log(g ? `  GPU: ${g.gpuPct}%（モデル全体 ${g.totalGB.toFixed(1)}GB）` : '  GPU: 取得できず');

  // 3. 字幕JSON
  try {
    const r = await chat(model, [
      { role: 'system', content: 'あなたは宇宙会戦の映像の字幕係。設定の議論はしない。ログにない出来事や数値を作らない。字幕は1つ40字以内の日本語。' },
      { role: 'user', content: `イベントログ: ${JSON.stringify(eventLog)}\n結果: ${result}\n各イベントの時刻 t に字幕を付けて返して。` }
    ], captionSchema);
    const caps = JSON.parse(r.content).captions;
    const logTimes = new Set(eventLog.map(e => e.t));
    const badTime = caps.filter(c => !logTimes.has(c.t)).length;
    const tooLong = caps.filter(c => [...c.text].length > 40).length;
    report.tps.push(r.tps);
    report.captions = { count: caps.length, badTime, tooLong, samples: caps };
    console.log(`  字幕: ${caps.length}件（ログにない時刻 ${badTime}件、40字超 ${tooLong}件） ${r.tps.toFixed(1)} tok/s`);
    for (const c of caps) console.log(`       T+${c.t}分  ${c.text}`);
  } catch (e) {
    report.errors.push(e.message);
    console.log(`  [ERR] 字幕: ${e.message}`);
  }

  report.avgTps = report.tps.length ? report.tps.reduce((a, b) => a + b, 0) / report.tps.length : 0;
  console.log(`  平均 ${report.avgTps.toFixed(1)} tok/s／パラメータ ${report.paramsOk}/${report.paramsTotal}`);
  return report;
}

const ver = await fetch(`${OLLAMA_URL}/api/version`).then(r => r.json()).catch(() => null);
if (!ver) {
  console.error(`Ollama に接続できません（${OLLAMA_URL}）。Ollama が起動しているか確認してください。`);
  process.exit(1);
}
console.log(`Ollama ${ver.version} に接続`);

const reports = [];
for (const m of models) reports.push(await checkModel(m));

console.log('\n===== まとめ（JSON） =====');
console.log(JSON.stringify(reports.map(({ captions, tps, ...r }) => ({
  ...r, avgTps: +r.avgTps.toFixed(1),
  captions: captions && { count: captions.count, badTime: captions.badTime, tooLong: captions.tooLong }
})), null, 2));

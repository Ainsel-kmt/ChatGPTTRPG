# 引継ぎ: ローカルLLMのセットアップ・検証とStudioへの組み込み

## 目的
作成中の映像化Studio（会戦ビュワー `simulate(p)` を発展させたもの）に、ローカルLLM（Ollama）の呼び出しを追加する。
会戦案づくりと字幕づくりをローカルLLMに任せ、Claude Code のトークン消費を減らすのが狙い。

このセッションでは次の順に進める。**各段階の終わりに、結果を日本語でユーザーに短く報告してから次へ進む。**

1. 事前確認 → 2. Ollama のインストール → 3. モデルの取得 → 4. 単体検証 → 5. Studio への組み込み → 6. 組み込み後の検証 → 7. 結果の記録

## 守ること
- **会話・途中経過の報告・コミットメッセージはすべて日本語。**
- **損耗モデル・数値・`simulate(p)` の中身は変えない。** LLM はパラメータを選ぶだけで、計算はコードだけが行う。
- **設定（思考実験）は再議論しない。** LLM のシステムプロンプトにも「設定の議論はしない」と入れる。
- **既存の Studio の構成・書き方に合わせる。** 下の設計は目安で、ファイル名や置き場所は今のコードに合わせてよい。
- **ユーザーの許可を取ってから進めること:** ソフトのインストール、大きなダウンロード（合計で約25GB）、OS の環境変数の変更。
- **画面の表示確認はユーザーに頼む。**

## 環境（ユーザー申告）
- GPU: NVIDIA RTX 3060 Ti（VRAM 8GB）
- メインメモリ: 32GB
- OS: 未確認（段階1で確認する。Windows の可能性が高い）

### 使うモデル
| 役割 | モデル | サイズ目安 | 置き場所 |
|---|---|---|---|
| 下書き用 | `qwen3:8b` | 約5GB | 全部GPU |
| 清書用 | `qwen3:30b-a3b` | 約19GB | GPU 8GB + メインメモリ約11GB |
| 予備（清書用が遅いとき） | `gpt-oss:20b` | 約14GB | GPU 8GB + メインメモリ約6GB |

- 下書き用と清書用は同時に VRAM に載らない。切り替えると読み込みに数十秒かかる。
- `qwen3` は API で `think: false` を付けると、考える過程を出さずに速く答える。短い仕事では必ず付ける。`gpt-oss` には付けない。

---

## 段階1: 事前確認

次を確かめて、結果をユーザーに報告する。

| 確認すること | Windows（PowerShell） | Mac / Linux |
|---|---|---|
| OS | `[System.Environment]::OSVersion` | `uname -a` |
| GPU とドライバ | `nvidia-smi` | `nvidia-smi`（Linux） |
| ディスクの空き（30GB 以上必要） | `Get-PSDrive C` | `df -h ~` |
| Ollama が入っているか | `ollama --version` | `ollama --version` |
| Node（検証スクリプト用、18 以上） | `node --version` | `node --version` |

- `nvidia-smi` が動かない、またはドライバが古い場合は、NVIDIA の公式サイトからドライバを更新するようユーザーに伝える（Ollama は GPU を使えないと CPU だけで動き、非常に遅くなる）。
- C ドライブの空きが足りない場合は、モデルの保存先を別ドライブにする（環境変数 `OLLAMA_MODELS` に保存先フォルダを設定し、Ollama を再起動）。設定前にユーザーに確認する。
- Node がない場合は、段階4のスクリプトと同じ処理を Python で書いてよい。

## 段階2: Ollama のインストール

すでに入っていれば飛ばす。入れる前にユーザーの許可を取る。

| OS | 方法 |
|---|---|
| Windows | `winget install Ollama.Ollama`。winget が使えなければ https://ollama.com/download から `OllamaSetup.exe` を入れてもらう |
| Mac | https://ollama.com/download からアプリを入れてもらう |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` |

- Windows ではインストール後、Ollama がタスクトレイに常駐する。**新しいターミナルを開かないと `ollama` コマンドが見つからない**ことがある。
- 確認: `ollama --version` と、ブラウザまたはコマンドで `http://localhost:11434/api/version` が `{"version":"..."}` を返すこと。
  - Windows のコマンドなら `curl.exe http://localhost:11434/api/version`（PowerShell の `curl` は別物なので `.exe` を付ける）

## 段階3: モデルの取得

合計約24GB のダウンロードになるので、ユーザーの許可を取ってから行う。

```bash
ollama pull qwen3:8b
ollama pull qwen3:30b-a3b
ollama list            # 2つが並んでいれば完了
```

`gpt-oss:20b` は、段階4で `qwen3:30b-a3b` が遅すぎた場合だけ取得する。

## 段階4: 単体検証

Studio に組み込む前に、モデルが仕事をこなせるかを確かめる。下の検証スクリプトを Studio のリポジトリの外（例: 作業用フォルダ）に `ollama-check.mjs` として保存して実行する。

```bash
node ollama-check.mjs qwen3:8b qwen3:30b-a3b
```

スクリプトが調べること:
- **GPU への載り方**: Ollama の `/api/ps` から、モデルのうち何%が GPU に載っているか
- **生成速度**: 1秒あたりの生成トークン数（tok/s）
- **パラメータJSON**: 依頼文3つを、期待どおりの値に変換できたか
- **字幕JSON**: イベントログから字幕を作り、ログにない時刻や40字超がないか。字幕の文面も表示する

<details><summary>検証スクリプト ollama-check.mjs（クリックで開く）</summary>

```js
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
```

</details>

### 合格の目安と、だめなときの対処

| モデル | 見るところ | 合格の目安 | だめなとき |
|---|---|---|---|
| `qwen3:8b` | GPU | 100% | 他のアプリが VRAM を使っていないか `nvidia-smi` で確認。`num_ctx` を 4096 に下げる |
| `qwen3:8b` | 速度 | 20 tok/s 以上 | GPU が 100% なのに遅いならドライバを確認 |
| `qwen3:8b` | パラメータ | 3/3（2/3 なら様子見） | システムプロンプトに「変えない項目は基準値のまま」と足す。それでもだめなら、パラメータ変換も清書用モデルで行う |
| `qwen3:30b-a3b` | GPU | 30〜45% 程度（残りはメインメモリ） | 0% なら GPU が使えていない。段階1のドライバ確認へ |
| `qwen3:30b-a3b` | 速度 | 8 tok/s 以上（5 以上なら可） | 5 未満なら、ブラウザなど重いアプリを閉じて再測定。それでも遅ければ `gpt-oss:20b` を取得して同じ検証をし、速いほうを清書用にする |
| 両方 | 字幕 | ログにない時刻 0件、40字超 0件 | 時刻のずれは組み込み時にコードで弾く（段階5-3）。文面の自然さはユーザーに見てもらう |

**字幕の文面（スクリプトが表示したもの）は、そのままユーザーに見せて、日本語として使えそうか判断してもらう。** 下書き用で十分なら清書用は使わない、という判断もありうる。

## 段階5: Studio への組み込み

### 5-1. 設定
- `OLLAMA_URL`（既定 `http://localhost:11434`）
- `DRAFT_MODEL`（既定 `qwen3:8b`）
- `FINAL_MODEL`（既定 `qwen3:30b-a3b`。段階4の結果で `gpt-oss:20b` にしてもよい）
- 画面からも下書き用／清書用を選べるようにする

### 5-2. 文章 → パラメータJSON
- 入力: ユーザーの依頼文（例「後続をH2に温存して、反応を40分に遅らせた版」）と、現在のパラメータ
- 出力: `params()` と同じ項目のJSON ＋ `title`（会戦案の短い名前）
- Ollama の `format` に JSONスキーマを渡して出力の形を強制する（検証スクリプトの `paramSchema` を流用）。各項目に `minimum` / `maximum` / `enum` を付けて範囲を縛る
- 返ってきた値はコード側でもう一度範囲チェックしてから `simulate(p)` に渡す
- `kz` `q` `loss` `ward` `lockDur` などの内部定数は LLM に触らせない（スキーマに入れない）

### 5-3. イベントログ → 時刻付き字幕
- 入力: `simulate(p)` の結果のうち、**イベントログ（時刻と出来事）と結果だけ**。設定資料の全文は渡さない（VRAM からはみ出して遅くなる）
- 出力: `{ "captions": [{ "t": 分, "text": "字幕" }] }`（検証スクリプトの `captionSchema` を流用）
- ログにない時刻の字幕はコードで捨てる。40字を超えたものは警告を出す
- 下書き用モデルで作り、「清書」ボタンで清書用モデルに作り直させる

### 5-4. シナリオJSONの保存・読込
LLM の結果は1ファイルにまとめて保存する。保存した会戦の再生・書き出しには LLM を使わない。

```json
{
  "title": "後続温存・反応遅延",
  "params": { "Zin": 30, "Zback": 50, "place": "H2", "R": 40, "N0": 3, "G0": 24, "thr": 40 },
  "captions": [ { "t": 0, "text": "人類増援、妨害場外縁の外に出現" } ],
  "model": { "params": "qwen3:8b", "captions": "qwen3:30b-a3b" }
}
```

### 5-5. エラー時の扱い
- Ollama が起動していない・モデルが未取得: 画面に対処を出す（例「Ollama を起動してください」「`ollama pull qwen3:8b` を実行してください」）。手入力のパラメータ操作はそのまま使えるようにする
- JSON が壊れていた・範囲外: 1回だけ再試行し、だめなら元のパラメータのままにして知らせる
- 清書用モデルは読み込みに数十秒かかるので、処理中の表示を出す

### 5-6. ブラウザから直接 Ollama を呼ぶ場合
Studio にサーバがなく、ブラウザの画面から直接 `http://localhost:11434` を呼ぶ構成では、CORS エラーになることがある。その場合は次のどちらか。
- （推奨）Studio に小さなサーバ（Node など）を置き、サーバ経由で Ollama を呼ぶ
- 環境変数 `OLLAMA_ORIGINS` に Studio の配信元を設定して Ollama を再起動する（ユーザーに確認してから）

## 段階6: 組み込み後の検証

自分で確かめられること:
1. Studio のサーバ側の LLM 呼び出しを、Ollama を起動した状態で実際に呼んで、パラメータと字幕が返ること
2. Ollama を止めた状態で、エラー表示になり、手入力の操作は使えること
3. 範囲外の値（例 `G0: 999`）を渡したとき、コード側の範囲チェックで弾かれること

ユーザーに画面で確かめてもらうこと:
1. 依頼文を入れると、パラメータが変わり会戦が再計算される
2. 字幕が時刻どおりに出る。「清書」で文章が作り直される
3. シナリオを保存し、Ollama を止めた状態でも読込・再生できる

## 段階7: 結果の記録

検証結果を Studio のリポジトリに `docs/ローカルLLM検証結果.md`（置き場所は既存の構成に合わせてよい）として残す。

- 日付、OS、GPU ドライバのバージョン、Ollama のバージョン
- モデルごとの GPU 割合・速度（tok/s）・パラメータ正答数・字幕の結果（検証スクリプトの「まとめ（JSON）」を貼る）
- 字幕の文面の例と、ユーザーの評価
- 最終的に決めた `DRAFT_MODEL` / `FINAL_MODEL` とその理由
- 未解決の問題

## 参考
モデル選びの理由や、動画書き出し・VOICEVOX など今後の構想は `ローカルLLM導入_映像化Studio構想.md` にある。この作業には読まなくてよい。

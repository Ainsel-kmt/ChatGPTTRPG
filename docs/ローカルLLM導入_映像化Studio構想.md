# ローカルLLM導入と「会戦 映像化Studio」構想

2026-11-05 作成。対象は `Ainsel-kmt/claude` の `会戦ビュワー.html`（宇宙戦シミュレータ）を発展させた、ローカルで動く映像化Studio。

---

## 0. 結論（先に要点）

1. **LLMに映像を作らせない。** 映像は今の `simulate(p)` と Canvas 描画（コード）で作る。LLMの仕事は「文章 → パラメータJSON」と「ナレーション・字幕」の2つだけにする。これがトークン節約の一番の効き目で、ローカルの中型モデルでも十分こなせる。
2. **ローカルLLMは Ollama で入れる。** 1コマンドで入り、OpenAI互換API（`http://localhost:11434/v1`）が立つ。このリポジトリの `src/api.js` と同じ書き方で呼べる。
3. **Claude Code は「設計・難しい改修」だけに使う。** 毎回の会戦生成・字幕づくり・小さな修正はローカル側に回す。

| 仕事 | 担当 | 理由 |
|---|---|---|
| 会戦の計算・描画・動画書き出し | **コード**（LLMなし） | 決定的で毎回同じ結果。トークン0 |
| 「後続を温存して反応を遅らせた版」→ パラメータJSON | **ローカルLLM** | 短い構造化出力。中型モデルで足りる |
| ログからナレーション・字幕・見どころ解説を作る | **ローカルLLM** | 日本語の文章生成。何度回しても無料 |
| ナレーション音声 | **VOICEVOX**（ローカルTTS） | 無料・日本語に強い |
| Studioの骨組み・損耗モデルの改修・バグ調査 | **Claude Code** | ここは品質差が大きい。回数を絞って使う |
| UIの文言変更・色・小さなCSS修正 | **ローカルのコーディングエージェント** | 安い作業はローカルへ |

---

## 1. 導入（Ollama）

### 1-1. まず手元のPCを確認

ローカルLLMの速さと賢さは **GPUのVRAM（Macならユニファイドメモリ）** でほぼ決まる。

- Windows: タスクマネージャー → パフォーマンス → GPU → 「専用GPUメモリ」
- Mac: Appleメニュー → このMacについて → メモリ（M1以降なら全量がGPUに使える）

### 1-2. インストール

| OS | 手順 |
|---|---|
| Windows / Mac | https://ollama.com/download からインストーラを入れる |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` |

入ると常駐し、`http://localhost:11434` でAPIが待ち受ける。

### 1-3. モデルを選ぶ（目安）

モデル名は Ollama の公式ライブラリ（https://ollama.com/library）の表記。新しい版が頻繁に出るので、入れる前にライブラリで最新を確認すること。

| VRAM / メモリ | おすすめ | 用途 |
|---|---|---|
| 8GB 前後 | `qwen3:8b` | パラメータJSON化・短い字幕なら可 |
| 12〜16GB | `qwen3:14b` / `gemma3:12b` / `gpt-oss:20b` | **Studio用の本命ライン**。日本語ナレーションも実用 |
| 24GB / Mac 32GB以上 | `qwen3:30b-a3b`（MoEで速い）/ `qwen3-coder:30b` / `gemma3:27b` | ナレーション品質が上がる。コーディング補助もここから実用 |
| Mac 64GB以上 / 複数GPU | `gpt-oss:120b` など | Claude Code の代わりにかなりの作業を任せられる |

```bash
ollama pull qwen3:14b       # ダウンロード
ollama run qwen3:14b        # 対話で試す（/bye で終了）
ollama ps                   # 今どのモデルがどれだけメモリを使っているか
```

> GUIで試したい場合は **LM Studio**（https://lmstudio.ai）でもよい。こちらもOpenAI互換サーバ（既定 `http://localhost:1234/v1`）を立てられるので、下のコードはURLを変えるだけで動く。

### 1-4. 動作確認（API）

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen3:14b","messages":[{"role":"user","content":"ガード級24隻で敵ハブを攻撃する作戦を一文で"}]}'
```

---

## 2. ローカルLLMの使い方は3通り

### A. Studioの中から呼ぶ（本命）

Studioのサーバ（Node/Express）が Ollama を呼び、**JSONスキーマ付き**でパラメータを出させる。Ollama は `format` にJSONスキーマを渡すと、その形の出力に強制できるので、小さめのモデルでも壊れたJSONが出にくい。

```js
// studio/server/llm.js — ローカルLLMに「文章 → 会戦パラメータ」をやらせる
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL  = process.env.LOCAL_MODEL || 'qwen3:14b';

// 会戦ビュワーの params() と同じ項目
const paramSchema = {
  type: 'object',
  properties: {
    Zin:   { type: 'integer', minimum: 0,  maximum: 200, description: 'ザイレン H2在艦' },
    Zback: { type: 'integer', minimum: 0,  maximum: 300, description: 'ザイレン 後続' },
    place: { type: 'string',  enum: ['lane', 'H2'],      description: '後続の配置' },
    R:     { type: 'integer', minimum: 0,  maximum: 240, description: 'ザイレンの反応時間(分)' },
    N0:    { type: 'integer', minimum: 0,  maximum: 20,  description: '人類 ノード艦' },
    G0:    { type: 'integer', minimum: 0,  maximum: 200, description: '人類 ガード級' },
    thr:   { type: 'integer', minimum: 1,  maximum: 300, description: '展開が崩れる敵数' },
    title: { type: 'string', description: 'この会戦案の短い名前' }
  },
  required: ['Zin', 'Zback', 'place', 'R', 'N0', 'G0', 'thr', 'title']
};

async function textToParams(request, base) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: paramSchema,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content:
          'あなたは会戦シミュレータのパラメータ係。設定の議論はしない。' +
          '基準値から、依頼に必要な項目だけ変えたJSONを返す。' },
        { role: 'user', content: `基準値: ${JSON.stringify(base)}\n依頼: ${request}` }
      ]
    })
  });
  const data = await res.json();
  return JSON.parse(data.message.content);
}

module.exports = { textToParams };
```

ナレーションも同じ形で、`simulate(p)` が出す**イベントログ（時刻と出来事）だけ**を渡して書かせる。設定資料の全文を毎回渡さないことが、ローカルでも速さを保つコツ。

### B. ローカルのコーディングエージェントで小修正

Claude Code に頼むまでもない修正用。どれも Ollama につなげられる。

| ツール | 形 | 向き |
|---|---|---|
| **Aider** | ターミナル | 「このファイルのここを直して」型の小修正。git に自動コミット |
| **OpenCode** | ターミナル（Claude Codeに近い操作感） | 複数ファイルにまたがる軽作業 |
| **Continue / Cline** | VS Code 拡張 | エディタ上で補完・小修正 |

```bash
# 例: Aider を Ollama で使う
pip install aider-install && aider-install
aider --model ollama_chat/qwen3-coder:30b studio/web/render.js
```

コーディング用途は **30B級以上**（VRAM 24GB / Mac 32GB〜）でないと、手直しの手間のほうが大きくなりやすい。それ未満のPCなら、コード修正は Claude Code、ローカルは A（Studio内の文章仕事）に絞るのが現実的。

### C. Claude Code 自体をローカルモデルにつなぐ

Ollama（v0.14 以降）は Anthropic 互換APIも持っているので、Claude Code の接続先をローカルに向けられる。

```bash
export ANTHROPIC_BASE_URL=http://localhost:11434
export ANTHROPIC_AUTH_TOKEN=ollama
claude --model qwen3-coder:30b
```

操作はいつもの Claude Code のまま、トークン課金なしで動く。ただし賢さはモデル次第で、本物の Claude より計画の破綻・ツール呼び出しの失敗が増える。「小さな修正をローカル版で、詰まったら本物に切り替える」使い方がよい。対応状況は Ollama の更新で変わるので、使う前に Ollama のドキュメントで確認すること。

---

## 3. 映像化Studioの構成案

### 3-1. データの流れ

```
 ┌──────────────┐  文章で依頼   ┌───────────────┐
 │ Studio 画面   │ ───────────▶ │ ローカルLLM     │ → パラメータJSON
 │ (ブラウザ)    │              │ (Ollama)       │
 └──────┬───────┘              └───────────────┘
        │ パラメータ
        ▼
 ┌──────────────┐  フレーム列   ┌───────────────┐
 │ simulate(p)  │ ───────────▶ │ Canvas 描画     │ → 再生 / WebM書き出し
 │ (今のコード)  │              │ (カメラ・字幕)  │
 └──────┬───────┘              └───────────────┘
        │ イベントログ
        ▼
 ┌──────────────┐  字幕・台本   ┌───────────────┐
 │ ローカルLLM   │ ───────────▶ │ VOICEVOX       │ → ナレーション音声
 └──────────────┘              └───────────────┘
```

### 3-2. フォルダ構成案

```
studio/
  server/
    index.js        # Express。静的配信 + /api/params /api/narrate /api/tts
    llm.js          # Ollama 呼び出し（上のコード）
    tts.js          # VOICEVOX 呼び出し（任意）
  web/
    index.html      # Studio 画面
    sim.js          # 会戦ビュワーの simulate(p) を切り出したもの（中身は変えない）
    render.js       # 描画。カメラ（ズーム・追従）、字幕、タイムライン
    export.js       # canvas.captureStream() + MediaRecorder で WebM 書き出し
  scenarios/
    A_人類勝ち.json  # params + 字幕 + カメラ指定を1ファイルに保存
    B_ザイレン勝ち.json
```

`sim.js` は **今の `simulate(p)` をそのまま移す**。損耗モデルや数値の変更は引継ぎ資料のとおり、ユーザー確認なしには行わない。

### 3-3. 「シナリオファイル」を中心にする

LLMの出力は毎回この形のJSONにして保存する。保存すれば、同じ会戦の再生・書き出しにLLMはもう要らない。

```json
{
  "title": "後続温存・反応遅延",
  "params": { "Zin": 30, "Zback": 50, "place": "H2", "R": 40, "N0": 3, "G0": 24, "thr": 40 },
  "captions": [
    { "t": 0,  "text": "人類増援、妨害場外縁の外に出現。ロックタイム45分が始まる" },
    { "t": 45, "text": "ロックタイム明け。H2至近へ任意座標ジャンプ" }
  ],
  "camera": [
    { "t": 0,  "focus": "human", "zoom": 1.0 },
    { "t": 45, "focus": "H2",    "zoom": 2.5 }
  ]
}
```

### 3-4. 動画書き出し

- **手軽**: ブラウザだけで `canvas.captureStream(30)` → `MediaRecorder` で WebM を保存。外部ツール不要
- **高品質・MP4**: シミュレーション時刻を1フレームずつ進めて PNG を連番保存し、`ffmpeg -framerate 30 -i f%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4`。VOICEVOX の音声もここで合成する
- **任意**: 艦影や背景の絵が欲しくなったら ComfyUI（ローカル画像生成）で素材を作る。ただし VRAM を大きく使うので、LLMとは同時に動かさない

---

## 4. トークンを使わない運用のコツ

1. **Claude Code に渡すものを絞る。** 設定資料（`思考実験まとめ.md` など）を毎回読ませず、触るファイルだけ指定する。`00_引継ぎ.md` のような短い引継ぎを先頭に置く
2. **Claude Code の仕事は「骨組みを一度作る」こと。** Studio のフォルダ構成・`sim.js` の切り出し・書き出し機能までを Claude Code で作り、以降の会戦案づくりはローカルLLMで回す
3. **ローカルLLMには「ログ」だけ渡す。** シミュレーション全体ではなく、`simulate(p)` のイベントログ（数十行）を渡せば、14B級でも数秒で字幕が返る
4. **結果はJSONで保存して使い回す。** 気に入った会戦案は `scenarios/` に保存すれば、再生・書き出しにLLMは不要

---

## 5. 進め方（段階）

| 段階 | 内容 | 担当 |
|---|---|---|
| 0 | Ollama を入れて `qwen3:14b` などで日本語の質を試す | ユーザー（10分） |
| 1 | `会戦ビュワー.html` を `studio/web/` に分割（sim / render / UI）。見た目と結果は変えない | Claude Code |
| 2 | Express サーバと `/api/params`（文章 → パラメータ）を追加 | Claude Code |
| 3 | `/api/narrate`（ログ → 字幕）と字幕表示、シナリオJSONの保存・読込 | Claude Code またはローカルエージェント |
| 4 | カメラ演出（追従・ズーム）と WebM 書き出し | Claude Code |
| 5 | VOICEVOX でナレーション、ffmpeg で MP4 | ローカルエージェントでも可 |

段階1を始める前に、引継ぎ資料にある「見ててよくわからない」の中身（地図の見方／時間の動き／数値の意味／操作）を先に聞いておくと、Studio の画面設計にそのまま反映できる。

---

## 6. 注意

- ローカルLLMの日本語は 14B 級から実用、8B 級は字幕が不自然になりやすい。まず手元のPCで段階0を試してから、どこまでローカルに任せるか決める
- 損耗の数値は仮置き（引継ぎ資料どおり）。ローカルLLMに「それらしい数値」を作らせない。パラメータは JSON スキーマで範囲を縛り、モデル式は `sim.js` のコードだけが持つ
- 設定（思考実験）は「クローズ」済み。LLM のシステムプロンプトにも「設定の議論はしない」と入れておく

---

## 7. RTX 3060 Ti（VRAM 8GB）向けの具体案

2026-11-05 追記。Studio 本体はすでにローカルの Claude Code セッションで作成中なので、ここでは「そこにローカルLLMをどう足すか」に絞る。

### 7-1. 8GB で現実的にできること

| 用途 | 判定 | 使うモデル |
|---|---|---|
| 文章 → パラメータJSON | ◎ | `qwen3:8b`（約5GB、全部GPUに載る） |
| ログ → 字幕・短いナレーション | ○ | `qwen3:8b`。不自然なら下の「はみ出し運用」 |
| 長めの台本・見どころ解説 | △ | `qwen3:30b-a3b` か `gpt-oss:20b` をはみ出し運用 |
| コード修正（Aider など） | × | 8GB では手直しの手間が勝つ。**コードは Claude Code のまま** |

### 7-2. 基本形: `qwen3:8b` を常用

```bash
ollama pull qwen3:8b
```

- パラメータ変換のような短い仕事では、考える過程の出力（thinking）を切ると数倍速くなる。API に `"think": false` を付ける

```js
body: JSON.stringify({
  model: 'qwen3:8b',
  think: false,          // JSON化・字幕では考える過程を出さない
  stream: false,
  format: paramSchema,
  options: { temperature: 0.2, num_ctx: 8192 },
  messages
})
```

- 入力は短く保つ。設定資料の全文ではなく、イベントログと基準パラメータだけを渡す。`num_ctx` を大きくするとVRAMを食い、GPUからはみ出して遅くなる

### 7-3. はみ出し運用: 大きいモデルを CPU と分け合う

Ollama は、VRAM に入りきらないモデルの残りをメインメモリ（RAM）に置いて動かせる。`qwen3:30b-a3b` と `gpt-oss:20b` は、一度に使う部分が小さい作り（MoE）なので、はみ出しても比較的速い。

- 条件: **メインメモリ 32GB 以上**が目安（16GB だと `gpt-oss:20b` がぎりぎり）
- 速さ: 全部GPUに載る `qwen3:8b` よりかなり遅い。字幕を一括で作ってファイル保存する「待てる仕事」に向く
- `ollama ps` の PROCESSOR 欄で、GPU と CPU の割合を確認できる

```bash
ollama pull qwen3:30b-a3b   # 約19GB。RAM 32GB 以上なら試す価値あり
```

### 7-4. 同時に動かさないもの

- LLM と ComfyUI（画像生成）は VRAM を取り合うので同時に使わない
- VOICEVOX は CPU 版で十分。GPU 版を使うなら、LLM の処理が終わってから音声化する
- 動画書き出し（ブラウザの Canvas 録画）は軽いので、LLM と同時でも問題ない

### 7-5. 作成中の Studio への組み込み方

Studio はローカルの Claude Code セッションで作っているので、そのセッションに次のように頼めば一度で入る（以降の会戦案づくりはトークンを使わない）。

> Studio にローカルLLM（Ollama, `http://localhost:11434`, モデル `qwen3:8b`）の呼び出しを追加して。
> 1. 文章の依頼 → `params()` と同じ項目のJSON（`/api/chat` の `format` にJSONスキーマ、`think:false`）
> 2. `simulate(p)` のイベントログ → 時刻付き字幕のJSON
> 3. 結果は params・字幕をまとめてシナリオJSONとして保存・読込できるように
> モデル名とURLは設定で変えられるようにして。損耗モデルと数値は変えないこと。

### 7-6. Claude Code 側の節約

ローカルLLMに回せない「コードの仕事」は、Claude Code の使い方で減らす。

- Studio の構成・守ること・ファイルの役割を `CLAUDE.md` に短く書いておき、毎回説明し直さない
- 作業の区切りで `/clear` して、長い会話を引きずらない
- 「`render.js` の字幕表示だけ直して」のように、触るファイルを指定して頼む
- 文言・色の変更のような軽い作業は、`/model` で軽いモデルに切り替えて頼む

### 7-7. 確定構成（RTX 3060 Ti 8GB + メインメモリ 32GB）

2026-11-05 追記。メインメモリ 32GB なので、7-3 のはみ出し運用が使える。

| 役割 | モデル | 置き場所 | 用途 |
|---|---|---|---|
| 普段使い | `qwen3:8b` | 全部GPU | パラメータJSON・短い字幕（数秒で返る） |
| 清書用 | `qwen3:30b-a3b` | GPU 8GB + RAM 約11GB | ナレーション台本・見どころ解説を一括生成 |
| 予備 | `gpt-oss:20b` | GPU 8GB + RAM 約6GB | 30b-a3b が重いときの代わり（メモリに余裕） |

```bash
ollama pull qwen3:8b
ollama pull qwen3:30b-a3b
ollama run qwen3:30b-a3b --verbose   # 回答後に eval rate（1秒あたりのトークン数）が出る
```

- `eval rate` が 10 tokens/s 前後出れば、字幕の一括生成には十分。5 を切るならブラウザのタブを減らすか、`gpt-oss:20b` に替える
- 30b-a3b を動かすとメインメモリを 20GB 近く使う。Chrome のタブが多いと足りなくなるので、清書の間は重いアプリを閉じる
- 8b と 30b-a3b は同時に VRAM に載らない。切り替えのたびに読み込みで数十秒かかるので、「普段は 8b、最後にまとめて 30b-a3b で清書」と分ける
- Studio 側では、モデル名を「下書き用」「清書用」の2つの設定項目にしておくと切り替えが楽

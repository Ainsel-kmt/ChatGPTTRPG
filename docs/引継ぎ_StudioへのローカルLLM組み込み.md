# 引継ぎ: 映像化StudioへのローカルLLM組み込み

## 目的
作成中の映像化Studio（会戦ビュワー `simulate(p)` を発展させたもの）に、ローカルLLM（Ollama）の呼び出しを追加する。
会戦案づくりと字幕づくりをローカルLLMに任せ、Claude Code のトークン消費を減らすのが狙い。会話は日本語。

## 守ること
- **損耗モデル・数値・`simulate(p)` の中身は変えない。** LLM はパラメータを選ぶだけで、計算はコードだけが行う
- **設定（思考実験）は再議論しない。** LLM のシステムプロンプトにも「設定の議論はしない」と入れる
- **既存の Studio の構成・書き方に合わせる。** 下の設計は目安で、ファイル名や置き場所は今のコードに合わせてよい
- **表示確認はユーザーに頼む。**

## 環境
- GPU: RTX 3060 Ti（VRAM 8GB）／メインメモリ 32GB
- Ollama: `http://localhost:11434`（ネイティブAPI `/api/chat` を使う）
- モデルは2つを設定で切り替える
  - 下書き用: `qwen3:8b`（全部GPUに載る。速い）
  - 清書用: `qwen3:30b-a3b`（一部をメインメモリに置く。遅いが文章が良い）。予備は `gpt-oss:20b`
- 2つのモデルは同時にVRAMに載らない。切り替えると読み込みに数十秒かかる

## 作るもの

### 1. 設定
- `OLLAMA_URL`（既定 `http://localhost:11434`）
- `DRAFT_MODEL`（既定 `qwen3:8b`）
- `FINAL_MODEL`（既定 `qwen3:30b-a3b`）
- 画面からも下書き用／清書用を選べるようにする

### 2. 文章 → パラメータJSON
- 入力: ユーザーの依頼文（例「後続をH2に温存して、反応を40分に遅らせた版」）と、現在のパラメータ
- 出力: `params()` と同じ項目のJSON ＋ `title`（会戦案の短い名前）
- Ollama の `format` に JSONスキーマを渡して出力の形を強制する。各項目に `minimum` / `maximum` / `enum` を付けて範囲を縛る
- 返ってきた値はコード側でもう一度範囲チェックしてから `simulate(p)` に渡す
- `kz` `q` `loss` `ward` `lockDur` などの内部定数は LLM に触らせない（スキーマに入れない）

```js
const res = await fetch(`${OLLAMA_URL}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: DRAFT_MODEL,
    think: false,             // 短い仕事では考える過程を出さない（数倍速い）
    stream: false,
    format: paramSchema,      // JSONスキーマ
    options: { temperature: 0.2, num_ctx: 8192 },
    messages: [
      { role: 'system', content: 'あなたは会戦シミュレータのパラメータ係。設定の議論はしない。基準値から、依頼に必要な項目だけ変えたJSONを返す。' },
      { role: 'user', content: `基準値: ${JSON.stringify(base)}\n依頼: ${request}` }
    ]
  })
});
const params = JSON.parse((await res.json()).message.content);
```

### 3. イベントログ → 時刻付き字幕
- 入力: `simulate(p)` の結果のうち、**イベントログ（時刻と出来事）と結果だけ**。設定資料の全文は渡さない（VRAMからはみ出して遅くなる）
- 出力: `[{ "t": 分, "text": "字幕" }]` の配列（これも `format` で形を強制）
- 字幕は1つ40字程度まで。ログにない出来事や数値を作らせない
- 下書き用モデルで作り、「清書」ボタンで清書用モデルに作り直させる

### 4. シナリオJSONの保存・読込
LLM の結果は1ファイルにまとめて保存する。保存した会戦の再生・書き出しには LLM を使わない。

```json
{
  "title": "後続温存・反応遅延",
  "params": { "Zin": 30, "Zback": 50, "place": "H2", "R": 40, "N0": 3, "G0": 24, "thr": 40 },
  "captions": [ { "t": 0, "text": "人類増援、妨害場外縁の外に出現" } ],
  "model": { "params": "qwen3:8b", "captions": "qwen3:30b-a3b" }
}
```

### 5. エラー時の扱い
- Ollama が起動していない・モデルが未取得: 画面に「`ollama pull qwen3:8b` を実行してください」のように対処を出す。手入力のパラメータ操作はそのまま使えるようにする
- JSON が壊れていた・範囲外: 1回だけ再試行し、だめなら元のパラメータのままにして知らせる

## 完了の確認（ユーザーに頼む）
1. `ollama pull qwen3:8b` と `ollama pull qwen3:30b-a3b` を済ませる
2. 依頼文を入れて、パラメータが変わり会戦が再計算される
3. 字幕が時刻どおりに出る。「清書」で文章が作り直される
4. シナリオを保存し、Ollama を止めた状態でも読込・再生できる

## 参考
詳しい背景（モデル選びの理由、動画書き出し、VOICEVOX など）は `ローカルLLM導入_映像化Studio構想.md` にある。この作業には読まなくてよい。

const express = require('express');
const path = require('path');

const app = express();
const port = 3000;
app.use(express.json());  // 追加

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, '..', 'public')));

// APIルート
const apiRouter = require('./api');
app.use('/api', apiRouter);

// 初期ページをシナリオ作成ページに設定
app.get('/', (req, res) => {
    res.redirect('/scenario');
});

// シナリオ作成ページ
app.get('/scenario', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'scenario.html'));
});

// キャラクターシート作成ページ
app.get('/character', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'character.html'));
});

// ゲーム画面
app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

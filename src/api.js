const express = require('express');
const axios = require('axios');
require('dotenv').config();
const router = express.Router();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
console.log('Using OpenAI API Key:', OPENAI_API_KEY);


router.post('/chat', async (req, res) => {
  const { message, scenario, initial,character, history = [{ role: 'user', content: message }] } = req.body;

  const messages = [
    { role: 'system', content: `次の{}の中の文章を逸脱しないようにゲーム進めよ。
      {プレイヤーがなにか行動や技能を使おうとした際には、ダイスロールをして、その結果と履歴をふまえてシナリオの進行を決めろ
      (この時userにダイスロールを求めないこと)
      その際に何面のダイスを用いて、出た値、成功値をいくつなのかも教えてください。能力値をつかうダイスロールの場合は1d20を使用しろ。
      CON（体力）が0になったらゲームは終了。
      戦闘が起きた場合こちらが攻撃した後は必ず相手も反撃するように。
      }` },
    ...history,
    { role: 'user', content: `キャラクター情報: ${JSON.stringify(character)}` },
    { role: 'user', content: message }
  ];

  if (initial && scenario) {
    messages.splice(1, 0, { role: 'system', content: `あなたはTRPGのゲームマスターです。シナリオをもとにプレイヤーと対話してストーリーを進めてください。シナリオ: ${scenario}` });
  }


  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: messages,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const reply = response.data.choices[0]?.message?.content || 'No response from API';
    res.json({ reply });
  } catch (error) {
    console.error('Error communicating with OpenAI API:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/create-scenario', async (req, res) => {
  const { title, description } = req.body;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'あなたはTRPGシナリオジェネレータです。以下のtitleとdescriptionをもとに、TRPGシナリオの導入を作成して。'
          },
          {
            role: 'user',
            content: `Title: ${title}\nDescription: ${description}\n\nScenario:`
          }
        ],
        max_tokens: 500,
        temperature: 0.7,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    const scenario = response.data.choices[0]?.message?.content?.trim() || 'No content received from API';
    res.json({ scenario });
  } catch (error) {
    console.error('Error creating scenario:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Failed to create scenario' });
  }
});

module.exports = router;

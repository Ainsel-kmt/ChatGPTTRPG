document.addEventListener('DOMContentLoaded', () => {
    const sendButton = document.getElementById('send-button');
    const userInput = document.getElementById('user-input');
    const messages = document.getElementById('messages');
    const characterSheetButton = document.getElementById('character-sheet-button');
    const scenarioButton = document.getElementById('scenario-button');
    const scenarioDisplay = document.getElementById('scenario-display');
    const characterDisplay = document.getElementById('character-display');
    let initial = true; // シナリオが最初に送信されたかどうかを追跡するフラグ
    let history = []; // 履歴を保持するための配列

    // ローカルストレージからシナリオとキャラクターを取得して表示
    const storedScenario = localStorage.getItem('scenario');
    const storedCharacter = localStorage.getItem('character');

    if (storedScenario) {
        scenarioDisplay.innerHTML = `<h2>シナリオ</h2><p>${storedScenario}</p>`;
    }

    if (storedCharacter) {
        const character = JSON.parse(storedCharacter);
        characterDisplay.innerHTML = `
            <h2>キャラクターシート</h2>
            <p><strong>名前:</strong> ${character.name}</p>
            <p><strong>性別:</strong> ${character.gender}</p>
            <p><strong>年齢:</strong> ${character.age}</p>
            <p><strong>職業:</strong> ${character.occupation}</p>
            <h3>技能</h3>
            ${character.skills.map(skill => `<p><strong>${skill.name}:</strong> ${skill.points}</p>`).join('')}
            <h3>能力値</h3>
            ${Object.entries(character.abilityScores || {}).map(([ability, score]) => `<p><strong>${ability}:</strong> ${score}</p>`).join('')}
            <h3>バックストーリー</h3>
            <p>${character.backstory}</p>
            <h3>装備</h3>
            <p>${character.equipment}</p>
        `;
    }

    

    sendButton.addEventListener('click', async () => {

        const message = userInput.value;
        if (message.trim()) {
            appendMessage(`You: ${message}`);
            userInput.value = '';
            const scenario = storedScenario || '';
            const character = storedCharacter || '';

            history.push({ role: 'user', content: message }); // メッセージ履歴に追加
            console.log('Sending history:', ...history); // 送信前に履歴を表示

            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message, scenario, character, initial })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Server response wasn't OK: ${errorText}`);
                }

                const data = await response.json();
                const reply = data.reply || 'No response from API';
                appendMessage(`GPT: ${reply}`);
                history.push({ role: 'assistant', content: reply }); // メッセージ履歴に追加
                console.log('Sending history:', history); // 送信前に履歴を表示

                if (initial) {
                    initial = false; // シナリオ送信フラグをリセット
                }
            } catch (error) {
                console.error('Error:', error);
                appendMessage('サーバーとの通信にエラーが発生しました。');
            }
        }
    });

    function appendMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.innerHTML = message; // innerHTMLを使用して修飾を受け入れる
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
    }

    // カスタムダイスロール機能の実装
    const customRollButton = document.getElementById('custom-roll-button');
    const customDiceInput = document.getElementById('custom-dice-input');
    const diceResult = document.getElementById('dice-result');

    customRollButton.addEventListener('click', () => {
        const customDice = customDiceInput.value;
        if (customDice && customDice > 0) {
            const result = Math.floor(Math.random() * customDice) + 1;
            diceResult.textContent = `You rolled a d${customDice}: ${result}`;
        } else {
            diceResult.textContent = 'Please enter a valid dice number.';
        }
    });

    // キャラクターシート作成画面への遷移
    characterSheetButton.addEventListener('click', () => {
        window.location.href = '/character';
    });

    // シナリオ作成ページへの遷移
    scenarioButton.addEventListener('click', () => {
        history = []; // シナリオ作成ページへの遷移時に履歴をクリア
        window.location.href = '/scenario';
    });
});

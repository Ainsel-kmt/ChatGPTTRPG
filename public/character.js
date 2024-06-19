document.addEventListener('DOMContentLoaded', () => {
    const characterForm = document.getElementById('character-form');
    const characterDisplay = document.getElementById('character-display');
    const saveCharacterButton = document.getElementById('save-character');
    const backToGameButton = document.getElementById('back-to-game');

    window.rollAbilityScores = function () {
        const abilityScoresDiv = document.getElementById('ability-scores');
        const abilities = ['STR（筋力）', 'DEX（敏捷性）', 'CON（体力）', 'INT（知力）', 'POW（精神力）', 'APP（外見）', 'SIZ（体格）', 'EDU（教育）'];
        let scores = '';
        abilities.forEach(ability => {
            const score = Math.floor(Math.random() * 16) + 3; // 3～18のランダムな数値
            scores += `<p>${ability}: ${score}</p>`;
        });
        abilityScoresDiv.innerHTML = scores;
    };

    saveCharacterButton.addEventListener('click', () => {
        const name = document.getElementById('character-name').value;
        const gender = document.getElementById('character-gender').value;
        const age = document.getElementById('character-age').value;
        const occupation = document.getElementById('character-occupation').value;
        const skill1 = document.getElementById('skill-1').value;
        const skill1Points = document.getElementById('skill-1-points').value;
        const skill2 = document.getElementById('skill-2').value;
        const skill2Points = document.getElementById('skill-2-points').value;
        const backstory = document.getElementById('character-backstory').value;
        const equipment = document.getElementById('character-equipment').value;

        const abilityScoresDiv = document.getElementById('ability-scores');
        const abilityScores = {};
        abilityScoresDiv.querySelectorAll('p').forEach(p => {
            const [ability, score] = p.textContent.split(': ');
            abilityScores[ability] = parseInt(score);
        });

        const character = {
            name,
            gender,
            age,
            occupation,
            skills: [
                { name: skill1, points: skill1Points },
                { name: skill2, points: skill2Points }
            ],
            abilityScores,
            backstory,
            equipment
        };

        localStorage.setItem('character', JSON.stringify(character));

        // 保存されたキャラクター情報を表示
        characterDisplay.innerHTML = `
            <h3>キャラクター情報</h3>
            <p>名前: ${character.name}</p>
            <p>性別: ${character.gender}</p>
            <p>年齢: ${character.age}</p>
            <p>職業: ${character.occupation}</p>
            <p>技能:</p>
            <ul>
              ${character.skills.map(skill => `<li>${skill.name}: ${skill.points}ポイント</li>`).join('')}
            </ul>
            <p>能力値:</p>
            <ul>
              ${Object.entries(character.abilityScores).map(([ability, score]) => `<li>${ability}: ${score}</li>`).join('')}
            </ul>
            <p>バックストーリー: ${character.backstory}</p>
            <p>装備: ${character.equipment}</p>
        `;
    });

    // ゲーム画面に戻る
    backToGameButton.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
});

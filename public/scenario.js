document.addEventListener('DOMContentLoaded', () => {
    const createScenarioButton = document.getElementById('create-scenario');

    createScenarioButton.addEventListener('click', async () => {
        const title = document.getElementById('scenario-title').value;
        const description = document.getElementById('scenario-description').value;

        if (title && description) {
            try {
                const response = await fetch('/api/create-scenario', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ title, description })
                });

                if (response.ok) {
                    const data = await response.json();
                    localStorage.setItem('scenario', data.scenario); 
                    window.location.href = '/character';
                } else {
                    console.error('Failed to create scenario:', response.statusText);
                }
            } catch (error) {
                console.error('Error creating scenario:', error);
            }
        }
    });
});

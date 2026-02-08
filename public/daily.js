import { SwiftleGame } from './game-core.js';

document.addEventListener('DOMContentLoaded', () => {
    window.game = new SwiftleGame('daily');

    window.game.checkGameAvailability().then((available) => {
        if (!available) {
            window.game.showError('Game server is not available. Please try again later.');
        }
    });
});

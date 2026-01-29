let score = 0;
let activeCircle = null;
let catColor = generateRandomCatColor(); // Generate random color on page load
let playerName = generateRandomPlayerName(); // Generate random name on page load

// Fun random name generator
function generateRandomPlayerName() {
  const adjectives = ['Swift', 'Mighty', 'Clever', 'Brave', 'Silent', 'Golden', 'Epic', 'Cosmic', 'Cyber', 'Mystic', 'Thunder', 'Shadow', 'Frost', 'Blaze', 'Storm', 'Stellar', 'Quantum', 'Neon', 'Turbo', 'Ultra'];
  const nouns = ['Cat', 'Tiger', 'Dragon', 'Phoenix', 'Ninja', 'Knight', 'Wizard', 'Hunter', 'Warrior', 'Legend', 'Hero', 'Champion', 'Master', 'Ace', 'Star', 'Coder', 'Hacker', 'Gamer', 'Pro', 'Boss'];
  const numbers = Math.floor(Math.random() * 999) + 1;
  
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${adj}${noun}${numbers}`;
}

function generateRandomCatColor() {
  const colors = [
    '#8783d1ff', // Original tropical indigo
    '#ff6b6b', // Coral red
    '#4ecdc4', // Teal
    '#45b7d1', // Sky blue
    '#96ceb4', // Mint green
    '#ffeaa7', // Warm yellow
    '#dda0dd', // Plum
    '#98d8c8', // Seafoam
    '#f7dc6f', // Golden yellow
    '#bb8fce', // Lavender
    '#85c1e9', // Light blue
    '#82e0aa'  // Light green
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function updateScore() {
  document.getElementById('score').textContent = score;
  updateCat();
}

function updateCat() {
  const cat = document.getElementById('websiteCat');
  const catContainer = cat.querySelector('.cat-container');
  
  // Remove all stage classes
  catContainer.className = 'cat-container';
  
  // Apply random cat color to all cat parts
  applyCatColor(cat, catColor);
  
  // Evolution happens every 2 clicks now! Much easier!
  const evolutionStage = Math.floor(score / 2);
  
  if (evolutionStage >= 1) {
    catContainer.classList.add('cat-stage-1'); // Ears appear at 2 clicks
    cat.title = "I have ears now! Keep clicking!";
  }
  if (evolutionStage >= 2) {
    catContainer.classList.add('cat-stage-2'); // Eyes at 4 clicks
    cat.title = "I can see you now! 👀";
  }
  if (evolutionStage >= 3) {
    catContainer.classList.add('cat-stage-3'); // Nose at 6 clicks
    cat.title = "I can smell those circles! 🐱";
  }
  if (evolutionStage >= 4) {
    catContainer.classList.add('cat-stage-4'); // Whiskers at 8 clicks
    cat.title = "Look at my whiskers! 😸";
  }
  if (evolutionStage >= 5) {
    catContainer.classList.add('cat-stage-5'); // Tail at 10 clicks
    cat.title = "I have a tail now! 🐾";
  }
  if (evolutionStage >= 6) {
    catContainer.classList.add('cat-stage-6'); // Spots at 12 clicks
    cat.title = "Look at my beautiful spots! ✨";
  }
  if (evolutionStage >= 7) {
    catContainer.classList.add('cat-stage-7'); // Crown at 14 clicks
    cat.title = "I'm the king/queen of cats! 👑";
  }
  if (evolutionStage >= 8) {
    catContainer.classList.add('cat-stage-8'); // Wings at 16 clicks
    cat.title = "I can fly now! I'm a magical cat! 🦋";
  }
  if (evolutionStage >= 9) {
    catContainer.classList.add('cat-stage-9'); // Sparkles at 18 clicks
    cat.title = "I'm sparkling with magic! ✨🌟";
  }
  if (evolutionStage >= 10) {
    catContainer.classList.add('cat-stage-10'); // Rainbow aura at 20 clicks
    cat.title = "I'm the ultimate rainbow cat! 🌈😻 Maximum evolution reached!";
  }
}

function applyCatColor(cat, color) {
  const catBody = cat.querySelector('.cat-body');
  const catHead = cat.querySelector('.cat-head');
  const catEars = cat.querySelectorAll('.cat-ear-left, .cat-ear-right');
  const catTail = cat.querySelector('.cat-tail');
  
  if (catBody) catBody.style.background = color;
  if (catHead) catHead.style.background = color;
  if (catTail) catTail.style.background = color;
  catEars.forEach(ear => {
    ear.style.borderBottomColor = color;
  });
}

function getCircleSize() {
  const width = window.innerWidth;
  if (width <= 500) return 'circle-small';
  if (width <= 800) return 'circle-medium';
  return 'circle-large';
}

function createRandomCircle() {
  // Remove existing circle if any
  if (activeCircle) {
    activeCircle.remove();
  }

  const circle = document.createElement('div');
  circle.className = `game-circle ${getCircleSize()}`;
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Determine circle size based on screen width
  let circleSize;
  if (window.innerWidth <= 500) {
    circleSize = 40;
  } else if (window.innerWidth <= 800) {
    circleSize = 60;
  } else {
    circleSize = 80;
  }
  
  // Random position (avoiding edges, navbar, and cat area)
  const maxX = viewportWidth - circleSize - 20;
  const maxY = viewportHeight - circleSize - 20;
  const minY = 80; // Account for navbar height
  const catArea = 100; // Avoid bottom-left corner where cat is
  
  let randomX, randomY;
  do {
    randomX = Math.random() * (maxX - 20) + 20;
    randomY = Math.random() * (maxY - minY) + minY;
  } while (randomX < catArea && randomY > viewportHeight - catArea); // Avoid cat area
  
  circle.style.left = randomX + 'px';
  circle.style.top = randomY + 'px';
  
  circle.addEventListener('click', function() {
    score++;
    updateScore();
    
    // Add clicked animation
    circle.classList.add('clicked');
    
    // Cat celebration animation on milestone clicks (every 2 clicks now!)
    if (score % 2 === 0) {
      const cat = document.getElementById('websiteCat');
      cat.style.transform = 'scale(1.2)';
      setTimeout(() => {
        cat.style.transform = 'scale(1)';
      }, 500);
    }
    
    // Remove circle after animation and create new one
    setTimeout(() => {
      circle.remove();
      activeCircle = null;
      // Create new circle after a short delay
      setTimeout(createRandomCircle, Math.random() * 2000 + 1000); // 1-3 seconds
    }, 400);
  });
  
  document.body.appendChild(circle);
  activeCircle = circle;
}

// Start the game
function startCircleGame() {
  // Initial circle
  setTimeout(createRandomCircle, 2000);
}

// Handle window resize
window.addEventListener('resize', function() {
  if (activeCircle) {
    activeCircle.className = `game-circle ${getCircleSize()}`;
  }
});

// Cat click interaction
document.addEventListener('DOMContentLoaded', function() {
  startCircleGame();
  
  // Initialize cat with random color
  const cat = document.getElementById('websiteCat');
  applyCatColor(cat, catColor);
  
  // Add click event to cat for fun interaction
  cat.addEventListener('click', function() {
    // Cat bounce animation
    cat.style.transform = 'scale(1.1) translateY(-10px)';
    setTimeout(() => {
      cat.style.transform = 'scale(1)';
    }, 200);
    
    // Show encouragement message based on current stage
    const messages = [
      "Meow! Click the circles to help me grow! 🐱",
      "I'm starting to grow! Keep going! 😺",
      "Look at my beautiful ears! 👂",
      "Now I can see you! Keep clicking! 👀",
      "I can smell success! Almost there! 👃",
      "Check out my whiskers! 😸",
      "I have a tail now! 🐾",
      "Look at my spots! ✨",
      "I'm royalty now! 👑",
      "I'm a flying cat! 🦋",
      "I'm magical and sparkling! ✨🌟",
      "I'm the ultimate rainbow cat! 🌈😻"
    ];
    
    const stage = Math.min(Math.floor(score / 2), 11);
    console.log(messages[stage]);
  });
  
  // Initialize leaderboard
  initializeLeaderboard();
});

// ===== LEADERBOARD FUNCTIONALITY =====

function initializeLeaderboard() {
  const scoreDisplay = document.getElementById('scoreDisplay');
  const leaderboardDropdown = document.getElementById('leaderboardDropdown');
  const closeLeaderboard = document.getElementById('closeLeaderboard');
  const saveScoreBtn = document.getElementById('saveScore');
  const playerNameInput = document.getElementById('playerName');
  
  // Set random name as placeholder
  playerNameInput.placeholder = `e.g., ${playerName}`;
  
  // Toggle leaderboard on score click
  scoreDisplay.addEventListener('click', function(e) {
    e.stopPropagation();
    leaderboardDropdown.classList.toggle('active');
    loadLeaderboard();
  });
  
  // Close leaderboard
  closeLeaderboard.addEventListener('click', function(e) {
    e.stopPropagation();
    leaderboardDropdown.classList.remove('active');
  });
  
  // Close when clicking outside
  document.addEventListener('click', function(e) {
    if (!leaderboardDropdown.contains(e.target) && !scoreDisplay.contains(e.target)) {
      leaderboardDropdown.classList.remove('active');
    }
  });
  
  // Save score
  saveScoreBtn.addEventListener('click', function() {
    savePlayerScore();
  });
  
  // Allow Enter key to save
  playerNameInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      savePlayerScore();
    }
  });
}

function savePlayerScore() {
  const playerNameInput = document.getElementById('playerName');
  let name = playerNameInput.value.trim();
  
  // Use random name if empty
  if (!name) {
    name = playerName;
  }
  
  // Validate name length
  if (name.length > 20) {
    name = name.substring(0, 20);
  }
  
  if (score === 0) {
    showToast('Score some points first! Click the circles! 🎯', 'warning');
    return;
  }
  
  // Get existing leaderboard from localStorage
  let leaderboard = JSON.parse(localStorage.getItem('catGameLeaderboard') || '[]');
  
  // Add new entry
  leaderboard.push({
    name: name,
    score: score,
    date: new Date().toISOString()
  });
  
  // Sort by score descending
  leaderboard.sort((a, b) => b.score - a.score);
  
  // Keep top 50 scores
  leaderboard = leaderboard.slice(0, 50);
  
  // Save to localStorage
  localStorage.setItem('catGameLeaderboard', JSON.stringify(leaderboard));
  
  // Show success message
  showToast(`🎉 Score saved! ${name}: ${score} points`, 'success');
  
  // Reload leaderboard display
  loadLeaderboard();
  
  // Clear input
  playerNameInput.value = '';
  
  // Generate new random name for next time
  playerName = generateRandomPlayerName();
  playerNameInput.placeholder = `e.g., ${playerName}`;
}

function loadLeaderboard() {
  const leaderboardList = document.getElementById('leaderboardList');
  const leaderboard = JSON.parse(localStorage.getItem('catGameLeaderboard') || '[]');
  
  if (leaderboard.length === 0) {
    leaderboardList.innerHTML = '<p class="no-scores">No scores yet. Be the first!</p>';
    return;
  }
  
  // Create HTML for leaderboard entries
  let html = '';
  leaderboard.forEach((entry, index) => {
    const rank = index + 1;
    let topClass = '';
    let medal = '';
    
    if (rank === 1) {
      topClass = 'top-1';
      medal = '🥇 ';
    } else if (rank === 2) {
      topClass = 'top-2';
      medal = '🥈 ';
    } else if (rank === 3) {
      topClass = 'top-3';
      medal = '🥉 ';
    }
    
    html += `
      <div class="leaderboard-entry ${topClass}">
        <span class="entry-rank">${medal}${rank}</span>
        <span class="entry-name">${escapeHtml(entry.name)}</span>
        <span class="entry-score">${entry.score}</span>
      </div>
    `;
  });
  
  leaderboardList.innerHTML = html;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Toast notification function
function showToast(message, type = 'success') {
  // Create toast container if it doesn't exist
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  
  // Create toast element
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // Add to container
  toastContainer.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);
  
  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}

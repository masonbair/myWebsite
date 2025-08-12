let score = 0;
let activeCircle = null;

function updateScore() {
  document.getElementById('score').textContent = score;
  updateCat();
}

function updateCat() {
  const cat = document.getElementById('websiteCat');
  const catContainer = cat.querySelector('.cat-container');
  
  // Remove all stage classes
  catContainer.className = 'cat-container';
  
  // Add appropriate stage class based on score
  if (score >= 5 && score < 10) {
    catContainer.classList.add('cat-stage-1'); // Ears appear
    cat.title = "I have ears now! Keep clicking!";
  } else if (score >= 10 && score < 15) {
    catContainer.classList.add('cat-stage-1', 'cat-stage-2'); // Ears + Eyes
    cat.title = "I can see you now! 👀";
  } else if (score >= 15 && score < 20) {
    catContainer.classList.add('cat-stage-1', 'cat-stage-2', 'cat-stage-3'); // Ears + Eyes + Nose
    cat.title = "I can smell those circles! 🐱";
  } else if (score >= 20) {
    catContainer.classList.add('cat-stage-1', 'cat-stage-2', 'cat-stage-3', 'cat-stage-4'); // Full cat
    cat.title = "I'm fully evolved! Thanks for playing! 😸";
    
    // Add tail animation for fully evolved cat
    const tail = cat.querySelector('.cat-tail');
    tail.style.opacity = '1';
  }
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
    
    // Cat celebration animation on milestone clicks
    if (score === 5 || score === 10 || score === 15 || score === 20) {
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
  
  // Add click event to cat for fun interaction
  const cat = document.getElementById('websiteCat');
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
      "I'm fully evolved! Thanks for playing! 😸"
    ];
    
    const stage = Math.min(Math.floor(score / 5), 5);
    console.log(messages[stage]);
  });
});

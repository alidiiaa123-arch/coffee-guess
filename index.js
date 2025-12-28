import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove, update, increment, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 🔴 تأكد إن بياناتك هنا مظبوطة زي ما كانت
const firebaseConfig = {
    apiKey: "AIzaSyCw9YuyXWAZLjuyhh8HyuqcTof-alEByiI",
    authDomain: "coffee-guess.firebaseapp.com",
    databaseURL: "https://coffee-guess-default-rtdb.firebaseio.com", 
    projectId: "coffee-guess",
    storageBucket: "coffee-guess.firebasestorage.app",
    messagingSenderId: "594892061994",
    appId: "1:594892061994:web:814a87a35981a8414af253"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Global Variables ---
let gameState = {
    active: false,
    hasGuessed: false,
    secret: "",
    digits: 4
};
let myName = localStorage.getItem('coffee_user') || "";
let timerInterval = null;

// --- 1. التجهيز عند فتح الموقع ---
// لو الاسم موجود، خليه يدخل.. لو مش موجود يظهره شاشة الاسم
if (myName) {
    document.getElementById('usernameInput').value = myName;
    document.getElementById('loginScreen').style.display = 'none';
    // هنظهر شاشة الانتظار مؤقتاً لحد ما الفايربيس يقولنا إحنا فين
    document.getElementById('setupScreen').style.display = 'none'; 
    createWaitingScreen().style.display = 'block';
}

// --- 2. الرادار (مراقبة حالة اللعبة) ---
// ده أهم جزء: بيشوف لو فيه لعبة شغالة يخفيك الإعدادات ويدخلك اللعب علطول
onValue(ref(db, 'gameState'), (snapshot) => {
    const data = snapshot.val();
    const setup = document.getElementById('setupScreen');
    const game = document.getElementById('gameScreen');
    const waiting = document.getElementById('waitingScreen') || createWaitingScreen();

    if (!data) {
        // مفيش لعبة شغالة حالياً -> اظهر الإعدادات عشان حد يبدأ
        waiting.style.display = 'none';
        game.style.display = 'none';
        setup.style.display = 'block'; 
        showFloatingExit(false);
    } else {
        // فيه لعبة شغالة! -> اخفي الإعدادات فوراً واظهر اللعبة
        waiting.style.display = 'none';
        setup.style.display = 'none';
        game.style.display = 'block';
        
        // تحديث البيانات المحلية
        gameState.secret = data.secret ? data.secret.toString() : "";
        gameState.digits = data.digits;
        gameState.endTime = data.endTime;
        gameState.cyclesTotal = data.totalCycles;
        gameState.currentCycle = data.currentCycle;
        gameState.allowDupes = data.allowDupes;

        // تحديث شكل الواجهة
        document.getElementById('gameModeDisplay').innerText = `${data.digits} أرقام | ${data.allowDupes ? 'بتكرار' : 'بدون تكرار'}`;
        document.getElementById('myGuess').placeholder = "?".repeat(data.digits);
        document.getElementById('cycleBadge').innerText = `جولة ${data.currentCycle} / ${data.totalCycles}`;
        
        showFloatingExit(true);

        // التايمر وحالة اللعب
        const now = Date.now();
        const diff = data.endTime - now;

        if (data.winner) {
             handleWinState(data.winner);
        } else if (diff <= 0) {
             handleTimeUpState();
        } else {
             handlePlayingState(data.endTime);
        }
    }
});

// --- 3. مراقبة التخمينات (عشان نشوف بعض) ---
onValue(ref(db, 'guesses'), (snapshot) => {
    const list = document.getElementById('guessesList');
    list.innerHTML = ''; // تنظيف القائمة عشان منكررش
    
    const arr = [];
    snapshot.forEach(child => arr.push(child.val()));
    
    // اعرض الجديد فوق
    arr.reverse().forEach(g => {
        addGuessToUI(g.player, g.guess, g.bulls, g.cows);
    });
});

// --- 4. مراقبة الاسكور ---
onValue(ref(db, 'scores'), (s) => {
    const b = document.getElementById('scoreboard'); 
    b.innerHTML='';
    const sc=[]; 
    s.forEach(c=>sc.push(c.val()));
    sc.sort((a,b)=>(b.points||0)-(a.points||0));
    sc.forEach(p=> {
        b.innerHTML += `<div class="score-pill shadow-sm border mx-1">${p.name}: <strong>${p.points||0}</strong></div>`;
    });
});


// --- دوال اللعب (window functions) ---

// دالة البدء (معدلة عشان متعملش ريست بالغلط)
window.startGame = function() {
    // هنتأكد الأول من السيرفر إن مفيش لعبة شغالة
    get(ref(db, 'gameState')).then((snapshot) => {
        if (snapshot.exists()) {
            Swal.fire('استنى!', 'فيه لعبة شغالة بالفعل، هندخلك عليها دلوقتي.', 'warning');
        } else {
            // لو مفيش لعبة، ابدأ يا باشا
            const digits = parseInt(document.getElementById('digitsCount').value);
            const duration = parseInt(document.getElementById('gameDuration').value);
            const cycles = parseInt(document.getElementById('cyclesCount').value);
            const allowDupes = document.getElementById('allowDuplicates').checked;

            const secret = generateSecret(digits, allowDupes);
            const endTime = Date.now() + (duration * 60 * 1000);

            set(ref(db, 'gameState'), {
                secret: secret,
                digits: digits,
                duration: duration,
                allowDupes: allowDupes,
                totalCycles: cycles,
                currentCycle: 1,
                endTime: endTime,
                startedBy: myName
            });
            
            remove(ref(db, 'guesses'));
            remove(ref(db, 'gameState/winner'));
        }
    });
}

window.submitGuess = function() {
    if(!gameState.active) return;
    if(gameState.hasGuessed) return;

    const guess = document.getElementById('myGuess').value.toString();
    
    // Validations
    if (guess.length !== gameState.digits) return Swal.fire(`لازم ${gameState.digits} أرقام!`, '', 'warning');
    if (!gameState.allowDupes && new Set(guess).size !== guess.length) return Swal.fire('ممنوع التكرار!', '', 'warning');

    const result = calculateBullsAndCows(gameState.secret, guess);
    
    // Push = إضافة تخمين جديد (مش مسح القديم)
    push(ref(db, 'guesses'), {
        player: myName,
        guess: guess,
        bulls: result.bulls,
        cows: result.cows,
        timestamp: Date.now()
    });

    document.getElementById('myGuess').value = '';
    
    // قفل المحاولة عليك إنت بس
    gameState.hasGuessed = true;
    toggleInputs(false);
    document.getElementById('guessLockedMsg').style.display = 'block';

    if (result.bulls === gameState.digits) {
        set(ref(db, 'gameState/winner'), myName);
        update(ref(db, `scores/${myName}`), { points: increment(1) });
    }
}

window.endRoundEarly = function() {
    // إنهاء الوقت للكل
    update(ref(db, 'gameState'), { endTime: Date.now() - 1000 });
}

window.startNextCycle = function() {
    // التحقق من السيرفر قبل التعديل
    get(ref(db, 'gameState')).then((snap) => {
        if(snap.exists()) {
           const d = snap.val();
           const nextEndTime = Date.now() + (d.duration || 2) * 60 * 1000;
           update(ref(db, 'gameState'), {
               endTime: nextEndTime,
               currentCycle: (d.currentCycle || 1) + 1,
               winner: null // مسح الفائز للجولة الجديدة
           });
           remove(ref(db, 'guesses')); // مسح التخمينات للجولة الجديدة
        }
    });
}

window.endGameImmediately = function() {
    Swal.fire({
        title: 'إنهاء اللعبة للكل؟',
        text: "الكل هيرجع لشاشة البداية",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'نعم، إنهاء'
    }).then((r) => {
        if(r.isConfirmed) {
            set(ref(db, 'gameState'), null); // ده اللي بيرجعنا للبداية
            remove(ref(db, 'guesses'));
        }
    });
}

// --- Logic Helpers ---

function handlePlayingState(endTime) {
    document.getElementById('gameScreen').style.display = 'block';
    document.getElementById('gameStatusAlert').style.display = 'none';
    document.getElementById('nextCycleBtn').style.display = 'none';
    document.getElementById('endRoundBtn').style.display = 'block';
    
    startTimer(endTime);
}

function handleTimeUpState() {
    if(timerInterval) clearInterval(timerInterval);
    document.getElementById('timerDisplay').innerText = "00:00";
    gameState.active = false;
    toggleInputs(false);
    document.getElementById('endRoundBtn').style.display = 'none';

    const alertBox = document.getElementById('gameStatusAlert');
    alertBox.style.display = 'block';

    // التأكد من إن البيانات موجودة قبل المقارنة
    if (gameState.cyclesTotal && gameState.currentCycle >= gameState.cyclesTotal) {
        alertBox.className = 'alert alert-danger';
        alertBox.innerHTML = `🏁 خلصت! الرقم: ${gameState.secret}`;
        document.getElementById('resetBtn').style.display = 'block';
    } else {
        alertBox.className = 'alert alert-warning';
        alertBox.innerHTML = `✋ الوقت خلص!`;
        document.getElementById('nextCycleBtn').style.display = 'block';
    }
    
    // فتح القفل للجولة الجاية
    gameState.hasGuessed = false;
    document.getElementById('guessLockedMsg').style.display = 'none';
}

function handleWinState(winnerName) {
    if(timerInterval) clearInterval(timerInterval);
    gameState.active = false;
    toggleInputs(false);
    
    const alertBox = document.getElementById('gameStatusAlert');
    alertBox.style.display = 'block';
    alertBox.className = 'alert alert-success';
    alertBox.innerHTML = `👑 ${winnerName} كسب! الرقم: ${gameState.secret}`;
    
    document.getElementById('endRoundBtn').style.display = 'none';
    document.getElementById('nextCycleBtn').style.display = 'none';
    
    // زرار بدء لعبة جديدة يظهر للكل
    document.getElementById('resetBtn').style.display = 'block';
}

function startTimer(endTime) {
    if(timerInterval) clearInterval(timerInterval);
    const display = document.getElementById('timerDisplay');
    
    const now = Date.now();
    // بنفتح الانبوت فقط لو انا لسه مخمنتش
    if (endTime > now && !gameState.hasGuessed) {
        gameState.active = true;
        toggleInputs(true);
    }

    timerInterval = setInterval(() => {
        const now = Date.now();
        const diff = endTime - now;
        if (diff <= 0) {
            clearInterval(timerInterval);
            display.innerText = "00:00";
        } else {
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            display.innerText = `${m}:${s < 10 ? '0'+s : s}`;
            if(diff < 30000) display.classList.add('timer-danger');
            else display.classList.remove('timer-danger');
        }
    }, 1000);
}

// --- Core Logic ---
function generateSecret(length, allowDupes) {
    let result = "";
    if (allowDupes) {
        for (let i = 0; i < length; i++) result += Math.floor(Math.random() * 10);
    } else {
        let pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        result = pool.slice(0, length).join('');
    }
    return result;
}

function calculateBullsAndCows(secret, guess) {
    let bulls = 0, cows = 0;
    let s = secret.split(''); let g = guess.split('');
    for (let i = 0; i < s.length; i++) { if (g[i] === s[i]) { bulls++; s[i] = null; g[i] = null; } }
    for (let i = 0; i < s.length; i++) { if (g[i] !== null && s.includes(g[i])) { cows++; s[s.indexOf(g[i])] = null; } }
    return { bulls, cows };
}

function toggleInputs(enabled) {
    const inp = document.getElementById('myGuess');
    const btn = document.getElementById('guessBtn');
    if(enabled) {
        inp.disabled = false; btn.disabled = false;
        inp.classList.remove('locked-input');
        inp.focus();
    } else {
        inp.disabled = true; btn.disabled = true;
        inp.classList.add('locked-input');
    }
}

function addGuessToUI(player, guess, bulls, cows) {
    const list = document.getElementById('guessesList');
    const isWin = bulls === gameState.digits;
    
    // تصميم مختلف عشان يوضح مين اللاعب
    const html = `
        <div class="guess-row ${isWin ? 'winner-row' : ''}">
            <div class="d-flex align-items-center">
                <span class="badge bg-secondary me-2">${player}</span>
                <span class="font-monospace fs-4 fw-bold letter-spacing-2">${guess}</span>
            </div>
            <div class="d-flex align-items-center gap-2">
                <span class="badge bg-success rounded-pill">${bulls} <i class="bi bi-geo-alt-fill"></i></span>
                <span class="badge bg-warning text-dark rounded-pill">${cows} <i class="bi bi-arrow-repeat"></i></span>
            </div>
        </div>`;
    list.insertAdjacentHTML('afterbegin', html);
}

// --- Helpers UI ---
function createWaitingScreen() {
    let div = document.getElementById('waitingScreen');
    if(!div) {
        div = document.createElement('div');
        div.id = 'waitingScreen';
        div.className = 'text-center mt-5 text-muted';
        div.innerHTML = `<h3>⏳ جاري الاتصال...</h3><p>بنشوف لو فيه لعبة شغالة</p>`;
        div.style.display = 'none';
        document.querySelector('.container').appendChild(div);
    }
    return div;
}

function showFloatingExit(show) {
    const btn = document.getElementById('exitFloatingBtn');
    if(btn) btn.style.display = show ? 'block' : 'none';
}

window.login = function() {
    const n = document.getElementById('usernameInput').value.trim();
    if(!n) return Swal.fire('الاسم مطلوب');
    myName = n; 
    localStorage.setItem('coffee_user', myName);
    document.getElementById('loginScreen').style.display='none';
    
    // اظهر الانتظار لحد ما الداتا تحمل
    createWaitingScreen().style.display = 'block';
    
    update(ref(db, `scores/${myName}`), { name: myName });
}

window.toggleTheme = function() {
    const h = document.querySelector('html'); const newT = h.getAttribute('data-bs-theme')==='dark'?'light':'dark';
    h.setAttribute('data-bs-theme', newT); localStorage.setItem('theme', newT);
    document.getElementById('themeIcon').className = newT==='dark'?'bi bi-moon-stars-fill':'bi bi-sun-fill';
}
if(localStorage.getItem('theme') === 'light') window.toggleTheme();

window.showRules = function() { 
    Swal.fire({
        title: '📜 دليل العلامات',
        html: `
            <div class="text-end" style="direction: rtl;">
                <p class="mb-3 fw-bold">الهدف: خمن الرقم السري قبل الوقت ما يخلص!</p>
                <div class="alert alert-success d-flex align-items-center p-2 mb-2">
                    <div class="fs-2 me-3 ms-1">🎯</div>
                    <div><strong>الأخضر:</strong> رقم صح وفي مكانه الصح.</div>
                </div>
                <div class="alert alert-warning d-flex align-items-center p-2 text-dark">
                    <div class="fs-2 me-3 ms-1">⚠️</div>
                    <div><strong>الأصفر:</strong> رقم صح بس مكانه غلط.</div>
                </div>
            </div>
        `
    }); 
}

window.updateDupesLabel = function() {
     const isChecked = document.getElementById('allowDuplicates').checked;
    const label = document.getElementById('dupesLabel');
    if(isChecked) {
        label.innerText = "مسموح (ممكن 1122)";
        label.className = "text-success small fw-bold";
    } else {
        label.innerText = "ممنوع (كل رقم مختلف)";
        label.className = "text-danger small fw-bold";
    }
}

window.resetGame = function() {
    // ريست محلي فقط للفيو، الريست الحقيقي من endGameImmediately
    set(ref(db, 'gameState'), null);
    remove(ref(db, 'guesses'));
}
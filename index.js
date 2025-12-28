// 1. استدعاء مكتبات فايربيس
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, push, onValue, remove, update, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// 2. بيانات مشروعك (مظبوطة وجاهزة)
const firebaseConfig = {
    apiKey: "AIzaSyCw9YuyXWAZLjuyhh8HyuqcTof-alEByiI",
    authDomain: "coffee-guess.firebaseapp.com",
    // 👇 الرابط ده هو سر الشغل كله
    databaseURL: "https://coffee-guess-default-rtdb.firebaseio.com",
    projectId: "coffee-guess",
    storageBucket: "coffee-guess.firebasestorage.app",
    messagingSenderId: "594892061994",
    appId: "1:594892061994:web:814a87a35981a8414af253"
};

// تهيئة الاتصال
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- Global Variables ---
let gameState = {
    secret: "",
    digits: 4,
    allowDupes: false,
    duration: 2,
    cyclesTotal: 3,
    currentCycle: 1,
    endTime: 0,
    active: false,
    hasGuessed: false 
};
let myName = localStorage.getItem('coffee_user') || "";
let timerInterval = null;

// --- Init ---
if (myName) {
    document.getElementById('usernameInput').value = myName;
    document.getElementById('loginScreen').style.display = 'none';
    // بنستنى الفايربيس يقولنا حالة اللعبة
}

// --- Firebase Listeners (الرادار) ---

// 1. مراقبة حالة اللعبة
onValue(ref(db, 'gameState'), (snapshot) => {
    const data = snapshot.val();
    const setup = document.getElementById('setupScreen');
    const game = document.getElementById('gameScreen');
    const waiting = document.getElementById('waitingScreen') || createWaitingScreen();

    if (!data) {
        // مفيش لعبة شغالة (Lobby)
        game.style.display = 'none';
        waiting.style.display = 'none';
        setup.style.display = 'block'; 
        showFloatingExit(false);
    } else {
        // فيه لعبة شغالة
        setup.style.display = 'none';
        
        // تحديث البيانات المحلية
        gameState.secret = data.secret ? data.secret.toString() : "";
        gameState.digits = data.digits;
        gameState.allowDupes = data.allowDupes;
        gameState.cyclesTotal = data.totalCycles;
        gameState.currentCycle = data.currentCycle;
        gameState.endTime = data.endTime;
        
        // تحديث الواجهة
        const dupeText = gameState.allowDupes ? "تكرار" : "بلا تكرار";
        document.getElementById('gameModeDisplay').innerText = `${gameState.digits} خانات | ${dupeText}`;
        document.getElementById('myGuess').placeholder = "?".repeat(gameState.digits);
        document.getElementById('cycleBadge').innerText = `جولة ${gameState.currentCycle} / ${gameState.cyclesTotal}`;
        
        showFloatingExit(true);

        // حساب الوقت
        const now = Date.now();
        const diff = gameState.endTime - now;

        if (data.winner) {
             handleWinState(data.winner);
        } else if (diff <= 0) {
             handleTimeUpState();
        } else {
             handlePlayingState(data.endTime);
        }
    }
});

// 2. مراقبة التخمينات
onValue(ref(db, 'guesses'), (snapshot) => {
    const list = document.getElementById('guessesList');
    list.innerHTML = '';
    const arr = [];
    snapshot.forEach(c => arr.push(c.val()));
    // نعرض أحدث تخمين فوق
    arr.reverse().forEach(g => {
        addGuessToUI(g.player, g.guess, g.bulls, g.cows);
    });
});

// 3. مراقبة الاسكور
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


// --- Game Functions (مربوطة بـ window عشان الزراير تشوفها) ---

window.startGame = function() {
    const digits = parseInt(document.getElementById('digitsCount').value);
    const duration = parseInt(document.getElementById('gameDuration').value);
    const cycles = parseInt(document.getElementById('cyclesCount').value);
    const allowDupes = document.getElementById('allowDuplicates').checked;

    const secret = generateSecret(digits, allowDupes);
    const endTime = Date.now() + (duration * 60 * 1000);

    // إرسال للسيرفر
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
    
    // تصفير القديم
    remove(ref(db, 'guesses'));
    remove(ref(db, 'gameState/winner'));
}

window.submitGuess = function() {
    if(!gameState.active) return;
    if(gameState.hasGuessed) return;

    const guess = document.getElementById('myGuess').value.toString();
    
    // Validations
    if (guess.length !== gameState.digits) return Swal.fire(`لازم ${gameState.digits} أرقام!`, '', 'warning');
    if (!gameState.allowDupes && new Set(guess).size !== guess.length) return Swal.fire('ممنوع التكرار!', '', 'warning');

    const result = calculateBullsAndCows(gameState.secret, guess);
    
    // إرسال التخمين
    push(ref(db, 'guesses'), {
        player: myName,
        guess: guess,
        bulls: result.bulls,
        cows: result.cows,
        timestamp: Date.now()
    });

    document.getElementById('myGuess').value = '';
    
    // قفل المحاولة مؤقتاً
    gameState.hasGuessed = true;
    toggleInputs(false);
    document.getElementById('guessLockedMsg').style.display = 'block';

    if (result.bulls === gameState.digits) {
        set(ref(db, 'gameState/winner'), myName);
        update(ref(db, `scores/${myName}`), { points: increment(1) });
    }
}

window.endRoundEarly = function() {
    // إنهاء الوقت فوراً للكل
    update(ref(db, 'gameState'), {
        endTime: Date.now() - 1000 
    });
}

window.startNextCycle = function() {
    // حساب وقت الجولة الجديدة
    const nextEndTime = Date.now() + (gameState.duration || 2) * 60 * 1000;
    
    update(ref(db, 'gameState'), {
        endTime: nextEndTime,
        currentCycle: increment(1)
    });
    // مسح تخمينات الجولة اللي فاتت
    remove(ref(db, 'guesses'));
    // إزالة الفائز لو كان فيه حد كسب الجولة اللي فاتت عشان نكمل
    remove(ref(db, 'gameState/winner'));
}

window.endGameImmediately = function() {
    Swal.fire({
        title: 'إنهاء اللعبة للكل؟',
        text: "هترجعوا كلكم للشاشة الرئيسية",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'اقفل يا ريس'
    }).then((r) => {
        if(r.isConfirmed) {
            // حذف الجيم يرجع الكل للبداية
            set(ref(db, 'gameState'), null);
            remove(ref(db, 'guesses'));
        }
    });
}

// --- State Handlers ---

function handlePlayingState(endTime) {
    document.getElementById('gameScreen').style.display = 'block';
    document.getElementById('gameStatusAlert').style.display = 'none';
    document.getElementById('nextCycleBtn').style.display = 'none';
    document.getElementById('endRoundBtn').style.display = 'block';
    
    // لو الجولة اتغيرت (أو بدأنا جيم جديد)، افتح التخمين تاني
    // (هنا بنعتمد ان لو الرسالة ظاهرة، يبقى احنا قفلناها، لكن لو الجولة جديدة بنفتحها)
    // *تحسين بسيط: بنفتح الانبوت لو الوقت لسه شغال*
    
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

    if (gameState.currentCycle >= gameState.cyclesTotal) {
        // Game Over
        alertBox.className = 'alert alert-danger';
        alertBox.innerHTML = `🏁 خلصت! الرقم: ${gameState.secret}`;
        document.getElementById('resetBtn').style.display = 'block';
    } else {
        // Pause
        alertBox.className = 'alert alert-warning';
        alertBox.innerHTML = `✋ استراحة...`;
        document.getElementById('nextCycleBtn').style.display = 'block';
        
        // فك القفل للجولة الجاية (محلياً)
        gameState.hasGuessed = false;
        document.getElementById('guessLockedMsg').style.display = 'none';
    }
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


// --- Helpers ---
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

function startTimer(endTime) {
    if(timerInterval) clearInterval(timerInterval);
    const display = document.getElementById('timerDisplay');
    
    // نفتح الانبوت لو انا لسه مخمنتش والوقت شغال
    const now = Date.now();
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
    const html = `
        <div class="guess-row ${isWin ? 'winner-row' : ''}">
            <div><span class="fw-bold text-info">${player}</span> <span class="mx-2 font-monospace fs-5">${guess}</span></div>
            <div>${bulls}<i class="bi bi-geo-alt-fill text-success ms-1"></i> ${cows}<i class="bi bi-arrow-repeat text-warning ms-1"></i></div>
        </div>`;
    list.insertAdjacentHTML('afterbegin', html);
}

// باقي الدوال العامة (window functions)
window.login = function() {
    const n = document.getElementById('usernameInput').value.trim();
    if(!n) return Swal.fire('الاسم مطلوب');
    myName = n; 
    localStorage.setItem('coffee_user', myName);
    document.getElementById('loginScreen').style.display='none';
    
    // تسجيل اللاعب في السكوربورد
    update(ref(db, `scores/${myName}`), { name: myName });
}

window.toggleTheme = function() {
    const h = document.querySelector('html'); const newT = h.getAttribute('data-bs-theme')==='dark'?'light':'dark';
    h.setAttribute('data-bs-theme', newT); localStorage.setItem('theme', newT);
    document.getElementById('themeIcon').className = newT==='dark'?'bi bi-moon-stars-fill':'bi bi-sun-fill';
}
if(localStorage.getItem('theme') === 'light') window.toggleTheme();
// استبدل دالة showRules القديمة دي بالكود ده 👇

window.showRules = function() { 
    Swal.fire({
        title: '📜 دليل العلامات',
        html: `
            <div class="text-end" style="direction: rtl;">
                <p class="mb-3 fw-bold">الهدف: خمن الرقم السري قبل الوقت ما يخلص!</p>
                
                <div class="alert alert-success d-flex align-items-center p-2 mb-2" style="border: 1px solid #198754;">
                    <div class="fs-2 me-3 ms-1">🎯</div>
                    <div>
                        <strong>الرقم الأخضر (مكان صح):</strong>
                        <br><small>الرقم موجود وفي مكانه الصح بالظبط.</small>
                        <br><span class="badge bg-success mt-1">مثال: الرقم 1234 وانت كتبت 1...</span>
                    </div>
                </div>

                <div class="alert alert-warning d-flex align-items-center p-2 text-dark" style="border: 1px solid #ffc107;">
                    <div class="fs-2 me-3 ms-1">⚠️</div>
                    <div>
                        <strong>الرقم الأصفر (مكان غلط):</strong>
                        <br><small>الرقم موجود في السر، بس أنت حطيته في خانة غلط.</small>
                        <br><span class="badge bg-warning text-dark mt-1">مثال: الرقم 1234 وانت كتبت 4...</span>
                    </div>
                </div>

                <hr>
                <div class="text-center text-muted small">
                    <i class="bi bi-people-fill"></i> ملحوظة: في الأونلاين، تخميناتك بتظهر للكل، ركز في لعب غيرك عشان تكسب! 😉
                </div>
            </div>
        `,
        confirmButtonText: 'فهمت، يلا بينا! 👍',
        confirmButtonColor: '#d35400'
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

function createWaitingScreen() {
    const div = document.createElement('div');
    div.id = 'waitingScreen';
    div.style.display = 'none';
    document.querySelector('.container').appendChild(div);
    return div;
}

function showFloatingExit(show) {
    const btn = document.getElementById('exitFloatingBtn');
    if(btn) btn.style.display = show ? 'block' : 'none';
}

// دالة اعادة اللعب المحلية (بتستخدم لما الجيم يخلص عشان ترجعنا للوبي)
window.resetGame = function() {
    set(ref(db, 'gameState'), null);
    remove(ref(db, 'guesses'));
}
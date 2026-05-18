function createElement(tag, classes = [], attributes = {}) {
    const el = document.createElement(tag);
    if (typeof classes === 'string') el.className = classes;
    else if (Array.isArray(classes)) classes.forEach(c => c && el.classList.add(c));
    for(const [key, value] of Object.entries(attributes)) {
        if (key === 'textContent') el.textContent = value;
        else if (key === 'innerHTML') { /* Security enforcement: Prevent innerHTML */ }
        else el.setAttribute(key, value);
    }
    return el;
}

function sanitizeInput(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

const Storage = {
    getKey: (key, defaultValue) => {
        try { const val = localStorage.getItem(key); return val ? JSON.parse(val) : defaultValue; }
        catch (e) { return defaultValue; }
    },
    setKey: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
};

const state = {
    tasks: Storage.getKey('studyplanner_tasks', []),
    notes: Storage.getKey('studyplanner_notes', ''),
    streak: Storage.getKey('studyplanner_streak', { 
        app: { current: 0, best: 0, lastDate: null },
        study: { current: 0, best: 0, lastDate: null }
    }),
    theme: Storage.getKey('studyplanner_theme', 'light'),
    analytics: Storage.getKey('studyplanner_analytics', { totalStudySeconds: 0, daysActive: {} }),
    health: Storage.getKey('studyplanner_health', {}), // new health state mapped by date
    gamification: Storage.getKey('studyplanner_gamification', {
        xp: 0,
        level: 1,
        coins: 0,
        badges: [],
        streakFreezes: 0,
        unlockedThemes: []
    }),
    challenges: Storage.getKey('studyplanner_challenges', {})
};

function applyActiveTheme() {
    if (state.gamification.unlockedThemes.length > 0) {
        // Find last unlocked theme and apply it, optionally could allow user to select
        const activeCustomTheme = state.gamification.unlockedThemes[state.gamification.unlockedThemes.length - 1];
        document.body.setAttribute('data-custom-theme', activeCustomTheme);
    }
}

// --- GAMIFICATION HELPERS ---
function addXP(amount, reason = '') {
    state.gamification.xp += amount;
    checkLevelUp();
    Storage.setKey('studyplanner_gamification', state.gamification);
    updateGamificationUI();
    if(reason) showToast(`+${amount} XP (${reason})`, 'success');
}

function addCoins(amount, reason = '') {
    state.gamification.coins += amount;
    Storage.setKey('studyplanner_gamification', state.gamification);
    updateGamificationUI();
    if(reason) showToast(`+${amount} Coins! 🪙`, 'success');
}

function checkLevelUp() {
    const requiredXP = state.gamification.level * 100;
    if (state.gamification.xp >= requiredXP) {
        state.gamification.xp -= requiredXP;
        state.gamification.level += 1;
        triggerLevelUp();
        checkLevelUp();
    }
}

function triggerLevelUp() {
    playCelebrationSound();
    showConfetti();
    const modal = document.getElementById('level-up-modal');
    if (modal) {
        document.getElementById('level-up-number').textContent = state.gamification.level;
        modal.classList.add('active');
    }
}

function showAchievementModal(title, iconClass) {
    playCelebrationSound();
    showConfetti();
    const modal = document.getElementById('achievement-modal');
    if (modal) {
        document.getElementById('achievement-title').textContent = title;
        document.getElementById('achievement-icon').className = `fa-solid ${iconClass}`;
        modal.classList.add('active');
        setTimeout(() => modal.classList.remove('active'), 4000);
    }
}

function playCelebrationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.5, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    } catch(e) {}
}

function showConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    for (let i = 0; i < 100; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 6 + 2,
            dx: Math.random() * 4 - 2,
            dy: Math.random() * 4 + 2,
            color: `hsl(${Math.random() * 360}, 100%, 50%)`
        });
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        particles.forEach(p => {
            p.x += p.dx;
            p.y += p.dy;
            if (p.y < canvas.height) active = true;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
        });
        if (active) requestAnimationFrame(animate);
    }
    animate();
}

function updateGamificationUI() {
    const levelEl = document.getElementById('header-level');
    const xpBar = document.getElementById('header-xp-bar');
    const xpText = document.getElementById('header-xp-text');
    const coinsEl = document.getElementById('header-coins');
    
    if (levelEl) levelEl.textContent = `Lvl ${state.gamification.level}`;
    if (coinsEl) coinsEl.textContent = Math.floor(state.gamification.coins);
    
    if (xpBar) {
        const requiredXP = state.gamification.level * 100;
        const width = (state.gamification.xp / requiredXP) * 100;
        xpBar.style.width = `${Math.min(width, 100)}%`;
        if (xpText) xpText.textContent = `${Math.floor(state.gamification.xp)} / ${requiredXP}`;
    }
}

function checkAndGenerateChallenges() {
    const today = new Date().toDateString();
    if (!state.challenges[today]) {
        state.challenges[today] = [
            { id: 'c_tasks', title: 'Complete 5 Tasks', target: 5, progress: 0, completed: false, xp: 100, coins: 50 },
            { id: 'c_study', title: 'Study 2 Hours', target: 120, progress: 0, completed: false, xp: 150, coins: 50 },
            { id: 'c_water', title: 'Drink 8 Glasses of Water', target: 8, progress: 0, completed: false, xp: 50, coins: 20 },
            { id: 'c_burn', title: 'Burn 300 kcal', target: 300, progress: 0, completed: false, xp: 100, coins: 50 }
        ];
        Storage.setKey('studyplanner_challenges', state.challenges);
    }
}

function updateChallenge(id, amount) {
    const today = new Date().toDateString();
    const dailyChallenges = state.challenges[today];
    if (!dailyChallenges) return;
    
    const challenge = dailyChallenges.find(c => c.id === id);
    if (challenge && !challenge.completed) {
        challenge.progress += amount;
        if (challenge.progress >= challenge.target) {
            challenge.progress = challenge.target;
            challenge.completed = true;
            addXP(challenge.xp, `Challenge: ${challenge.title}`);
            addCoins(challenge.coins, `Challenge Completions`);
            showAchievementModal('Challenge Complete!', 'fa-star');
        }
        Storage.setKey('studyplanner_challenges', state.challenges);
        if (typeof renderGamificationView === 'function') renderGamificationView();
    }
}
// --- END GAMIFICATION HELPERS ---

function renderGamificationView() {
    renderShopItems();
    renderBadges();
    renderDailyChallenges();
}

function renderShopItems() {
    const container = document.getElementById('shop-container');
    if(!container) return;
    container.replaceChildren();
    
    const shopItems = [
        { id: 'freeze_1', title: 'Streak Freeze', desc: 'Saves your streak if you miss a day.', cost: 100, icon: 'fa-snowflake', type: 'consumable' },
        { id: 'theme_mint', title: 'Mint Theme', desc: 'Unlock the elegant mint color theme.', cost: 500, icon: 'fa-leaf', type: 'theme', themeKey: 'mint' },
        { id: 'theme_rose', title: 'Rose Theme', desc: 'Unlock the vibrant rose color theme.', cost: 500, icon: 'fa-rose', type: 'theme', themeKey: 'rose' },
        { id: 'theme_amber', title: 'Amber Theme', desc: 'Unlock the warm amber color theme.', cost: 500, icon: 'fa-sun', type: 'theme', themeKey: 'amber' }
    ];
    
    document.getElementById('shop-coins-display').textContent = Math.floor(state.gamification.coins);
    
    shopItems.forEach(item => {
        const isOwned = item.type === 'theme' && state.gamification.unlockedThemes.includes(item.themeKey);
        
        const el = createElement('div', 'shop-item');
        el.appendChild(createElement('i', ['fa-solid', item.icon, 'shop-icon']));
        el.appendChild(createElement('h3', 'shop-title', { textContent: item.title }));
        el.appendChild(createElement('p', 'shop-desc', { textContent: item.desc }));
        
        const btn = createElement('button', 'shop-buy-btn');
        if (isOwned) {
            btn.classList.add('owned');
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Owned`;
            btn.disabled = true;
        } else {
            btn.innerHTML = `<i class="fa-solid fa-coins"></i> ${item.cost}`;
            if (state.gamification.coins < item.cost) btn.disabled = true;
            btn.addEventListener('click', () => buyShopItem(item));
        }
        el.appendChild(btn);
        container.appendChild(el);
    });
}

function buyShopItem(item) {
    if (state.gamification.coins >= item.cost) {
        state.gamification.coins -= item.cost;
        if (item.type === 'consumable' && item.id === 'freeze_1') {
            state.gamification.streakFreezes++;
            showToast('Purchased 1 Streak Freeze!', 'success');
        } else if (item.type === 'theme') {
            state.gamification.unlockedThemes.push(item.themeKey);
            showToast(`Unlocked ${item.title}!`, 'success');
            applyActiveTheme();
        }
        Storage.setKey('studyplanner_gamification', state.gamification);
        updateGamificationUI();
        renderGamificationView();
        playCelebrationSound();
        showConfetti();
    }
}

function renderBadges() {
    const container = document.getElementById('badges-container');
    if(!container) return;
    container.replaceChildren();
    
    const allBadges = [
        { id: 'streak_3', title: '3 Days', icon: 'fa-fire' },
        { id: 'streak_7', title: '1 Week', icon: 'fa-fire-flame-curved' },
        { id: 'streak_15', title: '15 Days', icon: 'fa-dumpster-fire' },
        { id: 'streak_30', title: '1 Month', icon: 'fa-crown' },
        { id: 'streak_100', title: '100 Days', icon: 'fa-dragon' }
    ];
    
    allBadges.forEach(b => {
        const isUnlocked = state.gamification.badges.includes(b.id);
        const el = createElement('div', ['badge-item', isUnlocked ? 'unlocked' : 'locked']);
        el.title = isUnlocked ? 'Unlocked!' : 'Locked';
        
        const iconWrap = createElement('div', 'badge-icon');
        iconWrap.appendChild(createElement('i', ['fa-solid', b.icon]));
        el.appendChild(iconWrap);
        el.appendChild(createElement('div', 'badge-title', { textContent: b.title }));
        
        container.appendChild(el);
    });
}

function renderDailyChallenges() {
    const container = document.getElementById('daily-challenges-container');
    if(!container) return;
    container.replaceChildren();
    
    const today = new Date().toDateString();
    const dailyChallenges = state.challenges[today] || [];
    
    if (dailyChallenges.length === 0) {
        container.appendChild(createElement('p', 'empty-state', { textContent: "No challenges generated for today."}));
        return;
    }
    
    dailyChallenges.forEach(c => {
        const el = createElement('div', ['challenge-item', c.completed ? 'completed' : '']);
        
        const header = createElement('div', 'challenge-header');
        header.appendChild(createElement('span', '', { textContent: c.title }));
        
        const rew = createElement('div', 'challenge-rewards');
        rew.innerHTML = `<span class="xp"><i class="fa-solid fa-star"></i> ${c.xp} XP</span> <span><i class="fa-solid fa-coins"></i> ${c.coins}</span>`;
        header.appendChild(rew);
        el.appendChild(header);
        
        const pCont = createElement('div', 'challenge-progress-container');
        const pBar = createElement('div', 'challenge-progress-bar');
        pBar.style.width = `${(c.progress / c.target) * 100}%`;
        pCont.appendChild(pBar);
        el.appendChild(pCont);
        
        el.appendChild(createElement('div', 'challenge-text', { textContent: `${c.progress} / ${c.target}` }));
        
        container.appendChild(el);
    });
}

// Legacy migration
if (state.streak.current !== undefined) {
    state.streak = {
        app: { current: state.streak.current, best: state.streak.current, lastDate: state.streak.lastDate },
        study: { current: 0, best: 0, lastDate: null }
    };
}

function initTheme() {
    const body = document.getElementById('app-body');
    const themeText = document.getElementById('theme-text');
    const toggleIcon = document.querySelector('#theme-toggle i');
    
    if (state.theme === 'dark') {
        body.setAttribute('data-theme', 'dark');
        themeText.textContent = 'Light Mode';
        toggleIcon.className = 'fa-solid fa-sun';
    } else {
        body.removeAttribute('data-theme');
        themeText.textContent = 'Dark Mode';
        toggleIcon.className = 'fa-solid fa-moon';
    }
}

document.getElementById('theme-toggle').addEventListener('click', () => {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    Storage.setKey('studyplanner_theme', state.theme);
    initTheme();
});

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = createElement('div', ['toast', type]);
    let iconClass = 'fa-info-circle';
    if(type === 'success') iconClass = 'fa-check-circle';
    if(type === 'error') iconClass = 'fa-times-circle';
    if(type === 'warning') iconClass = 'fa-exclamation-triangle';
    
    toast.appendChild(createElement('i', ['fa-solid', iconClass]));
    toast.appendChild(createElement('span', '', { textContent: message }));
    container.appendChild(toast);
    
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');
    const sidebar = document.getElementById('sidebar');
    
    const overlay = document.getElementById('sidebar-overlay');

    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.add('active');
    });

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if(sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
            }
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            
            const targetView = item.getAttribute('data-view');
            views.forEach(v => {
                v.classList.remove('active');
                if (v.id === `view-${targetView}`) v.classList.add('active');
            });
            
            if(targetView === 'dashboard') updateDashboard();
            if(targetView === 'calendar') renderCalendar();
            if(targetView === 'fitness') updateHealthUI();
            if(targetView === 'gamification') renderGamificationView();
        });
    });
}

function updateStreakUI() {
    document.getElementById('app-streak-count').innerHTML = `<span class="hide-mobile">Tasks: </span>${state.streak.app.current}`;
    document.getElementById('app-streak-best').textContent = `(Best: ${state.streak.app.best})`;
    document.getElementById('study-streak-count').innerHTML = `<span class="hide-mobile">Study: </span>${state.streak.study.current}`;
    document.getElementById('study-streak-best').textContent = `(Best: ${state.streak.study.best})`;
}

function initStreak() {
    const today = new Date().toDateString();
    let freezeUsedApp = false;
    
    // TASK STREAK (formerly app streak)
    if (state.streak.app.lastDate && state.streak.app.lastDate !== today) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (state.streak.app.lastDate !== yesterday.toDateString()) {
            if (state.gamification.streakFreezes > 0) {
                state.gamification.streakFreezes--;
                freezeUsedApp = true;
                showToast('Streak Freeze used! Task streak saved.', 'info');
                state.streak.app.lastDate = yesterday.toDateString();
                Storage.setKey('studyplanner_gamification', state.gamification);
            } else {
                state.streak.app.current = 0; // reset
            }
        }
    }
    
    // STUDY STREAK Check
    if (state.streak.study.lastDate && state.streak.study.lastDate !== today) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (state.streak.study.lastDate !== yesterday.toDateString()) {
            if (freezeUsedApp) {
                state.streak.study.lastDate = yesterday.toDateString(); // Automatically protect if freeze was used
            } else if (state.gamification.streakFreezes > 0) {
                state.gamification.streakFreezes--;
                showToast('Streak Freeze used for Study Streak!', 'info');
                state.streak.study.lastDate = yesterday.toDateString();
                Storage.setKey('studyplanner_gamification', state.gamification);
            } else {
                state.streak.study.current = 0; 
            }
        }
    }
    
    if(!state.analytics.daysActive[today]) {
        state.analytics.daysActive[today] = { tasksDone: 0, studySeconds: 0 };
    }
    Storage.setKey('studyplanner_analytics', state.analytics);
    Storage.setKey('studyplanner_streak', state.streak);
    
    updateStreakUI();
    checkMilestones(); // Gamification Badges
}

function checkMilestones() {
    const milestones = [3, 7, 15, 30, 100];
    const msMap = {
        3: { id: 'streak_3', name: '3-Day Streak', xp: 50, coins: 20 },
        7: { id: 'streak_7', name: '1 Week Streak', xp: 150, coins: 50 },
        15: { id: 'streak_15', name: '15-Day Streak', xp: 300, coins: 100 },
        30: { id: 'streak_30', name: '1 Month Streak', xp: 500, coins: 200 },
        100: { id: 'streak_100', name: '100-Day Streak', xp: 2000, coins: 1000 }
    };
    
    milestones.forEach(m => {
        if (state.streak.app.current === m || state.streak.study.current === m) {
            const data = msMap[m];
            if (!state.gamification.badges.includes(data.id)) {
                state.gamification.badges.push(data.id);
                addXP(data.xp, `Milestone Reached!`);
                addCoins(data.coins, `Milestone Reached!`);
                Storage.setKey('studyplanner_gamification', state.gamification);
                showAchievementModal(data.name, 'fa-fire');
            }
        }
    });
}

function incrementStudyStreak() {
    const today = new Date().toDateString();
    if (state.streak.study.lastDate !== today) {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        if (state.streak.study.lastDate === yesterday.toDateString()) state.streak.study.current += 1;
        else state.streak.study.current = 1;
        
        state.streak.study.lastDate = today;
        if (state.streak.study.current > state.streak.study.best) state.streak.study.best = state.streak.study.current;
        Storage.setKey('studyplanner_streak', state.streak);
        updateStreakUI();
        showToast('Study streak extended! 🔥', 'success');
        addXP(10, 'Streak Maintained');
        checkMilestones();
        showConfetti();
        playCelebrationSound();
    }
}

function incrementTaskStreak() {
    const today = new Date().toDateString();
    if (state.streak.app.lastDate !== today) {
        state.streak.app.current += 1;
        state.streak.app.lastDate = today;
        if (state.streak.app.current > state.streak.app.best) state.streak.app.best = state.streak.app.current;
        Storage.setKey('studyplanner_streak', state.streak);
        updateStreakUI();
        showToast('Task streak extended! ⚡', 'success');
        addXP(15, 'Task Streak Maintained');
        checkMilestones();
        showConfetti();
        playCelebrationSound();
    }
}

function updateDashboardDate() {
    const dE = document.getElementById('current-date-time');
    const gE = document.getElementById('greeting-text');
    setInterval(() => {
        const now = new Date();
        dE.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const hr = now.getHours();
        gE.textContent = hr < 12 ? 'Good morning!' : hr < 18 ? 'Good afternoon!' : 'Good evening!';
    }, 1000);
}

function getSafeAnalyticsDataForToday() {
    const today = new Date().toDateString();
    if(!state.analytics.daysActive[today]) {
        state.analytics.daysActive[today] = { tasksDone: 0, studySeconds: 0 };
    }
    return state.analytics.daysActive[today];
}

function updateDashboard() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0,0,0,0);
    
    let weeklyTasksDone = 0;
    let weeklyStudySeconds = 0;
    
    for(let i=0; i<7; i++) {
        const d = new Date(startOfWeek); d.setDate(d.getDate() + i);
        const daily = state.analytics.daysActive[d.toDateString()];
        if (daily) {
            weeklyTasksDone += daily.tasksDone || 0;
            weeklyStudySeconds += daily.studySeconds || 0;
        }
    }

    const pending = state.tasks.filter(t => !t.completed).length;
    
    document.getElementById('dash-completed-tasks').textContent = weeklyTasksDone;
    document.getElementById('dash-pending-tasks').textContent = pending;
    
    const studyHours = Math.floor(weeklyStudySeconds / 3600);
    const studyMins = Math.floor((weeklyStudySeconds % 3600) / 60);
    document.getElementById('dash-study-hours').textContent = `${studyHours}h ${studyMins}m`;
    
    const productivity = (weeklyTasksDone + pending === 0) ? 0 : Math.round((weeklyTasksDone / (weeklyTasksDone + pending)) * 100);
    document.getElementById('dash-productivity').textContent = `${productivity}%`;
    
    const upcomingContainer = document.getElementById('dashboard-task-list');
    upcomingContainer.replaceChildren();
    const upcomingTasks = state.tasks.filter(t => !t.completed).slice(0, 3);
    if(upcomingTasks.length === 0) upcomingContainer.appendChild(createElement('p', 'empty-state', { textContent: "No upcoming tasks." }));
    else upcomingTasks.forEach(task => upcomingContainer.appendChild(createTaskElement(task, true)));
    renderChart();
}

let currentChartPeriod = 'weekly';

function renderChart() {
    const container = document.getElementById('analytics-chart-container');
    if (!container) return; // Safeguard
    container.replaceChildren();
    const today = new Date();
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    
    let labelFunc = (d) => days[d.getDay()];
    let dataFunc = (d) => Math.floor((state.analytics.daysActive[d.toDateString()]?.studySeconds || 0) / 60);
    let labelSuffix = 'm';

    let maxData = 60; 
    const chartData = [];
    
    if (currentChartPeriod === 'weekly') {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        for (let i = 0; i < 7; i++) {
            const d = new Date(startOfWeek);
            d.setDate(startOfWeek.getDate() + i);
            const val = dataFunc(d);
            if (val > maxData) maxData = val;
            chartData.push({ val, label: labelFunc(d), suffix: labelSuffix });
        }
    } else if (currentChartPeriod === 'monthly') {
        for(let i=3; i>=0; i--) {
            const d = new Date(today); d.setDate(today.getDate() - (i * 7));
            let totalMins = 0;
            for(let j=0; j<7; j++) {
                const tempD = new Date(d); tempD.setDate(tempD.getDate() - j);
                totalMins += Math.floor((state.analytics.daysActive[tempD.toDateString()]?.studySeconds || 0) / 60);
            }
            if (totalMins > maxData) maxData = totalMins;
            chartData.push({ val: totalMins, label: `W${4-i}`, suffix: labelSuffix });
        }
    }

    chartData.forEach(item => {
        const heightPercent = Math.max(Math.min((item.val / Math.max(maxData, 1)) * 100, 100), 5);
        const wrapper = createElement('div', 'chart-bar-wrapper');
        const bar = createElement('div', 'chart-bar');
        
        setTimeout(() => bar.style.height = `${heightPercent}%`, 50);
        
        bar.setAttribute('data-value', `${item.val}${item.suffix}`);
        wrapper.appendChild(bar);
        wrapper.appendChild(createElement('span', 'chart-label', { textContent: item.label }));
        container.appendChild(wrapper);
    });
}

let draggedTaskId = null;

function initTasks() {
    const modal = document.getElementById('task-modal');
    const form = document.getElementById('task-form');
    const openModal = () => modal.classList.add('active');
    const closeModal = () => { modal.classList.remove('active'); form.reset(); document.getElementById('task-id').value = ''; };

    document.getElementById('add-task-btn').addEventListener('click', openModal);
    document.getElementById('close-task-modal').addEventListener('click', closeModal);
    document.getElementById('cancel-task-btn').addEventListener('click', closeModal);
    
    form.addEventListener('submit', (e) => { e.preventDefault(); saveTask(); closeModal(); });
    document.getElementById('task-search').addEventListener('input', renderTasks);
    document.getElementById('filter-priority').addEventListener('change', renderTasks);
    document.getElementById('filter-status').addEventListener('change', renderTasks);
    renderTasks();
}

function saveTask() {
    const idField = document.getElementById('task-id').value;
    const title = document.getElementById('task-title').value.trim();
    const subject = document.getElementById('task-subject').value.trim() || 'General';
    const priority = document.getElementById('task-priority').value;
    const deadline = document.getElementById('task-deadline').value;

    if (!title) return;
    if (idField) {
        const task = state.tasks.find(t => t.id === idField);
        if(task) { task.title = sanitizeInput(title); task.subject = sanitizeInput(subject); task.priority = priority; task.deadline = deadline; showToast('Task updated', 'success'); }
    } else {
        state.tasks.push({ id: 'task_' + Date.now(), title: sanitizeInput(title), subject: sanitizeInput(subject), priority, deadline, completed: false });
        showToast('Task created', 'success');
    }
    Storage.setKey('studyplanner_tasks', state.tasks);
    renderTasks(); updateDashboard();
}

function toggleTaskStatus(id) {
    const task = state.tasks.find(t => t.id === id);
    if(task) {
        task.completed = !task.completed;
        const todayData = getSafeAnalyticsDataForToday();
        if(task.completed) {
            task.completedAt = new Date().toDateString();
            todayData.tasksDone += 1;
            incrementTaskStreak();
            addXP(20, 'Task Completed');
            addCoins(5, 'Task Reward');
            updateChallenge('c_tasks', 1);
        } else {
            if (task.completedAt) {
                const dayData = state.analytics.daysActive[task.completedAt];
                if (dayData && dayData.tasksDone > 0) dayData.tasksDone--;
                delete task.completedAt;
            } else {
                todayData.tasksDone = Math.max(0, todayData.tasksDone - 1);
            }
        }
        Storage.setKey('studyplanner_analytics', state.analytics);
        Storage.setKey('studyplanner_tasks', state.tasks);
        renderTasks(); updateDashboard();
    }
}

function editTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if(task) {
        document.getElementById('task-id').value = task.id; document.getElementById('task-title').value = task.title;
        document.getElementById('task-subject').value = task.subject; document.getElementById('task-priority').value = task.priority;
        document.getElementById('task-deadline').value = task.deadline || '';
        document.getElementById('modal-title').textContent = 'Edit Task';
        document.getElementById('task-modal').classList.add('active');
    }
}

function deleteTask(id) {
    if(confirm('Delete this task?')) {
        const task = state.tasks.find(t => t.id === id);
        if (task && task.completed && task.completedAt) {
            const dayData = state.analytics.daysActive[task.completedAt];
            if (dayData && dayData.tasksDone > 0) dayData.tasksDone--;
            Storage.setKey('studyplanner_analytics', state.analytics);
        }
        state.tasks = state.tasks.filter(t => t.id !== id);
        Storage.setKey('studyplanner_tasks', state.tasks);
        showToast('Task deleted', 'info'); renderTasks(); updateDashboard();
    }
}

function createTaskElement(task, isDashboard = false) {
    const el = createElement('div', ['task-item', `priority-${task.priority}`, task.completed ? 'completed' : '']);
    el.setAttribute('data-id', task.id);
    if(!isDashboard) {
        el.draggable = true;
        el.addEventListener('dragstart', (e) => { draggedTaskId = task.id; e.dataTransfer.effectAllowed = 'move'; el.style.opacity = '0.5'; });
        el.addEventListener('dragend', () => { draggedTaskId = null; el.style.opacity = '1'; });
    }
    const info = createElement('div', 'task-info');
    const cb = createElement('input', 'custom-checkbox'); cb.type = 'checkbox'; cb.checked = task.completed;
    cb.addEventListener('change', () => toggleTaskStatus(task.id));
    const content = createElement('div', 'task-content');
    content.appendChild(createElement('h4', 'task-title', { textContent: task.title }));
    const meta = createElement('div', 'task-meta');
    meta.appendChild(createElement('span', ['badge', task.priority], { textContent: task.priority }));
    meta.appendChild(createElement('span', ['badge', 'subject'], { textContent: task.subject }));
    if(task.deadline) meta.appendChild(createElement('span', ['badge'], { textContent: `Due: ${task.deadline}` }));
    content.appendChild(meta); info.appendChild(cb); info.appendChild(content); el.appendChild(info);

    if (!isDashboard) {
        const actions = createElement('div', 'task-actions');
        const editBtn = createElement('button', 'btn-icon'); editBtn.appendChild(createElement('i', ['fa-solid', 'fa-pen']));
        editBtn.addEventListener('click', () => editTask(task.id));
        const delBtn = createElement('button', ['btn-icon', 'warning']); delBtn.appendChild(createElement('i', ['fa-solid', 'fa-trash']));
        delBtn.addEventListener('click', () => deleteTask(task.id));
        actions.appendChild(editBtn); actions.appendChild(delBtn); el.appendChild(actions);
    }
    return el;
}

function renderTasks() {
    const container = document.getElementById('main-task-list'); container.replaceChildren();
    const searchT = document.getElementById('task-search').value.toLowerCase();
    const filterP = document.getElementById('filter-priority').value;
    const filterS = document.getElementById('filter-status').value;
    
    let filtered = state.tasks.filter(t => {
        return (t.title.toLowerCase().includes(searchT) || t.subject.toLowerCase().includes(searchT)) &&
               (filterP === 'all' || t.priority === filterP) &&
               (filterS === 'all' || (filterS === 'completed' ? t.completed : !t.completed));
    });

    document.getElementById('task-view-count').textContent = filtered.length;
    if (filtered.length === 0) return container.appendChild(createElement('p', 'empty-state', { textContent: "No tasks found." }));
    
    filtered.forEach(task => container.appendChild(createTaskElement(task)));

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = [...container.querySelectorAll('.task-item:not(.dragging)')].reduce((closest, child) => {
            const box = child.getBoundingClientRect(); const offset = e.clientY - box.top - box.height / 2;
            return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
        const dragEl = document.querySelector(`[data-id='${draggedTaskId}']`);
        if (dragEl) afterElement == null ? container.appendChild(dragEl) : container.insertBefore(dragEl, afterElement);
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault(); if(!draggedTaskId) return;
        const newIds = Array.from(container.querySelectorAll('.task-item')).map(el => el.getAttribute('data-id'));
        const sorted = newIds.map(id => state.tasks.find(x => x.id === id));
        state.tasks.forEach(t => { if(!newIds.includes(t.id)) sorted.push(t); });
        state.tasks = sorted; Storage.setKey('studyplanner_tasks', state.tasks);
    });
}

// POMODORO TIMER
let timerInterval = null;
let currentTimerMode = 'pomodoro';
const timerDurations = { pomodoro: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60 };
let currentTimerSeconds = timerDurations.pomodoro;
let isTimerRunning = false;

function initPomodoro() {
    updateTimerDisplay();
    document.querySelectorAll('.timer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if(isTimerRunning && !confirm('Timer running. Switch?')) return;
            document.querySelectorAll('.timer-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            pauseTimer(); currentTimerMode = tab.getAttribute('data-mode');
            currentTimerSeconds = timerDurations[currentTimerMode]; updateTimerDisplay();
        });
    });
    document.getElementById('timer-start').addEventListener('click', startTimer);
    document.getElementById('timer-pause').addEventListener('click', pauseTimer);
    document.getElementById('timer-reset').addEventListener('click', () => { pauseTimer(); currentTimerSeconds = timerDurations[currentTimerMode]; updateTimerDisplay(); });
}

function startTimer() {
    if (isTimerRunning) return;
    isTimerRunning = true;
    document.getElementById('timer-start').style.display = 'none'; document.getElementById('timer-pause').style.display = 'inline-flex';
    const exactEndTime = Date.now() + currentTimerSeconds * 1000;

    timerInterval = setInterval(() => {
        const remaining = Math.round((exactEndTime - Date.now()) / 1000);
        if (remaining <= 0) {
            pauseTimer(); currentTimerSeconds = 0; updateTimerDisplay(); showToast('Session Completed!', 'success');
            if(currentTimerMode === 'pomodoro') {
                state.analytics.totalStudySeconds += timerDurations.pomodoro;
                getSafeAnalyticsDataForToday().studySeconds += timerDurations.pomodoro;
                Storage.setKey('studyplanner_analytics', state.analytics); updateDashboard();
                incrementStudyStreak();
                addXP(50, 'Pomodoro Completed');
                addCoins(10, 'Focus Reward');
                updateChallenge('c_study', Math.round(timerDurations.pomodoro / 60));
            }
            return playSound();
        }
        currentTimerSeconds = remaining; updateTimerDisplay();
    }, 1000);
}

function pauseTimer() { isTimerRunning = false; clearInterval(timerInterval); document.getElementById('timer-start').style.display = 'inline-flex'; document.getElementById('timer-pause').style.display = 'none'; }
function updateTimerDisplay() {
    const display = document.getElementById('timer-time'); const circle = document.querySelector('.progress-ring__circle');
    display.textContent = `${Math.floor(currentTimerSeconds / 60).toString().padStart(2, '0')}:${(currentTimerSeconds % 60).toString().padStart(2, '0')}`;
    const circumference = 120 * 2 * Math.PI;
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    circle.style.strokeDashoffset = circumference - (currentTimerSeconds / timerDurations[currentTimerMode]) * circumference;
}
function playSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(500, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(1, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 1);
}

// CALENDAR
let currentMonth = new Date().getMonth(); let currentYear = new Date().getFullYear();
function renderCalendar() {
    const grid = document.getElementById('calendar-grid'); grid.replaceChildren();
    document.getElementById('calendar-month-year').textContent = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][currentMonth]} ${currentYear}`;
    const firstDay = new Date(currentYear, currentMonth, 1).getDay(); const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    for(let i=0; i < firstDay; i++) grid.appendChild(createElement('div', ['calendar-day', 'empty']));
    for(let i=1; i <= daysInMonth; i++) {
        const d = new Date(currentYear, currentMonth, i); const dayEl = createElement('div', 'calendar-day', { textContent: i });
        if (d.toDateString() === new Date().toDateString()) dayEl.classList.add('today');
        
        const dayData = state.analytics.daysActive[d.toDateString()];
        if (dayData && dayData.tasksDone > 0) {
            if (dayData.tasksDone >= 5) dayEl.classList.add('heatmap-4');
            else if (dayData.tasksDone >= 3) dayEl.classList.add('heatmap-3');
            else if (dayData.tasksDone >= 1) dayEl.classList.add('heatmap-2');
        }
        
        if(state.tasks.some(t => t.deadline === `${currentYear}-${(currentMonth+1).toString().padStart(2,'0')}-${i.toString().padStart(2,'0')}`)) {
            dayEl.classList.add('has-tasks'); dayEl.appendChild(createElement('div', 'day-indicator'));
        }
        grid.appendChild(dayEl);
    }
}
document.getElementById('prev-month').addEventListener('click', () => { currentYear = currentMonth===0?currentYear-1:currentYear; currentMonth=currentMonth===0?11:currentMonth-1; renderCalendar(); });
document.getElementById('next-month').addEventListener('click', () => { currentYear = currentMonth===11?currentYear+1:currentYear; currentMonth=currentMonth===11?0:currentMonth+1; renderCalendar(); });

function initNotes() {
    const ta = document.getElementById('quick-notes'); const st = document.getElementById('notes-save-status'); let to = null;
    ta.value = state.notes;
    ta.addEventListener('input', () => {
        st.style.opacity = '1'; st.textContent = 'Saving...'; clearTimeout(to);
        to = setTimeout(() => {
            state.notes = sanitizeInput(ta.value); Storage.setKey('studyplanner_notes', state.notes);
            st.textContent = 'Saved'; setTimeout(() => { st.style.opacity = '0'; }, 2000);
        }, 1000);
    });
}

// HEALTH & FITNESS
function getSafeHealthDataForToday() {
    const today = new Date().toDateString();
    if(!state.health[today]) {
        state.health[today] = { water: 0, consumedCalories: 0, workouts: [] };
    }
    return state.health[today];
}

function updateHealthUI() {
    if(!document.getElementById('cal-intake')) return;
    const todayHealth = getSafeHealthDataForToday();
    
    document.getElementById('cal-intake').textContent = todayHealth.consumedCalories;
    let burned = 0;
    todayHealth.workouts.forEach(w => burned += w.calories);
    document.getElementById('cal-burned').textContent = burned;
    
    const goal = 2000;
    const remaining = goal - todayHealth.consumedCalories + burned;
    document.getElementById('cal-remaining').textContent = remaining;
    
    document.getElementById('water-count').textContent = todayHealth.water;
    const waterTracker = document.getElementById('water-tracker');
    waterTracker.replaceChildren();
    for (let i = 0; i < 8; i++) {
        const cup = createElement('div', 'water-cup');
        if (i < todayHealth.water) cup.classList.add('filled');
        cup.addEventListener('click', () => {
            if(cup.classList.contains('filled')) return;
            const health = getSafeHealthDataForToday();
            if(health.water < 8) {
                health.water += 1;
                Storage.setKey('studyplanner_health', state.health);
                updateHealthUI();
                updateChallenge('c_water', 1);
            }
        });
        waterTracker.appendChild(cup);
    }
    
    const workoutList = document.getElementById('workout-history-list');
    workoutList.replaceChildren();
    if (todayHealth.workouts.length === 0) {
        workoutList.appendChild(createElement('p', 'empty-state', { textContent: "No workouts logged today." }));
    } else {
        const icons = { cardio: 'fa-heart-pulse', yoga: 'fa-om', running: 'fa-person-running', strength: 'fa-dumbbell' };
        todayHealth.workouts.forEach(w => {
            const item = createElement('div', 'workout-item');
            const iconWrap = createElement('div', 'workout-icon');
            iconWrap.appendChild(createElement('i', ['fa-solid', icons[w.category] || 'fa-fire']));
            const details = createElement('div', 'workout-details');
            details.appendChild(createElement('h4', '', { textContent: w.category.charAt(0).toUpperCase() + w.category.slice(1) }));
            details.appendChild(createElement('small', '', { textContent: `${w.duration} mins` }));
            const cals = createElement('div', 'workout-cals', { textContent: `${w.calories} kcal` });
            
            item.appendChild(iconWrap);
            item.appendChild(details);
            item.appendChild(cals);
            workoutList.appendChild(item);
        });
    }
}

function initHealth() {
    if(!document.getElementById('add-food-btn')) return;
    document.getElementById('add-food-btn').addEventListener('click', () => {
        const input = document.getElementById('food-cal-input');
        const cals = parseInt(input.value);
        if (cals && cals > 0) {
            const health = getSafeHealthDataForToday();
            health.consumedCalories += cals;
            Storage.setKey('studyplanner_health', state.health);
            input.value = '';
            showToast(`Added ${cals} kcal`, 'success');
            updateHealthUI();
        }
    });

    document.getElementById('add-workout-btn').addEventListener('click', () => {
        const category = document.getElementById('workout-category').value;
        const duration = parseInt(document.getElementById('workout-duration').value);
        if (duration && duration > 0) {
            const rates = { cardio: 10, yoga: 4, running: 12, strength: 8 };
            const calories = duration * (rates[category] || 5);
            const health = getSafeHealthDataForToday();
            health.workouts.push({ category, duration, calories });
            Storage.setKey('studyplanner_health', state.health);
            document.getElementById('workout-duration').value = '';
            showToast(`Logged ${duration} min ${category}`, 'success');
            updateHealthUI();
            addXP(30, 'Workout Completed');
            addCoins(5, 'Fitness Reward');
            updateChallenge('c_burn', calories);
        }
    });
    
    document.getElementById('reset-daily-health-btn').addEventListener('click', () => {
        if(confirm("Reset today's health data?")) {
            const today = new Date().toDateString();
            state.health[today] = { water: 0, consumedCalories: 0, workouts: [] };
            Storage.setKey('studyplanner_health', state.health);
            updateHealthUI();
            showToast('Health data reset', 'info');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    applyActiveTheme(); initTheme(); initNavigation(); checkAndGenerateChallenges(); initStreak(); updateDashboardDate(); updateDashboard();
    initTasks(); initPomodoro(); renderCalendar(); initNotes();
    initHealth(); updateHealthUI(); updateGamificationUI();
    document.querySelectorAll('.chart-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.chart-toggle').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentChartPeriod = e.target.getAttribute('data-period');
            // update chart title text gracefully
            document.getElementById('chart-title').textContent = e.target.textContent + ' Progress';
            renderChart();
        });
    });
});
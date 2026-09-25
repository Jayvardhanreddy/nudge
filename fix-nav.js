const fs = require('fs');

const navBlock = `  <nav class="app-nav" aria-label="Main Navigation">
    <a href="dashboard.html" data-nav="dashboard"><span class="nav-icon">🏠</span><span>Home</span></a>
    <a href="instagram-accounts.html" data-nav="instagram"><span class="nav-icon">📸</span><span>Instagram Accounts</span></a>
    <a href="automations.html" data-nav="automations"><span class="nav-icon">⚙️</span><span>Automations</span></a>
    <a href="creator-tools.html" data-nav="creator-tools"><span class="nav-icon">✨</span><span>Creator Studio AI</span></a>
    <a href="analytics.html" data-nav="analytics"><span class="nav-icon">📊</span><span>Analytics</span></a>
    <a href="messages.html" data-nav="messages"><span class="nav-icon">💌</span><span>DM Log</span></a>
    <a href="settings.html" data-nav="settings"><span class="nav-icon">👤</span><span>Settings</span></a>
    <a href="help.html" data-nav="help"><span class="nav-icon">💬</span><span>Help Desk</span></a>
  </nav>`;

const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/<nav class="app-nav"[^>]*>[\s\S]*?<\/nav>/, navBlock);
  fs.writeFileSync(file, content, 'utf8');
}
console.log('Fixed nav bars in ' + files.length + ' files.');

// Shared sample data + helpers for the design prototypes. Same bookmarks as the
// dev mock, plus fake "preview" metadata (description, brand colour, last visit)
// standing in for what the real build would fetch (og: tags, chrome.history).
window.FH = (() => {
  const l = (title, url, color, desc) => ({ title, url, color, desc });
  const f = (title, items) => ({ title, items });

  const pinned = [
    l('Gmail', 'https://mail.google.com/', '#ea4335', 'Email from Google. 15 GB of storage, less spam, and mobile access.'),
    l('Calendar', 'https://calendar.google.com/', '#1a73e8', 'Schedule events, set reminders and share calendars.'),
    l('GitHub', 'https://github.com/', '#8b5cf6', 'Where the world builds software. Repos, PRs, Actions.'),
    l('YouTube', 'https://www.youtube.com/', '#ff0033', 'Enjoy the videos and music you love.'),
    l('Reddit', 'https://www.reddit.com/', '#ff4500', 'Dive into anything. Communities for every interest.'),
    l('Gemini', 'https://gemini.google.com/', '#4f8cff', "Google's AI assistant for writing, planning and learning."),
  ];

  const cards = [
    f('Work', [
      l('Outlook', 'https://outlook.office.com/mail/', '#0f6cbd', 'Microsoft 365 mail, calendar and contacts.'),
      l('Teams', 'https://teams.microsoft.com/', '#5b5fc7', 'Chat, meetings and collaboration for your team.'),
      l('SharePoint', 'https://www.office.com/launch/sharepoint', '#038387', 'Intranet sites, documents and team spaces.'),
      l('Azure DevOps', 'https://dev.azure.com/', '#0078d4', 'Boards, repos, pipelines and test plans.'),
      l('Azure Portal', 'https://portal.azure.com/', '#0089d6', 'Build, manage and monitor your Azure resources.'),
      f('Docs', [
        l('Microsoft Learn', 'https://learn.microsoft.com/', '#2f2f2f', 'Documentation, training and certifications.'),
        l('Confluence', 'https://www.atlassian.com/software/confluence', '#1868db', 'Team workspace for knowledge and docs.'),
      ]),
    ]),
    f('Dev', [
      l('MDN Web Docs', 'https://developer.mozilla.org/', '#83d0f2', 'Resources for developers, by developers.'),
      l('Stack Overflow', 'https://stackoverflow.com/', '#f48024', 'Where developers learn, share and build careers.'),
      l('Svelte', 'https://svelte.dev/docs', '#ff3e00', 'Cybernetically enhanced web apps.'),
      l('Vite', 'https://vite.dev/', '#a855f7', 'Next generation frontend tooling.'),
      l('Can I use', 'https://caniuse.com/', '#d96b29', 'Browser support tables for HTML, CSS and JS.'),
      l('npm', 'https://www.npmjs.com/', '#cb3837', 'The package registry for JavaScript.'),
      l('Regex101', 'https://regex101.com/', '#2a9d8f', 'Online regex tester and debugger.'),
      f('Tools', [
        l('JSON Crack', 'https://jsoncrack.com/', '#e11d48', 'Visualise JSON as interactive graphs.'),
        l('Excalidraw', 'https://excalidraw.com/', '#6965db', 'Virtual whiteboard for hand-drawn diagrams.'),
        l('Squoosh', 'https://squoosh.app/', '#ff4fa3', 'Make images smaller in the browser.'),
      ]),
    ]),
    f('News', [
      l('BBC News', 'https://www.bbc.co.uk/news', '#bb1919', 'UK and world news, analysis and live coverage.'),
      l('The Verge', 'https://www.theverge.com/', '#e5127d', 'Technology, science, art and culture.'),
      l('Hacker News', 'https://news.ycombinator.com/', '#ff6600', 'Links for the intellectually curious.'),
      l('Ars Technica', 'https://arstechnica.com/', '#ff4e00', 'Serving the technologist since 1998.'),
      l('The Guardian', 'https://www.theguardian.com/uk', '#052962', 'Independent journalism.'),
    ]),
    f('Reading', [
      l('Vivaldi Blog', 'https://vivaldi.com/blog/', '#ef3939', 'News and stories from the Vivaldi team.'),
      l('CSS-Tricks', 'https://css-tricks.com/', '#f7b733', 'Tips, tricks and techniques on using CSS.'),
      l('Smashing Magazine', 'https://www.smashingmagazine.com/', '#e85c33', 'For web designers and developers.'),
    ]),
    f('Home', [
      l('Amazon', 'https://www.amazon.co.uk/', '#ff9900', 'Shop online for everything.'),
      l('BBC Weather', 'https://www.bbc.co.uk/weather', '#1a8fd1', 'Forecasts for thousands of places.'),
      l('Netflix', 'https://www.netflix.com/', '#e50914', 'Watch TV shows and movies online.'),
      l('Spotify', 'https://open.spotify.com/', '#1ed760', 'Music for everyone.'),
      l('Google Maps', 'https://maps.google.com/', '#34a853', 'Find local businesses, view maps and get directions.'),
    ]),
  ];

  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  const favicon = (u, size = 32) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(u))}&sz=${size}`;
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const visited = (u) => ['Visited just now', 'Visited 12 min ago', 'Visited 2 h ago', 'Visited yesterday', 'Visited 3 days ago', 'Visited last week'][hash(u) % 6];
  const visits = (u) => 3 + (hash(u) % 140);
  const count = (items) => items.reduce((n, i) => n + (i.items ? count(i.items) : 1), 0);
  const isFolder = (i) => !!i.items;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function greeting(name = 'Joe') {
    const h = new Date().getHours();
    const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return `${part}, ${name}`;
  }

  /** Calls render(now) every second, on the second. */
  function tick(render) {
    const run = () => {
      render(new Date());
      setTimeout(run, 1000 - (Date.now() % 1000) + 5);
    };
    run();
  }

  /** rAF loop that sleeps while the tab is hidden (a new-tab page lives in the background a lot). */
  function loop(frame) {
    let last = performance.now();
    let id = 0;
    const step = (t) => {
      const dt = Math.min(50, t - last);
      last = t;
      frame(t, dt);
      id = requestAnimationFrame(step);
    };
    const start = () => {
      last = performance.now();
      id = requestAnimationFrame(step);
    };
    document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(id) : start()));
    start();
  }

  /**
   * A tiny stylised "page" in the site's colour, used as the preview image.
   * The real build would show the page's og:image where it has one.
   */
  function skeleton(link, variant = 'dark') {
    const c = link.color || '#888';
    const ink = variant === 'dark' ? 'rgba(255,255,255,' : 'rgba(0,0,0,';
    return `
      <div class="skel" style="--c:${c}">
        <div class="skel-bar"><i></i><i></i><i></i><span></span></div>
        <div class="skel-body">
          <img src="${favicon(link.url, 64)}" alt="" width="40" height="40">
          <div class="skel-lines">
            <b style="background:${ink}.55)"></b><b style="background:${ink}.3);width:70%"></b><b style="background:${ink}.2);width:85%"></b>
          </div>
        </div>
        <div class="skel-tiles"><u></u><u></u><u></u></div>
      </div>`;
  }

  return { pinned, cards, host, favicon, hash, visited, visits, count, isFolder, reduced, esc, greeting, tick, loop, skeleton };
})();

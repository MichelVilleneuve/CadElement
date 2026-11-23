/* Carousel used by generated detail pages: new Carousel('projectCarousel') */
class Carousel {
  constructor(id) {
    this.root = document.getElementById(id);
    if (!this.root) return;
    this.slides = [...this.root.querySelectorAll('.carousel-slide')];
    this.counter = this.root.querySelector('.carousel-counter');
    this.i = 0;
    this.root.querySelector('.carousel-prev').addEventListener('click', () => this.go(this.i - 1));
    this.root.querySelector('.carousel-next').addEventListener('click', () => this.go(this.i + 1));
    this.go(0);
  }
  go(n) {
    const c = this.slides.length;
    if (!c) return;
    this.i = (n + c) % c;
    this.slides.forEach((s, k) => s.classList.toggle('active', k === this.i));
    if (this.counter) this.counter.textContent = `${this.i + 1} of ${c}`;
  }
}

/* Home page: read projects.json, then each project's own json */
async function loadProjects() {
  const grid = document.getElementById('grid');
  const filters = document.getElementById('filters');
  const empty = document.getElementById('empty');
  let list = [];
  try {
    const manifest = await (await fetch('projects.json')).json();
    const all = await Promise.all(manifest.projects.map(f =>
      fetch(`projects/${f}/${f}.json`).then(r => r.json()).catch(() => null)));
    list = all.filter(Boolean).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } catch (e) { /* no manifest yet */ }

  empty.hidden = list.length > 0;
  const types = [...new Set(list.map(p => p.type))];
  let active = 'All';

  function draw() {
    grid.replaceChildren();
    filters.replaceChildren();
    ['All', ...types].forEach(t => {
      if (types.length < 2) return;
      const b = document.createElement('button');
      b.className = 'chip' + (t === active ? ' on' : '');
      b.textContent = t;
      b.onclick = () => { active = t; draw(); };
      filters.append(b);
    });
    list.filter(p => active === 'All' || p.type === active).forEach(p => {
      const a = document.createElement('a');
      a.className = 'card';
      a.href = `projects/${p.folder}/`;
      const shot = document.createElement('div');
      shot.className = 'shot';
      const img = document.createElement('img');
      const dir = `projects/${p.folder}/screenshots/`;
      img.src = dir + (p.thumbnail || p.screenshots[0]);
      img.alt = p.name;
      img.onerror = () => { if (p.screenshots[0] && !img.src.endsWith(p.screenshots[0])) img.src = dir + p.screenshots[0]; };
      shot.append(img);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const label = document.createElement('span');
      label.textContent = [p.type, ...(p.tech || []).slice(0, 2)].join(' · ');
      const arrow = document.createElement('span');
      arrow.textContent = '↗';
      meta.append(label, arrow);
      const h = document.createElement('h3'); h.textContent = p.name;
      const d = document.createElement('p'); d.textContent = p.description;
      a.append(shot, meta, h, d);
      grid.append(a);
    });
  }
  draw();
}

/* STEP viewer for detail pages. Everything loads only when the visitor clicks "View in 3D".
   Libraries are hosted in ./vendor (three.js r140, occt-import-js 0.0.23). */
const StepViewer = (() => {
  const BASE = (typeof document !== 'undefined' && document.currentScript)
    ? document.currentScript.src.replace(/[^/]*$/, '') : '';
  const VENDOR = BASE + 'vendor/';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(s);
    });
  }

  /* Read the STEP file in a background worker so the page stays responsive */
  function readStep(bytes) {
    return new Promise((resolve, reject) => {
      const w = new Worker(VENDOR + 'occt-import-js-worker.js');
      w.onmessage = ev => {
        w.terminate();
        (ev.data && ev.data.success) ? resolve(ev.data) : reject(new Error('This STEP file could not be read.'));
      };
      w.onerror = () => { w.terminate(); reject(new Error('The STEP reader could not start.')); };
      w.postMessage({ format: 'step', buffer: bytes, params: null }, [bytes.buffer]);
    });
  }

  /* One Group per STEP part (mesh + edges), so a whole part can be hidden at once */
  function buildModel(THREE, result) {
    const group = new THREE.Group();
    for (const m of result.meshes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.index.array), 1));
      if (!m.attributes.normal) g.computeVertexNormals();
      const color = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0x9aa7b8);
      const part = new THREE.Group();
      part.name = m.name || '';
      part.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.65, side: THREE.DoubleSide })));
      part.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })));
      group.add(part);
    }
    return group;
  }

  /* Group parts for the Parts list.
     custom (optional) = { "Joists": ["joist"], "Studs": ["stud"] }  -> a part joins the first group
     whose keyword appears in its name. Everything else is grouped by the first word of its name. */
  function groupParts(model, custom) {
    const rules = custom
      ? Object.entries(custom).map(([label, kws]) => ({ label, kws: (kws || []).map(k => String(k).toLowerCase()) }))
      : [];
    const groups = new Map();
    for (const part of model.children) {
      const name = (part.name || '').trim();
      const lower = name.toLowerCase();
      const rule = rules.find(r => r.kws.some(k => k && lower.includes(k)));
      let label;
      if (rule) {
        label = rule.label;
      } else {
        const word = (name.split(/[\s_\-:.]+/)[0] || '').replace(/\d+$/, '');
        label = word ? word.charAt(0).toUpperCase() + word.slice(1) : 'Other';
      }
      const key = label.toLowerCase();
      if (!groups.has(key)) groups.set(key, { label, parts: [] });
      groups.get(key).parts.push(part);
    }
    return [...groups.values()];
  }

  /* Collapsible "Parts" panel with one checkbox per group */
  function buildPanel(box, groups, render) {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;top:10px;left:10px;max-height:calc(100% - 50px);overflow:auto;min-width:180px;' +
      'font-size:13px;color:var(--text,#222);background:var(--bg,#fff);border:1px solid var(--line,#ccc);border-radius:6px;';
    const head = document.createElement('button');
    head.type = 'button';
    head.style.cssText = 'display:block;width:100%;text-align:left;padding:7px 10px;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer;';
    const body = document.createElement('div');
    body.style.cssText = 'padding:0 10px 8px;';
    let open = box.clientWidth >= 560;                 // start collapsed on small screens
    const sync = () => { body.hidden = !open; head.textContent = (open ? '▾ ' : '▸ ') + 'Parts'; };
    head.onclick = () => { open = !open; sync(); };

    const rows = [];
    const setAll = on => {
      rows.forEach(r => { r.cb.checked = on; r.g.parts.forEach(p => { p.visible = on; }); });
      render();
    };
    const tools = document.createElement('div');
    tools.style.cssText = 'display:flex;gap:6px;margin:2px 0 6px;';
    [['Show all', true], ['Hide all', false]].forEach(([text, on]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = 'flex:1;padding:3px 6px;font:inherit;font-size:12px;cursor:pointer;color:inherit;background:transparent;border:1px solid var(--line,#ccc);border-radius:4px;';
      b.onclick = () => setAll(on);
      tools.append(b);
    });
    body.append(tools);

    groups.forEach(g => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.style.accentColor = 'var(--accent,#185FA5)';
      cb.onchange = () => { g.parts.forEach(p => { p.visible = cb.checked; }); render(); };
      const text = document.createElement('span');
      text.textContent = g.label;
      const count = document.createElement('span');
      count.textContent = g.parts.length;
      count.style.cssText = 'margin-left:auto;opacity:.6;';
      label.append(cb, text, count);
      body.append(label);
      rows.push({ cb, g });
    });

    sync();
    panel.append(head, body);
    box.append(panel);
    return panel;
  }

  function frame(THREE, camera, controls, group) {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1e-3);
    let dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
    dist *= Math.max(1, 1 / camera.aspect) * 1.05;
    camera.position.copy(center).addScaledVector(new THREE.Vector3(1, -1.2, 0.8).normalize(), dist);
    camera.near = dist / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  function init(boxId, btnId, stepUrl, partGroups) {
    const box = document.getElementById(boxId);
    const btn = document.getElementById(btnId);
    if (!box || !btn) return;
    let state = 'idle';   // idle | loading | ready
    let api = null;

    const overlay = (text, extra) => {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;font-size:13px;color:var(--text-muted,#666);' + extra;
      d.textContent = text;
      box.append(d);
      return d;
    };

    btn.addEventListener('click', async () => {
      if (state === 'loading') return;
      if (state === 'ready') {
        const show = box.hidden;
        box.hidden = !show;
        btn.textContent = show ? 'Hide 3D view' : 'View in 3D';
        if (show) api.resize();
        return;
      }

      state = 'loading';
      box.hidden = false;
      box.replaceChildren();
      box.style.cssText = 'position:relative;margin-top:1rem;height:clamp(320px,60vh,520px);overflow:hidden;' +
        'border:1px solid var(--line,#E0E0E0);border-radius:6px;background:var(--panel,#f4f6f8);';
      const status = overlay('Loading viewer…', 'inset:0;display:flex;align-items:center;justify-content:center;');
      btn.disabled = true;

      try {
        await loadScript(VENDOR + 'three.min.js');
        await loadScript(VENDOR + 'OrbitControls.js');
        status.textContent = 'Downloading model…';
        const resp = await fetch(stepUrl);
        if (!resp.ok) throw new Error('The STEP file was not found.');
        const bytes = new Uint8Array(await resp.arrayBuffer());
        status.textContent = 'Reading model…';
        await new Promise(r => setTimeout(r, 30));
        const result = await readStep(bytes);

        const THREE = window.THREE;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.domElement.style.display = 'block';
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
        camera.up.set(0, 0, 1);                       // CAD models are Z-up
        scene.add(camera);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9));
        const headlight = new THREE.DirectionalLight(0xffffff, 0.8);
        headlight.position.set(1, 1, 2);
        camera.add(headlight);                        // light follows the view

        const model = buildModel(THREE, result);
        scene.add(model);
        box.replaceChildren(renderer.domElement);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        const render = () => renderer.render(scene, camera);
        controls.addEventListener('change', render);

        const resize = () => {
          const w = box.clientWidth, h = box.clientHeight;
          if (!w || !h) return;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          render();
        };
        resize();
        frame(THREE, camera, controls, model);
        new ResizeObserver(resize).observe(box);
        buildPanel(box, groupParts(model, partGroups), render);

        const reset = overlay('Reset view', 'top:10px;right:10px;cursor:pointer;padding:4px 10px;border-radius:4px;' +
          'border:1px solid var(--line,#ccc);background:var(--bg,#fff);');
        reset.onclick = () => { frame(THREE, camera, controls, model); render(); };
        overlay('Drag: rotate · Scroll or pinch: zoom · Right-drag or two fingers: pan', 'left:10px;bottom:8px;pointer-events:none;');

        api = { resize };
        state = 'ready';
        btn.textContent = 'Hide 3D view';
      } catch (err) {
        state = 'idle';
        box.replaceChildren();
        overlay(err.message + ' You can still download the STEP file.', 'inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1rem;');
      } finally {
        btn.disabled = false;
      }
    });
  }

  return { init, buildModel, groupParts, buildPanel, frame };
})();
if (typeof module !== 'undefined') module.exports = StepViewer;

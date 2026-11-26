import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { PlayerView } from '@portalverse/core';
import { shapes, sizes, type IslandPath } from './islands';
import type { ChestEncounter } from './encounter';
import './islandEditor.css';

export function mountEditor(
  panel: HTMLElement, scene: THREE.Scene, player: PlayerView, path: IslandPath,
  encounter: ChestEncounter, selected: string, onSelect: (key: string) => void, saveDraft: () => void, close: () => void,
) {
  panel.classList.add('abyss-editor');
  panel.innerHTML = `
    <h2>Floating islands</h2>
    <div class="actions"><button data-add>Add island</button><button data-play>Playtest <kbd>I</kbd></button></div>
    <label>Object <select aria-label="Selected object"></select></label>
    <fieldset><div data-variants></div>
    <div class="actions"><button data-move>Move</button><button data-rotate>Rotate</button></div>
    <div class="coordinates"></div></fieldset>
    <p data-hint></p>
    <div class="actions"><button data-export>Export JSON</button><button data-remove>Remove island</button></div>
    <small role="status"></small>`;
  const get = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const select = get<HTMLSelectElement>('select');
  const fieldset = get<HTMLFieldSetElement>('fieldset');
  const status = get('small');
  const layer = document.createElement('div');
  layer.className = 'abyss-gizmo-layer';
  document.body.append(layer);
  const controls = new TransformControls(player.camera, layer);
  controls.setSize(0.8);
  const helper = controls.getHelper();
  scene.add(helper);

  function entry() { return path.entries[Number(selected)]; }
  function object() {
    if (selected === 'chest') return encounter.chest;
    if (selected === 'shadow') return encounter.shadow;
    return entry()?.mesh;
  }

  encounter.setEditing(true);
  function save() {
    try { saveDraft(); status.textContent = 'Draft saved in this browser.'; }
    catch { status.textContent = 'Browser storage unavailable. Export JSON to keep this path.'; }
  }

  const variants = ['shape', 'size'] as const;
  const outputs = variants.map(key => {
    const options = key === 'shape' ? shapes : sizes;
    const row = document.createElement('div');
    row.className = 'variant';
    row.innerHTML = `<span>${key === 'shape' ? 'Shape' : 'Size'}</span><button aria-label="Previous ${key}">‹</button><output></output><button aria-label="Next ${key}">›</button>`;
    row.querySelectorAll('button').forEach((button, i) => {
      button.onclick = () => {
        const entry = path.entries[Number(selected)];
        const next = ((options as readonly string[]).indexOf(entry[key]) + (i ? 1 : -1) + options.length) % options.length;
        path.reshape(Number(selected), key === 'shape' ? shapes[next] : entry.shape, key === 'size' ? sizes[next] : entry.size);
        refresh();
        save();
      };
    });
    get('[data-variants]').append(row);
    return row.querySelector('output')!;
  });

  const axes = ['x', 'y', 'z'] as const;
  const coordinates = axes.map(axis => {
    const label = document.createElement('label');
    label.textContent = axis.toUpperCase();
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.onchange = () => {
      const target = object();
      if (target && Number.isFinite(input.valueAsNumber)) {
        if (controls.mode === 'rotate') target.rotation[axis] = THREE.MathUtils.degToRad(input.valueAsNumber);
        else target.position[axis] = input.valueAsNumber;
        save();
      }
      showPosition();
    };
    label.append(input);
    get('.coordinates').append(label);
    return input;
  });

  function showPosition() {
    const target = object();
    const rotating = controls.mode === 'rotate';
    axes.forEach((axis, i) => {
      coordinates[i].step = rotating ? '1' : '0.1';
      const value = target && (rotating ? THREE.MathUtils.radToDeg(target.rotation[axis]) : target.position[axis]);
      coordinates[i].value = value?.toFixed(2) ?? '';
    });
  }

  function refresh() {
    const island = entry();
    const target = object();
    onSelect(selected);
    select.replaceChildren(...path.entries.map((e, i) => new Option(`${i + 1} · ${e.shape}`, String(i))),
      new Option('Chest anchor (hidden)', 'chest'), new Option('Shadow Man spawn', 'shadow'));
    select.value = selected;
    fieldset.disabled = !target;
    get('[data-variants]').hidden = !island;
    get<HTMLButtonElement>('[data-remove]').disabled = !island;
    if (target) controls.attach(target);
    else controls.detach();
    variants.forEach((key, i) => { outputs[i].textContent = island?.[key] ?? '—'; });
    const rotating = controls.mode === 'rotate';
    get('[data-move]').setAttribute('aria-pressed', String(!rotating));
    get('[data-rotate]').setAttribute('aria-pressed', String(rotating));
    const frame = selected === 'chest' ? 'island surface' : selected === 'shadow' ? 'chest' : 'room';
    get('[data-hint]').textContent = rotating ? `Drag a ring or enter degrees relative to the ${frame}.`
      : `Drag an arrow or enter meters relative to the ${frame}.`;
    showPosition();
  }

  get('[data-move]').onclick = () => { controls.setMode('translate'); refresh(); };
  get('[data-rotate]').onclick = () => { controls.setMode('rotate'); refresh(); };
  select.onchange = () => { selected = select.value; refresh(); };
  get('[data-add]').onclick = () => {
    const previous = entry();
    const origin = previous?.mesh.position ?? player.position;
    const forward = player.camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const side = previous ? 0 : 3.5;
    selected = String(path.add({
      shape: previous?.shape ?? 'Slab', size: previous?.size ?? 'Medium',
      x: origin.x + 4 * forward.x - side * forward.z,
      y: origin.y, z: origin.z + 4 * forward.z + side * forward.x,
    }));
    refresh();
    save();
  };
  get('[data-remove]').onclick = () => {
    path.remove(Number(selected));
    selected = path.entries.length ? String(Math.min(Number(selected), path.entries.length - 1)) : 'chest';
    refresh();
    save();
  };
  get('[data-export]').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(path.snapshot(encounter.placement()), null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'secret-path.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  get('[data-play]').onclick = close;

  const ray = new THREE.Raycaster();
  layer.addEventListener('pointerdown', event => {
    if (controls.dragging || event.button !== 0) return;
    const rect = layer.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2,
    ), player.camera);
    const targets = path.entries.map(e => e.mesh as THREE.Object3D).concat(encounter.chest);
    const hit = ray.intersectObjects(targets, true)[0];
    for (let node: THREE.Object3D | null = hit?.object ?? null; node; node = node.parent) {
      if (node === encounter.shadow) selected = 'shadow';
      else if (node === encounter.chest) selected = 'chest';
      else {
        const index = path.entries.findIndex(e => e.mesh === node);
        if (index < 0) continue;
        selected = String(index);
      }
      refresh();
      break;
    }
  });
  controls.addEventListener('objectChange', showPosition);
  controls.addEventListener('mouseUp', save);
  refresh();
  return () => {
    if (controls.dragging) save();
    encounter.setEditing(false);
    controls.detach();
    helper.removeFromParent();
    controls.dispose();
    layer.remove();
  };
}

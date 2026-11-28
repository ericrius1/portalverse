import {
  CONSTELLATION_CATEGORIES,
  COSMIC_CONSTELLATIONS,
  type ConstellationCategory,
  type MetaViewFocus,
} from '@portalverse/core/meta';
import type { WorldManifest } from '@portalverse/core/types';

export interface MetaViewUiCallbacks {
  onClose: () => void;
  onOverview: () => void;
  onShake: (worldId?: string) => void;
  onToggleArt: () => boolean;
  onSelectWorld: (worldId: string) => void;
  onEnterWorld: (worldId: string) => void;
  onStepWorld: (delta: number) => void;
  onSelectConstellation: (constellationId: string) => void;
  onStepConstellation: (delta: number) => void;
  onCopyWorldLink: (world: WorldManifest) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Translucent cosmic HUD overlay for the 3D Snowglobe Meta View:
 * - Top cosmic bar (Shake, Atlas Art toggle, Overview, Return)
 * - Floating hover tooltip pill
 * - Contextual World Snowglobe / Constellation Inspector card
 * - Bottom Celestial Sky-Guide dock (filter constellations by Creatures/Aliens/Plants/Concepts, or quick-jump worlds)
 */
export class MetaViewUi {
  private readonly root: HTMLElement;
  private readonly countsEl: HTMLElement;
  private readonly hoverPill: HTMLElement;
  private readonly inspectorEl: HTMLElement;
  private readonly tabsEl: HTMLElement;
  private readonly pillStripEl: HTMLElement;
  private readonly btnShake: HTMLButtonElement;
  private readonly btnArt: HTMLButtonElement;
  private readonly btnOverview: HTMLButtonElement;
  private readonly btnClose: HTMLButtonElement;
  private readonly btnDockSkies: HTMLButtonElement;
  private readonly btnDockWorlds: HTMLButtonElement;
  private readonly worlds: readonly WorldManifest[];
  private readonly callbacks: MetaViewUiCallbacks;

  private activeWorldId = '';
  private dockTab: 'constellations' | 'worlds' = 'constellations';
  private activeCategory: 'all' | ConstellationCategory = 'all';
  private currentFocus: MetaViewFocus = { kind: 'overview' };
  private open = false;

  constructor(
    root: HTMLElement,
    worlds: readonly WorldManifest[],
    callbacks: MetaViewUiCallbacks,
  ) {
    this.root = root;
    this.worlds = worlds;
    this.callbacks = callbacks;

    this.countsEl = root.querySelector('#meta-view-counts') as HTMLElement;
    this.hoverPill = root.querySelector('#meta-hover-pill') as HTMLElement;
    this.inspectorEl = root.querySelector('#meta-inspector') as HTMLElement;
    this.tabsEl = root.querySelector('#meta-constellation-tabs') as HTMLElement;
    this.pillStripEl = root.querySelector('#meta-pill-strip') as HTMLElement;
    this.btnShake = root.querySelector('#btn-meta-shake') as HTMLButtonElement;
    this.btnArt = root.querySelector('#btn-meta-art') as HTMLButtonElement;
    this.btnOverview = root.querySelector('#btn-meta-overview') as HTMLButtonElement;
    this.btnClose = root.querySelector('#btn-meta-close') as HTMLButtonElement;
    this.btnDockSkies = root.querySelector('#btn-meta-dock-skies') as HTMLButtonElement;
    this.btnDockWorlds = root.querySelector('#btn-meta-dock-worlds') as HTMLButtonElement;

    this.countsEl.textContent = `${worlds.length} World Snowglobes · ${COSMIC_CONSTELLATIONS.length} Constellations`;

    this.bindEvents();
    this.renderCategoryTabs();
    this.renderDockPills();
  }

  isOpen(): boolean {
    return this.open;
  }

  setActiveWorldId(worldId: string): void {
    this.activeWorldId = worldId;
    if (this.dockTab === 'worlds') this.renderDockPills();
    if (this.currentFocus.kind === 'world') this.renderInspector();
  }

  show(activeWorldId: string): void {
    this.open = true;
    this.activeWorldId = activeWorldId;
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
    this.setHoverLabel(null);
    this.renderDockPills();
    this.renderInspector();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.setHoverLabel(null);
  }

  setFocus(focus: MetaViewFocus): void {
    this.currentFocus = focus;
    this.btnOverview.classList.toggle('active', focus.kind === 'overview');
    this.btnShake.textContent = focus.kind === 'world' ? '❄ Shake Globe' : '❄ Shake All';
    this.renderInspector();
    this.renderDockPills();
  }

  setHoverLabel(label: string | null): void {
    if (!label || !this.open) {
      this.hoverPill.classList.add('hidden');
      return;
    }
    this.hoverPill.textContent = label;
    this.hoverPill.classList.remove('hidden');
  }

  private bindEvents(): void {
    this.btnClose.addEventListener('click', () => this.callbacks.onClose());
    this.btnOverview.addEventListener('click', () => this.callbacks.onOverview());
    this.btnShake.addEventListener('click', () => {
      const targetWorldId = this.currentFocus.kind === 'world' ? this.currentFocus.world.id : undefined;
      this.callbacks.onShake(targetWorldId);
      this.btnShake.classList.remove('shaking');
      void this.btnShake.offsetWidth;
      this.btnShake.classList.add('shaking');
    });
    this.btnArt.addEventListener('click', () => {
      const next = this.callbacks.onToggleArt();
      this.btnArt.setAttribute('aria-pressed', String(next));
      this.btnArt.classList.toggle('active', next);
    });
    this.btnDockSkies.addEventListener('click', () => {
      this.dockTab = 'constellations';
      this.syncDockModeButtons();
      this.renderCategoryTabs();
      this.renderDockPills();
    });
    this.btnDockWorlds.addEventListener('click', () => {
      this.dockTab = 'worlds';
      this.syncDockModeButtons();
      this.renderCategoryTabs();
      this.renderDockPills();
    });
  }

  private syncDockModeButtons(): void {
    const isSkies = this.dockTab === 'constellations';
    this.btnDockSkies.classList.toggle('active', isSkies);
    this.btnDockSkies.setAttribute('aria-pressed', String(isSkies));
    this.btnDockWorlds.classList.toggle('active', !isSkies);
    this.btnDockWorlds.setAttribute('aria-pressed', String(!isSkies));
  }

  private renderCategoryTabs(): void {
    this.tabsEl.innerHTML = '';
    if (this.dockTab !== 'constellations') {
      this.tabsEl.classList.add('hidden');
      return;
    }
    this.tabsEl.classList.remove('hidden');
    for (const cat of CONSTELLATION_CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `meta-cat-btn${this.activeCategory === cat.id ? ' active' : ''}`;
      btn.textContent = cat.label;
      btn.addEventListener('click', () => {
        this.activeCategory = cat.id;
        this.renderCategoryTabs();
        this.renderDockPills();
      });
      this.tabsEl.appendChild(btn);
    }
  }

  private renderDockPills(): void {
    this.pillStripEl.innerHTML = '';

    if (this.dockTab === 'constellations') {
      const list =
        this.activeCategory === 'all'
          ? COSMIC_CONSTELLATIONS
          : COSMIC_CONSTELLATIONS.filter((c) => c.category === this.activeCategory);

      for (const spec of list) {
        const isSelected =
          this.currentFocus.kind === 'constellation' && this.currentFocus.constellation.id === spec.id;
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `meta-pill${isSelected ? ' active' : ''}`;
        pill.style.setProperty('--pill-accent', spec.color);
        pill.innerHTML = `
          <span class="meta-pill-star" style="background:${spec.color};box-shadow:0 0 8px ${spec.color}"></span>
          <span class="meta-pill-label">${escapeHtml(spec.name)}</span>
          <span class="meta-pill-tag">${escapeHtml(spec.categoryLabel)}</span>
        `;
        pill.addEventListener('click', () => this.callbacks.onSelectConstellation(spec.id));
        this.pillStripEl.appendChild(pill);
      }
      return;
    }

    for (const world of this.worlds) {
      const isSelected = this.currentFocus.kind === 'world' && this.currentFocus.world.id === world.id;
      const isCurrent = world.id === this.activeWorldId;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `meta-pill${isSelected ? ' active' : ''}`;
      pill.style.setProperty('--pill-accent', world.accentColor);
      pill.innerHTML = `
        <span class="meta-pill-star" style="background:${world.accentColor};box-shadow:0 0 8px ${world.accentColor}"></span>
        <span class="meta-pill-label">${escapeHtml(world.name)}</span>
        ${isCurrent ? '<span class="meta-pill-tag meta-pill-here">Here</span>' : ''}
      `;
      pill.addEventListener('click', () => this.callbacks.onSelectWorld(world.id));
      this.pillStripEl.appendChild(pill);
    }
  }

  private renderInspector(): void {
    if (this.currentFocus.kind === 'overview') {
      this.inspectorEl.classList.add('hidden');
      this.inspectorEl.innerHTML = '';
      return;
    }

    this.inspectorEl.classList.remove('hidden');

    if (this.currentFocus.kind === 'world') {
      const { world, players } = this.currentFocus;
      const isCurrent = world.id === this.activeWorldId;
      const owner = world.owner ?? world.author;
      const explorersHtml =
        players.length > 0
          ? `<div class="meta-inspector-explorers">
               <span class="meta-inspector-eyebrow">Explorers inside (${players.length})</span>
               <div class="meta-explorer-chips">
                 ${players
                   .slice(0, 6)
                   .map(
                     (p) =>
                       `<span class="meta-explorer-chip"><i style="background:${escapeHtml(p.color)}"></i>${escapeHtml(p.name)}</span>`,
                   )
                   .join('')}
               </div>
             </div>`
          : '';

      this.inspectorEl.style.setProperty('--inspector-accent', world.accentColor);
      this.inspectorEl.innerHTML = `
        <div class="meta-inspector-head">
          <div class="meta-inspector-title-wrap">
            <span class="meta-inspector-orb" style="background:${world.accentColor};box-shadow:0 0 16px ${world.accentColor}"></span>
            <div>
              <span class="meta-inspector-eyebrow">${isCurrent ? '✦ Current World Snowglobe' : 'World Snowglobe'}</span>
              <h3 class="meta-inspector-title">${escapeHtml(world.name)}</h3>
              <div class="meta-inspector-sub">By ${escapeHtml(owner)}</div>
            </div>
          </div>
          <button type="button" class="icon-btn" data-meta-overview aria-label="Return to cosmic overview">&times;</button>
        </div>
        <p class="meta-inspector-desc">${escapeHtml(world.description)}</p>
        ${explorersHtml}
        <div class="meta-inspector-actions">
          <button type="button" class="btn btn-primary" data-meta-enter>
            ${isCurrent ? 'Return Inside' : 'Dive Into World'}
          </button>
          <button type="button" class="btn btn-sm" data-meta-shake-one title="Swirl snow inside this globe (Space)">❄ Shake</button>
          <button type="button" class="btn btn-sm" data-meta-copy-link>Link</button>
        </div>
        <div class="meta-inspector-nav">
          <button type="button" class="btn btn-sm" data-meta-prev>&larr; Prev</button>
          <button type="button" class="btn btn-sm" data-meta-overview>Overview</button>
          <button type="button" class="btn btn-sm" data-meta-next>Next &rarr;</button>
        </div>
      `;

      this.inspectorEl.querySelector('[data-meta-enter]')?.addEventListener('click', () => {
        this.callbacks.onEnterWorld(world.id);
      });
      this.inspectorEl.querySelector('[data-meta-shake-one]')?.addEventListener('click', () => {
        this.callbacks.onShake(world.id);
      });
      this.inspectorEl.querySelector('[data-meta-copy-link]')?.addEventListener('click', () => {
        this.callbacks.onCopyWorldLink(world);
      });
      this.inspectorEl.querySelector('[data-meta-prev]')?.addEventListener('click', () => {
        this.callbacks.onStepWorld(-1);
      });
      this.inspectorEl.querySelector('[data-meta-next]')?.addEventListener('click', () => {
        this.callbacks.onStepWorld(1);
      });
      this.inspectorEl.querySelectorAll('[data-meta-overview]').forEach((el) => {
        el.addEventListener('click', () => this.callbacks.onOverview());
      });
      return;
    }

    const spec = this.currentFocus.constellation;
    this.inspectorEl.style.setProperty('--inspector-accent', spec.color);
    this.inspectorEl.innerHTML = `
      <div class="meta-inspector-head">
        <div class="meta-inspector-title-wrap">
          <span class="meta-inspector-orb" style="background:${spec.color};box-shadow:0 0 16px ${spec.color}"></span>
          <div>
            <span class="meta-inspector-eyebrow">✦ Constellation · ${escapeHtml(spec.categoryLabel)}</span>
            <h3 class="meta-inspector-title">${escapeHtml(spec.name)}</h3>
            <div class="meta-inspector-sub meta-latin">${escapeHtml(spec.latinName)} · ${spec.stars.length} stars</div>
          </div>
        </div>
        <button type="button" class="icon-btn" data-meta-overview aria-label="Return to cosmic overview">&times;</button>
      </div>
      <p class="meta-inspector-desc">${escapeHtml(spec.description)}</p>
      <div class="meta-inspector-nav">
        <button type="button" class="btn btn-sm" data-meta-prev>&larr; Prev Sky</button>
        <button type="button" class="btn btn-sm" data-meta-overview>Overview</button>
        <button type="button" class="btn btn-sm" data-meta-next>Next Sky &rarr;</button>
      </div>
    `;

    this.inspectorEl.querySelector('[data-meta-prev]')?.addEventListener('click', () => {
      this.callbacks.onStepConstellation(-1);
    });
    this.inspectorEl.querySelector('[data-meta-next]')?.addEventListener('click', () => {
      this.callbacks.onStepConstellation(1);
    });
    this.inspectorEl.querySelectorAll('[data-meta-overview]').forEach((el) => {
      el.addEventListener('click', () => this.callbacks.onOverview());
    });
  }
}

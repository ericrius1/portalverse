import {
  NPC_LIST,
  NpcJournalStore,
  SHUTTLE_SECRET_PAGE,
  getNpcPortraitUrl,
  type NpcChoiceTone,
  type NpcDialogueChoice,
  type NpcDialogueNode,
  type NpcSpec,
} from '@portalverse/core/npc';
import { getBubblePreset } from '@portalverse/core/chat';
import type { SpeechBubbleStyle } from '@portalverse/core/types';

export interface DialogueUiCallbacks {
  onOpenDialogue: (npc: NpcSpec) => void;
  onCloseDialogue: (npc: NpcSpec, relockPointer: boolean) => void;
  onSpeakNode: (npc: NpcSpec, node: NpcDialogueNode) => void;
  onAdoptBubbleStyle: (npc: NpcSpec, style: SpeechBubbleStyle) => void;
  onOpenJournal: () => void;
  onJumpToWorld: (worldId: string) => void;
  onToast: (message: string) => void;
  getWorldName: (worldId: string) => string;
}

const FONT_STACK: Record<SpeechBubbleStyle['font'], string> = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  comic: "'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  serif: "'Cormorant Garamond', Georgia, serif",
};

function isLightHex(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58;
}

const EXPRESSION_LABELS: Record<string, string> = {
  neutral: 'Composed',
  calm: 'Calm',
  smile: 'Warm',
  grin: 'Bright',
  laugh: 'Amused',
  surprise: 'Startled',
  awe: 'In Awe',
  worry: 'Uneasy',
  sad: 'Quiet',
  thinking: 'Pondering',
  determined: 'Focused',
  sleepy: 'Drowsy',
  content: 'At Ease',
  shy: 'Guarded',
  fond: 'Fond',
  mischief: 'Mischievous',
  proud: 'Proud',
};

const TONE_ICON: Record<NpcChoiceTone, string> = {
  curious: '?',
  playful: '✦',
  lore: '◈',
  farewell: '↩',
};

const CLUE_OWNER_MAP = new Map<string, NpcSpec>(NPC_LIST.map((npc) => [npc.clueId, npc]));

/**
 * KOTOR / Zelda-style branching NPC dialogue panel + persistent Seam Clue Journal.
 * Frames every Keeper's conversation in their own custom speech bubble aesthetic,
 * unlocks cross-world callback options as clues are discovered, and lets players
 * adopt any Keeper's speech bubble style for their own WebRTC chat.
 */
export class NpcDialogueUi {
  readonly journal: NpcJournalStore;
  private readonly callbacks: DialogueUiCallbacks;

  // Proximity prompt
  private readonly promptEl: HTMLButtonElement;
  private readonly promptKeyEl: HTMLElement;
  private readonly promptDotEl: HTMLElement;
  private readonly promptNameEl: HTMLElement;
  private readonly promptRoleEl: HTMLElement;
  private readonly promptNewBadgeEl: HTMLElement;

  // Dialogue panel
  private readonly overlayEl: HTMLElement;
  private readonly panelEl: HTMLElement;
  private readonly portraitWrapEl: HTMLElement;
  private readonly portraitImgEl: HTMLImageElement;
  private readonly exprPillEl: HTMLElement;
  private readonly badgeEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly roleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly skipHintEl: HTMLElement;
  private readonly clueBannerEl: HTMLElement;
  private readonly clueTitleEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private readonly btnWearBubble: HTMLButtonElement;
  private readonly btnClueJournal: HTMLButtonElement;
  private readonly btnCloseDialogue: HTMLButtonElement;

  // Journal HUD button & modal
  private readonly btnJournalHud: HTMLButtonElement;
  private readonly journalCountEl: HTMLElement;
  private readonly journalModalEl: HTMLElement;
  private readonly journalProgressText: HTMLElement;
  private readonly journalProgressBar: HTMLElement;
  private readonly journalGridEl: HTMLElement;
  private readonly journalShuttleCard: HTMLElement;
  private readonly btnJournalReset: HTMLButtonElement;

  private nearbyNpc: NpcSpec | null = null;
  private activeNpc: NpcSpec | null = null;
  private visibleChoices: NpcDialogueChoice[] = [];
  private wasPointerLocked = false;

  // Typewriter state
  private fullLine = '';
  private revealedChars = 0;
  private typingTimer = 0;
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  constructor(callbacks: DialogueUiCallbacks) {
    this.callbacks = callbacks;
    this.journal = new NpcJournalStore();

    this.promptEl = document.getElementById('npc-prompt') as HTMLButtonElement;
    this.promptKeyEl = document.getElementById('npc-prompt-key')!;
    this.promptDotEl = document.getElementById('npc-prompt-dot')!;
    this.promptNameEl = document.getElementById('npc-prompt-name')!;
    this.promptRoleEl = document.getElementById('npc-prompt-role')!;
    this.promptNewBadgeEl = document.getElementById('npc-prompt-new')!;

    this.overlayEl = document.getElementById('dialogue-overlay')!;
    this.panelEl = document.getElementById('dialogue-panel')!;
    this.portraitWrapEl = document.getElementById('dialogue-portrait-wrap')!;
    this.portraitImgEl = document.getElementById('dialogue-portrait-img') as HTMLImageElement;
    this.exprPillEl = document.getElementById('dialogue-expr-pill')!;
    this.badgeEl = document.getElementById('dialogue-badge')!;
    this.nameEl = document.getElementById('dialogue-name')!;
    this.roleEl = document.getElementById('dialogue-role')!;
    this.textEl = document.getElementById('dialogue-text')!;
    this.skipHintEl = document.getElementById('dialogue-skip-hint')!;
    this.clueBannerEl = document.getElementById('dialogue-clue-banner')!;
    this.clueTitleEl = document.getElementById('dialogue-clue-title')!;
    this.choicesEl = document.getElementById('dialogue-choices')!;
    this.btnWearBubble = document.getElementById('btn-dialogue-wear-bubble') as HTMLButtonElement;
    this.btnClueJournal = document.getElementById('btn-dialogue-journal') as HTMLButtonElement;
    this.btnCloseDialogue = document.getElementById('btn-dialogue-close') as HTMLButtonElement;

    this.btnJournalHud = document.getElementById('btn-journal') as HTMLButtonElement;
    this.journalCountEl = document.getElementById('journal-count')!;
    this.journalModalEl = document.getElementById('modal-journal')!;
    this.journalProgressText = document.getElementById('journal-progress-text')!;
    this.journalProgressBar = document.getElementById('journal-progress-fill')!;
    this.journalGridEl = document.getElementById('journal-grid')!;
    this.journalShuttleCard = document.getElementById('journal-shuttle-card')!;
    this.btnJournalReset = document.getElementById('btn-journal-reset') as HTMLButtonElement;

    this.bindEvents();
    this.syncJournalBadge();
    this.journal.subscribe((_snap, newClueId) => {
      this.syncJournalBadge();
      if (!this.journalModalEl.classList.contains('hidden')) {
        this.renderJournal();
      }
      if (newClueId && this.journal.getSnapshot().hasShuttlePage) {
        const total = this.journal.getSnapshot().totalClues;
        this.callbacks.onToast(`All ${total} Seam threads gathered! A final page appeared in your Journal.`);
      }
    });
  }

  isOpen(): boolean {
    return this.activeNpc !== null;
  }

  getActiveNpc(): NpcSpec | null {
    return this.activeNpc;
  }

  setNearbyNpc(npc: NpcSpec | null, touchMode = false): void {
    this.nearbyNpc = npc;
    this.syncPrompt(touchMode);
  }

  syncPrompt(touchMode = false): void {
    const npc = this.nearbyNpc;
    if (!npc || this.activeNpc) {
      this.promptEl.classList.add('hidden');
      return;
    }
    this.promptKeyEl.textContent = touchMode ? 'TAP' : 'R';
    this.promptDotEl.style.background = npc.accentColor;
    this.promptDotEl.style.boxShadow = `0 0 12px ${npc.accentColor}`;
    this.promptNameEl.textContent = `Talk to ${npc.name}`;
    this.promptRoleEl.textContent = npc.title;
    const undiscovered = !this.journal.hasClue(npc.clueId);
    this.promptNewBadgeEl.classList.toggle('hidden', !undiscovered);
    this.promptEl.style.setProperty('--npc-accent', npc.accentColor);
    this.promptEl.classList.remove('hidden');
  }

  openDialogue(npc: NpcSpec, wasPointerLocked: boolean): void {
    this.wasPointerLocked = wasPointerLocked;
    this.activeNpc = npc;
    this.journal.recordMet(npc.id);
    this.promptEl.classList.add('hidden');

    // Apply this Keeper's signature speech bubble visual styling to the KOTOR panel
    this.applyBubbleTheme(npc);

    this.portraitImgEl.src = getNpcPortraitUrl(npc.id);
    this.portraitImgEl.alt = `${npc.name} — ${npc.title}`;
    this.badgeEl.textContent = npc.bubbleStyle.badge ?? '';
    this.badgeEl.classList.toggle('hidden', !npc.bubbleStyle.badge);
    this.nameEl.textContent = npc.name;
    this.roleEl.textContent = `${npc.title} · ${npc.species}`;

    const presetName = getBubblePreset(npc.bubbleStyle.preset).name;
    this.btnWearBubble.title = `Equip ${npc.name}'s "${presetName}" speech bubble for your chat`;

    this.overlayEl.classList.remove('hidden');
    this.overlayEl.setAttribute('aria-hidden', 'false');
    this.callbacks.onOpenDialogue(npc);

    const entryNode = npc.nodes[npc.entryNodeId];
    if (entryNode) {
      this.showNode(entryNode);
    }
  }

  closeDialogue(relockOverride?: boolean): void {
    if (!this.activeNpc) return;
    const closingNpc = this.activeNpc;
    this.stopTypewriter();
    this.activeNpc = null;
    this.visibleChoices = [];
    this.overlayEl.classList.add('hidden');
    this.overlayEl.setAttribute('aria-hidden', 'true');
    const relock = relockOverride ?? this.wasPointerLocked;
    this.wasPointerLocked = false;
    this.callbacks.onCloseDialogue(closingNpc, relock);
    this.syncPrompt();
  }

  /** Handle keyboard shortcuts while dialogue is active; returns true if consumed. */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.activeNpc) return false;
    if (e.code === 'Escape') {
      e.preventDefault();
      this.closeDialogue();
      return true;
    }
    if (e.code === 'Space' && !e.repeat) {
      if (this.revealedChars < this.fullLine.length) {
        e.preventDefault();
        this.finishTypewriter();
        return true;
      }
      return false;
    }
    const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digitMatch && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const idx = Number(digitMatch[1]) - 1;
      if (idx >= 0 && idx < this.visibleChoices.length) {
        e.preventDefault();
        this.selectChoice(this.visibleChoices[idx]);
        return true;
      }
    }
    return false;
  }

  renderJournal(): void {
    const snap = this.journal.getSnapshot();
    const pct = snap.totalClues > 0 ? Math.round((snap.foundClues.length / snap.totalClues) * 100) : 0;
    this.journalProgressText.textContent = `${snap.foundClues.length} / ${snap.totalClues} Seam Threads · ${snap.metNpcIds.length} / ${snap.totalClues} Keepers Met`;
    this.journalProgressBar.style.width = `${pct}%`;

    this.journalGridEl.innerHTML = '';
    for (const npc of NPC_LIST) {
      const found = this.journal.hasClue(npc.clueId);
      const met = this.journal.hasMet(npc.id);
      const worldName = this.callbacks.getWorldName(npc.worldId);
      const preset = getBubblePreset(npc.bubbleStyle.preset);

      const card = document.createElement('article');
      card.className = `journal-card${found ? ' discovered' : ''}${met && !found ? ' met' : ''}`;
      card.style.setProperty('--npc-accent', npc.accentColor);

      const header = document.createElement('div');
      header.className = 'journal-card-head';

      const thumb = document.createElement('img');
      thumb.className = 'journal-thumb';
      thumb.src = getNpcPortraitUrl(npc.id);
      thumb.alt = npc.name;
      thumb.loading = 'lazy';

      const meta = document.createElement('div');
      meta.className = 'journal-meta';
      meta.innerHTML = `
        <div class="journal-npc-name">
          <span>${escapeHtml(npc.name)}</span>
          <span class="journal-preset-pill">${escapeHtml(npc.bubbleStyle.badge ? `${npc.bubbleStyle.badge} ` : '')}${escapeHtml(preset.name)}</span>
        </div>
        <div class="journal-world-name">${escapeHtml(worldName)} · ${escapeHtml(npc.title)}</div>
      `;

      header.append(thumb, meta);

      const body = document.createElement('div');
      body.className = 'journal-card-body';
      if (found) {
        body.innerHTML = `
          <div class="journal-clue-title">✦ ${escapeHtml(npc.clueTitle)}</div>
          <p class="journal-clue-summary">${escapeHtml(npc.clueSummary)}</p>
        `;
      } else {
        body.innerHTML = `
          <div class="journal-clue-locked">${met ? 'Keep talking to uncover this thread…' : `Seek ${escapeHtml(npc.name)} in ${escapeHtml(worldName)}`}</div>
        `;
      }

      const actions = document.createElement('div');
      actions.className = 'journal-card-actions';

      const visitBtn = document.createElement('button');
      visitBtn.type = 'button';
      visitBtn.className = 'btn btn-sm';
      visitBtn.textContent = 'Visit Room';
      visitBtn.addEventListener('click', () => {
        this.callbacks.onJumpToWorld(npc.worldId);
      });

      const styleBtn = document.createElement('button');
      styleBtn.type = 'button';
      styleBtn.className = 'btn btn-sm';
      styleBtn.textContent = 'Wear Bubble';
      styleBtn.addEventListener('click', () => {
        this.callbacks.onAdoptBubbleStyle(npc, npc.bubbleStyle);
      });

      actions.append(visitBtn, styleBtn);
      card.append(header, body, actions);
      this.journalGridEl.appendChild(card);
    }

    // Secret 16th journal page: "The Shuttle"
    if (snap.hasShuttlePage) {
      this.journalShuttleCard.classList.add('unlocked');
      this.journalShuttleCard.innerHTML = `
        <div class="journal-shuttle-eyebrow">Page XVI · Unlocked</div>
        <h3>${escapeHtml(SHUTTLE_SECRET_PAGE.title)}</h3>
        <p>${escapeHtml(SHUTTLE_SECRET_PAGE.summary)}</p>
      `;
    } else {
      this.journalShuttleCard.classList.remove('unlocked');
      const remaining = snap.totalClues - snap.foundClues.length;
      this.journalShuttleCard.innerHTML = `
        <div class="journal-shuttle-eyebrow">Page XVI · Unwritten</div>
        <h3>???</h3>
        <p>Gather ${remaining} more Seam ${remaining === 1 ? 'thread' : 'threads'} across the promenade loop to see what connects the rooms.</p>
      `;
    }
  }

  private bindEvents(): void {
    this.promptEl.addEventListener('click', () => {
      if (this.nearbyNpc && !this.activeNpc) {
        this.openDialogue(this.nearbyNpc, false);
      }
    });

    this.btnCloseDialogue.addEventListener('click', () => {
      this.closeDialogue();
    });

    this.btnWearBubble.addEventListener('click', () => {
      if (!this.activeNpc) return;
      this.callbacks.onAdoptBubbleStyle(this.activeNpc, this.activeNpc.bubbleStyle);
    });

    this.btnClueJournal.addEventListener('click', () => {
      this.closeDialogue(false);
      this.callbacks.onOpenJournal();
    });

    // Clicking the speech text box skips the typewriter immediately
    this.textEl.addEventListener('click', () => {
      if (this.revealedChars < this.fullLine.length) {
        this.finishTypewriter();
      }
    });

    this.btnJournalHud.addEventListener('click', () => {
      this.callbacks.onOpenJournal();
    });

    this.btnJournalReset.addEventListener('click', () => {
      this.journal.reset();
      this.renderJournal();
      this.syncPrompt();
      this.callbacks.onToast('Seam Journal reset.');
    });
  }

  private showNode(node: NpcDialogueNode): void {
    if (!this.activeNpc) return;

    const newlyFoundClue = node.grantsClue ? this.journal.discoverClue(this.activeNpc.clueId) : false;
    this.clueBannerEl.classList.toggle('hidden', !newlyFoundClue);
    if (newlyFoundClue) {
      this.clueTitleEl.textContent = this.activeNpc.clueTitle;
      this.callbacks.onToast(`Seam Thread noted: ${this.activeNpc.clueTitle}`);
    }

    const exprText = EXPRESSION_LABELS[node.expr] ?? node.expr;
    this.exprPillEl.textContent = exprText;
    this.exprPillEl.dataset.expr = node.expr;

    this.callbacks.onSpeakNode(this.activeNpc, node);
    this.startTypewriter(node.text);
    this.renderChoices(node);
  }

  private renderChoices(node: NpcDialogueNode): void {
    this.choicesEl.innerHTML = '';
    const available = node.choices.filter(
      (choice) => !choice.requiresClue || this.journal.hasClue(choice.requiresClue),
    );
    this.visibleChoices = available;

    available.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const tone: NpcChoiceTone = choice.tone ?? (choice.nextNodeId === null ? 'farewell' : 'curious');
      const isCrossWorld = Boolean(choice.requiresClue);
      btn.className = `dialogue-choice tone-${tone}${isCrossWorld ? ' is-cross-world' : ''}`;

      const numSpan = document.createElement('span');
      numSpan.className = 'dialogue-choice-num';
      numSpan.textContent = String(idx + 1);

      const iconSpan = document.createElement('span');
      iconSpan.className = 'dialogue-choice-tone';
      iconSpan.textContent = isCrossWorld ? '✦' : TONE_ICON[tone];

      const bodyWrap = document.createElement('span');
      bodyWrap.className = 'dialogue-choice-body';

      const textSpan = document.createElement('span');
      textSpan.className = 'dialogue-choice-text';
      textSpan.textContent = choice.text;
      bodyWrap.appendChild(textSpan);

      if (choice.requiresClue) {
        const sourceNpc = CLUE_OWNER_MAP.get(choice.requiresClue);
        const tag = document.createElement('span');
        tag.className = 'dialogue-thread-tag';
        tag.textContent = sourceNpc
          ? `Thread from ${sourceNpc.name}`
          : 'Cross-World Thread';
        bodyWrap.appendChild(tag);
      }

      btn.append(numSpan, iconSpan, bodyWrap);
      btn.addEventListener('click', () => this.selectChoice(choice));
      this.choicesEl.appendChild(btn);
    });
  }

  private selectChoice(choice: NpcDialogueChoice): void {
    if (!this.activeNpc) return;
    if (choice.nextNodeId === null) {
      this.closeDialogue();
      return;
    }
    const nextNode = this.activeNpc.nodes[choice.nextNodeId];
    if (!nextNode) {
      this.closeDialogue();
      return;
    }
    this.showNode(nextNode);
  }

  private startTypewriter(line: string): void {
    this.stopTypewriter();
    this.fullLine = line;
    if (this.reducedMotion) {
      this.revealedChars = line.length;
      this.textEl.textContent = line;
      this.portraitWrapEl.classList.remove('speaking');
      this.skipHintEl.classList.add('hidden');
      return;
    }

    this.revealedChars = 0;
    this.textEl.textContent = '';
    this.portraitWrapEl.classList.add('speaking');
    this.skipHintEl.classList.remove('hidden');

    const step = () => {
      if (this.revealedChars >= this.fullLine.length) {
        this.finishTypewriter();
        return;
      }
      this.revealedChars = Math.min(this.fullLine.length, this.revealedChars + 2);
      this.textEl.textContent = this.fullLine.slice(0, this.revealedChars);
      const lastChar = this.fullLine[this.revealedChars - 1] ?? '';
      const delay = lastChar === '.' || lastChar === '!' || lastChar === '?' ? 110 : lastChar === ',' ? 65 : 22;
      this.typingTimer = window.setTimeout(step, delay);
    };
    this.typingTimer = window.setTimeout(step, 16);
  }

  private finishTypewriter(): void {
    this.stopTypewriter();
    this.revealedChars = this.fullLine.length;
    this.textEl.textContent = this.fullLine;
    this.portraitWrapEl.classList.remove('speaking');
    this.skipHintEl.classList.add('hidden');
  }

  private stopTypewriter(): void {
    if (this.typingTimer) {
      window.clearTimeout(this.typingTimer);
      this.typingTimer = 0;
    }
  }

  private applyBubbleTheme(npc: NpcSpec): void {
    const s = npc.bubbleStyle;
    const light = isLightHex(s.bgColor);
    const classes = [
      'dialogue-panel',
      `dialogue-preset-${s.preset}`,
      s.effect !== 'none' ? `dialogue-fx-${s.effect}` : '',
      light ? 'is-light-bg' : '',
    ].filter(Boolean);
    this.panelEl.className = classes.join(' ');
    this.panelEl.style.setProperty('--b-bg', s.bgColor);
    this.panelEl.style.setProperty('--b-accent', s.accentColor);
    this.panelEl.style.setProperty('--b-text', s.textColor);
    this.panelEl.style.setProperty('--b-font', FONT_STACK[s.font] ?? FONT_STACK.sans);
    this.panelEl.style.setProperty('--npc-accent', npc.accentColor);
  }

  private syncJournalBadge(): void {
    const snap = this.journal.getSnapshot();
    this.journalCountEl.textContent = `${snap.foundClues.length}/${snap.totalClues}`;
    this.btnJournalHud.classList.toggle('has-clues', snap.foundClues.length > 0);
    this.btnJournalHud.classList.toggle('complete', snap.hasShuttlePage);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

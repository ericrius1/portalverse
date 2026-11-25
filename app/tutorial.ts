export interface TutorialElements {
  card: HTMLElement;
  stepBadge: HTMLElement;
  progressFill: HTMLElement;
  title: HTMLElement;
  desc: HTMLElement;
  status: HTMLElement;
  btnNext: HTMLButtonElement;
  btnSkip: HTMLButtonElement;
}

export interface TutorialSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  velocityY: number;
  isFlying: boolean;
  pointerLocked: boolean;
  sprinting: boolean;
}

interface TutorialStepDef {
  id: string;
  title: string;
  descHtml: string;
  hint: (ctrl: InteractiveTutorial) => string;
}

const STORAGE_TUTORIAL_KEY = 'portalverse.tutorial.done.v1';

const STEPS: TutorialStepDef[] = [
  {
    id: 'look',
    title: 'Look Around (FPS)',
    descHtml: 'Click the scene to lock your mouse, then move it to look around. Press <kbd>Esc</kbd> anytime to unlock your cursor.',
    hint: (t) => (t.pointerLocked ? `Mouse locked — look around (${Math.min(100, Math.round((t.lookAccum / 0.45) * 100))}%)` : 'Click anywhere in the 3D view to lock mouse'),
  },
  {
    id: 'move',
    title: 'Walk & Sprint',
    descHtml: 'Use <kbd>WASD</kbd> (or Arrow keys) to move around, and hold <kbd>Shift</kbd> to sprint.',
    hint: (t) => {
      const m = Math.min(5, t.moveDist).toFixed(1);
      return t.didSprint ? `Moved ${m} / 5.0 m · Sprint checked!` : `Moved ${m} / 5.0 m · Hold Shift to sprint`;
    },
  },
  {
    id: 'jump-fly',
    title: 'Jump or Fly',
    descHtml: 'Press <kbd>Space</kbd> to jump, or press <kbd>F</kbd> to toggle free-flight (<kbd>Space</kbd> up, <kbd>C</kbd> down).',
    hint: () => 'Press Space to jump or F to fly',
  },
  {
    id: 'camera',
    title: 'Switch Camera View',
    descHtml: 'Press <kbd>V</kbd> to toggle between 1st-person (FPS) and 3rd-person view.',
    hint: () => 'Press V to switch camera view',
  },
  {
    id: 'portal',
    title: 'Step Through a Portal',
    descHtml: 'Walk straight through a glowing circular portal (or press <kbd>E</kbd> nearby) to cross seamlessly into the next room!',
    hint: () => 'Walk into the circular portal ahead',
  },
];

export function hasCompletedTutorial(): boolean {
  try {
    return localStorage.getItem(STORAGE_TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

function markTutorialDone(): void {
  try {
    localStorage.setItem(STORAGE_TUTORIAL_KEY, '1');
  } catch {
    // Ignore storage quota errors
  }
}

export class InteractiveTutorial {
  private readonly els: TutorialElements;
  private active = false;
  private stepIndex = 0;
  private advancing = false;
  private completeTimer = 0;

  private lastX = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private hasSample = false;

  pointerLocked = false;
  lookAccum = 0;
  moveDist = 0;
  didSprint = false;
  private startWorldId = '';

  constructor(els: TutorialElements, onCompleteOrSkip?: () => void) {
    this.els = els;
    this.els.btnSkip.addEventListener('click', () => {
      this.stop(true);
      onCompleteOrSkip?.();
    });
    this.els.btnNext.addEventListener('click', () => {
      if (!this.active) return;
      if (this.stepIndex >= STEPS.length) {
        this.stop(true);
        onCompleteOrSkip?.();
      } else {
        this.completeCurrentStep();
      }
    });
  }

  isActive(): boolean {
    return this.active;
  }

  start(worldId: string): void {
    window.clearTimeout(this.completeTimer);
    this.active = true;
    this.stepIndex = 0;
    this.advancing = false;
    this.hasSample = false;
    this.lookAccum = 0;
    this.moveDist = 0;
    this.didSprint = false;
    this.startWorldId = worldId;
    this.els.card.classList.remove('hidden', 'tutorial-done', 'tutorial-step-flash');
    this.els.btnSkip.classList.remove('hidden');
    this.renderStep();
  }

  stop(markDone = false): void {
    window.clearTimeout(this.completeTimer);
    this.active = false;
    this.advancing = false;
    this.els.card.classList.add('hidden');
    if (markDone) markTutorialDone();
  }

  sample(s: TutorialSample): void {
    if (!this.active || this.advancing || this.stepIndex >= STEPS.length) return;
    this.pointerLocked = s.pointerLocked;

    if (!this.hasSample) {
      this.lastX = s.x;
      this.lastZ = s.z;
      this.lastYaw = s.yaw;
      this.lastPitch = s.pitch;
      this.hasSample = true;
      this.updateHintText();
      return;
    }

    const dYaw = Math.abs(Math.atan2(Math.sin(s.yaw - this.lastYaw), Math.cos(s.yaw - this.lastYaw)));
    const dPitch = Math.abs(s.pitch - this.lastPitch);
    const dMove = Math.hypot(s.x - this.lastX, s.z - this.lastZ);

    this.lastX = s.x;
    this.lastZ = s.z;
    this.lastYaw = s.yaw;
    this.lastPitch = s.pitch;

    const step = STEPS[this.stepIndex];
    if (step.id === 'look') {
      this.lookAccum += dYaw + dPitch;
      if (this.lookAccum >= 0.45) {
        this.completeCurrentStep();
        return;
      }
    } else if (step.id === 'move') {
      // Ignore teleport jumps when accumulating walked distance.
      if (dMove < 5) {
        this.moveDist += dMove;
        if (s.sprinting && dMove > 0.02) this.didSprint = true;
      }
      if ((this.moveDist >= 4.5 && this.didSprint) || this.moveDist >= 9.0) {
        this.completeCurrentStep();
        return;
      }
    } else if (step.id === 'jump-fly') {
      if (s.velocityY > 1.0 || s.isFlying) {
        this.completeCurrentStep();
        return;
      }
    }

    this.updateHintText();
  }

  notifyFlightToggle(): void {
    if (!this.active || this.advancing) return;
    if (STEPS[this.stepIndex]?.id === 'jump-fly') {
      this.completeCurrentStep();
    }
  }

  notifyCameraToggle(): void {
    if (!this.active || this.advancing) return;
    if (STEPS[this.stepIndex]?.id === 'camera') {
      this.completeCurrentStep();
    }
  }

  notifyWorldChanged(newWorldId: string): void {
    if (!this.active || this.advancing) return;
    if (STEPS[this.stepIndex]?.id === 'portal' && newWorldId !== this.startWorldId) {
      this.completeCurrentStep();
    }
    this.startWorldId = newWorldId;
  }

  private completeCurrentStep(): void {
    if (this.advancing) return;
    this.advancing = true;
    this.els.status.textContent = 'Nice!';
    this.els.card.classList.add('tutorial-step-flash');

    window.setTimeout(() => {
      this.els.card.classList.remove('tutorial-step-flash');
      this.advancing = false;
      this.stepIndex++;
      this.lookAccum = 0;
      this.moveDist = 0;
      this.didSprint = false;
      this.hasSample = false;

      if (this.stepIndex >= STEPS.length) {
        this.showCompletion();
      } else {
        this.renderStep();
      }
    }, 520);
  }

  private renderStep(): void {
    const step = STEPS[this.stepIndex];
    this.els.stepBadge.textContent = `Step ${this.stepIndex + 1} / ${STEPS.length}`;
    this.els.progressFill.style.width = `${Math.round((this.stepIndex / STEPS.length) * 100)}%`;
    this.els.title.textContent = step.title;
    this.els.desc.innerHTML = step.descHtml;
    this.els.btnNext.textContent = 'Next';
    this.updateHintText();
  }

  private updateHintText(): void {
    const step = STEPS[this.stepIndex];
    if (!step) return;
    this.els.status.textContent = step.hint(this);
  }

  private showCompletion(): void {
    markTutorialDone();
    this.els.card.classList.add('tutorial-done');
    this.els.stepBadge.textContent = 'Complete';
    this.els.progressFill.style.width = '100%';
    this.els.title.textContent = "You're Ready to Explore!";
    this.els.desc.innerHTML =
      'Press <kbd>M</kbd> for all rooms, <kbd>P</kbd> to spawn live portals, or <kbd>H</kbd> anytime for controls.';
    this.els.status.textContent = 'Enjoy Portalverse!';
    this.els.btnNext.textContent = 'Done';
    this.els.btnSkip.classList.add('hidden');
    this.completeTimer = window.setTimeout(() => {
      this.stop(true);
    }, 6500);
  }
}

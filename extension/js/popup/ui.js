/**
 * Popup DOM paint, motion, sheets, coachmarks, meter view.
 */
import { readTheme } from './theme.js';
import { METER_MIN_DB, METER_MAX_DB, clampDB, dbToFrac, fmtDB } from './format.js';

const { SCENARIO_PRESETS } = self.DLPresets;

export const WHATS_NEW_VERSION = 'hearing-guard-2026-10';
export const WHATS_NEW_STORAGE_KEY = 'seenWhatsNew';
export const STORE_URL = 'https://chrome.google.com/webstore/detail/jhdflfacjalpcajleapijmclnbilnjlh';

export const COACHMARK_STEPS = [
  { targetId: 'mainToggle', textKey: 'coachmarkPower', openSettings: false },
  { targetId: 'evenVolumeToggle', textKey: 'coachmarkEvenVolume', openSettings: false },
  { targetId: 'scenarioSelector', textKey: 'coachmarkScenarios', openSettings: false },
  { targetId: 'pathToggle', textKey: 'coachmarkBestQuality', openSettings: false },
  { targetId: 'globalToggle', textKey: 'coachmarkGlobalToggle', openSettings: true }
];

export function gsapRef() {
  return typeof gsap !== 'undefined' ? gsap : null;
}

export function motionOk() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function cacheElements() {
  const qs = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  return {
    averageDB: qs('averageDB'),
    gainReadout: qs('gainReadout'),
    fader: qs('fader'),
    scale: qs('scale'),
    meterTube: qs('meterTube'),
    meterFill: qs('meterFill'),
    limitHandle: qs('limitHandle'),
    limitTab: qs('limitTab'),
    limitValue: qs('limitValue'),
    mainToggle: qs('mainToggle'),
    pathToggle: qs('pathToggle'),
    toggleText: qs('toggleText'),
    infoButton: qs('infoButton'),
    settingsView: qs('settingsView'),
    closeSettings: qs('closeSettings'),
    coachmark: qs('coachmark'),
    coachmarkStep: qs('coachmarkStep'),
    coachmarkText: qs('coachmarkText'),
    coachmarkNext: qs('coachmarkNext'),
    scenarioSelector: qs('scenarioSelector'),
    presetSelector: qs('presetSelector'),
    pathSelector: qs('pathSelector'),
    themeSelector: qs('themeSelector'),
    globalToggle: qs('globalToggle'),
    evenVolumeToggle: qs('evenVolumeToggle'),
    ceilingHint: qs('ceilingHint'),
    headerIconWrap: q('.header-icon-wrap') || q('.brand'),
    domainChip: qs('domainChip'),
    domainLabel: qs('domainLabel'),
    domainSavedBadge: qs('domainSavedBadge'),
    forgetDomain: qs('forgetDomain'),
    statusLine: qs('statusLine'),
    reviewPrompt: qs('reviewPrompt'),
    reviewLink: qs('reviewLink'),
    reviewDismiss: qs('reviewDismiss'),
    exportBtn: qs('exportBtn'),
    importBtn: qs('importBtn'),
    importFile: qs('importFile'),
    pathChipLabel: qs('pathChipLabel'),
    pathHelpBtn: qs('pathHelpBtn'),
    pathHelpPanel: qs('pathHelpPanel'),
    pathHelpScrim: qs('pathHelpScrim'),
    pathHelpClose: qs('pathHelpClose'),
    pathHelpGotIt: qs('pathHelpGotIt')
  };
}

export function localize(elements) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = chrome.i18n.getMessage(key) || el.textContent;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nTitle);
    if (msg) el.title = msg;
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const msg = chrome.i18n.getMessage(el.dataset.i18nAria);
    if (msg) el.setAttribute('aria-label', msg);
  });
  document.title = chrome.i18n.getMessage('extensionName');
  document.documentElement.lang = chrome.i18n.getUILanguage();
  if (elements.reviewLink) elements.reviewLink.href = STORE_URL;
}

export function playIntro(elements) {
  const g = gsapRef();
  if (!g || !motionOk()) return;
  const top = elements.headerIconWrap?.closest('.top');
  const fader = elements.fader;
  const sideKids = g.utils.toArray('.side > *');
  const foot = document.querySelector('.foot');
  const tl = g.timeline({ defaults: { ease: 'power3.out' } });
  tl.from(top, { y: -18, autoAlpha: 0, duration: 0.42 }, 0)
    .from(fader, { x: -28, autoAlpha: 0, duration: 0.5 }, 0.05)
    .from(sideKids, { y: 16, autoAlpha: 0, duration: 0.38, stagger: 0.05 }, 0.08)
    .from(foot, { y: 12, autoAlpha: 0, duration: 0.32 }, 0.26)
    .from('.tick', { autoAlpha: 0, x: -6, duration: 0.28, stagger: 0.016 }, 0.16)
    .from('.handle-tab', { autoAlpha: 0, duration: 0.35 }, 0.22)
    .from('.tube', { autoAlpha: 0.35, duration: 0.45 }, 0.1);
}

export function punch(el, limitTab, scale = 1.04) {
  const g = gsapRef();
  if (!g || !motionOk() || !el) return;
  if (el === limitTab || el?.classList?.contains('handle-tab')) {
    g.fromTo(el, { autoAlpha: 0.7 }, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' });
    return;
  }
  g.fromTo(el, { scale: 1 }, {
    scale,
    duration: 0.12,
    yoyo: true,
    repeat: 1,
    ease: 'power2.out',
    clearProps: 'transform'
  });
}

export function setPathHelpOpen(elements, open) {
  const panel = elements.pathHelpPanel;
  const scrim = elements.pathHelpScrim;
  const card = panel?.querySelector('.path-sheet-card');
  if (!panel || !card) return;
  const g = gsapRef();
  if (open) {
    panel.hidden = false;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (g && motionOk()) {
      g.killTweensOf([scrim, card]);
      g.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: 'power2.out' });
      g.fromTo(
        card,
        { opacity: 0, scale: 0.94, y: 10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: 'power3.out' }
      );
    } else {
      if (scrim) scrim.style.opacity = '1';
      card.style.opacity = '1';
      card.style.transform = 'none';
    }
  } else {
    const finish = () => {
      panel.hidden = true;
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      if (g) g.set([scrim, card], { clearProps: 'opacity,transform' });
    };
    if (g && motionOk() && !panel.hidden) {
      g.killTweensOf([scrim, card]);
      g.to(scrim, { opacity: 0, duration: 0.18, ease: 'power2.in' });
      g.to(card, {
        opacity: 0,
        scale: 0.96,
        y: 8,
        duration: 0.2,
        ease: 'power2.in',
        onComplete: finish
      });
    } else {
      finish();
    }
  }
}

/** Reclaim any tooltip left on document.body (avoids ghost squares after hover). */
export function sweepFloatingTooltips() {
  const g = gsapRef();
  document.querySelectorAll('.tooltip.is-floating').forEach(tooltip => {
    if (g) g.killTweensOf(tooltip);
    tooltip.classList.remove('is-floating');
    tooltip.style.cssText = '';
    if (g) g.set(tooltip, { clearProps: 'all' });
    const home = tooltip.dataset.tipHome
      ? document.querySelector(`.tip[data-tip-id="${tooltip.dataset.tipHome}"]`)
      : null;
    if (home) home.appendChild(tooltip);
    else tooltip.remove();
  });
}

export function setSettingsOpen(elements, open) {
  const sheet = elements.settingsView;
  if (!sheet) return;
  const g = gsapRef();
  document.getElementById('homeView')?.setAttribute('aria-hidden', String(open));
  sheet.setAttribute('aria-hidden', String(!open));
  if (open) {
    sheet.classList.add('visible');
    if (g && motionOk()) {
      g.fromTo(sheet, { autoAlpha: 0, x: 28 }, { autoAlpha: 1, x: 0, duration: 0.35, ease: 'power3.out' });
      g.from('.sheet-scroll > *', { y: 12, autoAlpha: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out', delay: 0.05 });
    }
  } else if (g && motionOk() && sheet.classList.contains('visible')) {
    sweepFloatingTooltips();
    g.to(sheet, {
      autoAlpha: 0,
      x: 20,
      duration: 0.22,
      ease: 'power2.in',
      onComplete: () => {
        sheet.classList.remove('visible');
        g.set(sheet, { clearProps: 'transform,opacity,visibility' });
      }
    });
  } else {
    sweepFloatingTooltips();
    sheet.classList.remove('visible');
  }
}

export function buildScale(elements) {
  const scale = elements.scale;
  if (!scale) return;
  for (let db = METER_MAX_DB; db >= METER_MIN_DB; db -= 10) {
    const tick = document.createElement('span');
    const major = db % 20 === 0;
    tick.className = `tick mono${major ? '' : ' minor'}`;
    tick.style.setProperty('--p', dbToFrac(db));
    if (major) tick.textContent = fmtDB(db);
    scale.appendChild(tick);
  }
}

export function paintScenarioLimits() {
  document.querySelectorAll('[data-scenario-meta]').forEach(el => {
    const id = el.dataset.scenarioMeta;
    const p = SCENARIO_PRESETS?.[id];
    if (!p) return;
    const modeKey = !p.levelingEnabled
      ? 'scenarioMetaPeaks'
      : id === 'social'
        ? 'scenarioMetaStrongEven'
        : 'scenarioMetaEven';
    const mode = chrome.i18n.getMessage(modeKey);
    el.textContent = `${mode} · ${fmtDB(p.limitDB)}`;
  });
}

export function paintCeiling(elements, limitDB) {
  const limit = clampDB(limitDB);
  const { fader, limitHandle, limitTab, limitValue } = elements;
  fader?.style.setProperty('--ceilp', String(dbToFrac(limit)));
  if (limitHandle) {
    limitHandle.setAttribute('aria-valuenow', String(limit));
    limitHandle.setAttribute('aria-valuetext', fmtDB(limit, 'dBFS'));
  }
  if (limitTab) limitTab.textContent = fmtDB(limit);
  if (limitValue) limitValue.textContent = fmtDB(limit, 'dBFS');
}

export function applyCeilingHint(elements, levelingEnabled) {
  const el = elements.ceilingHint;
  if (!el) return;
  const key = levelingEnabled ? 'ceilingHintEven' : 'ceilingHint';
  el.textContent = chrome.i18n.getMessage(key) || el.textContent;
}

export function applyEnableUI(elements, enabled, animate = false) {
  const on = enabled;
  const btn = elements.mainToggle;
  const label = elements.toggleText;
  const nextLabel = chrome.i18n.getMessage(on ? 'powerOnLabel' : 'powerOffLabel');
  btn?.classList.toggle('enabled', on);
  btn?.setAttribute('aria-checked', String(on));
  document.body.classList.toggle('is-on', on);
  elements.headerIconWrap?.classList.toggle('active', on);

  const knob = btn?.querySelector('.power-switch-knob');
  const track = btn?.querySelector('.power-switch-track');
  const g = gsapRef();
  const knobX = on ? 18 : 0;

  if (animate && g && motionOk() && knob) {
    g.killTweensOf([knob, track, label].filter(Boolean));
    g.to(knob, { x: knobX, duration: 0.32, ease: 'power3.out' });
    if (label && label.textContent !== nextLabel) {
      g.to(label, {
        y: -6,
        autoAlpha: 0,
        duration: 0.14,
        ease: 'power2.in',
        onComplete: () => {
          label.textContent = nextLabel;
          g.fromTo(label, { y: 6, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.2, ease: 'power2.out' });
        }
      });
    } else if (label) {
      label.textContent = nextLabel;
    }
  } else {
    if (g && knob) g.set(knob, { x: knobX });
    else if (knob) knob.style.transform = `translateX(${knobX}px)`;
    if (label) label.textContent = nextLabel;
  }
}

/** Path label per HQ state (see Popup.hqState); 'off' = HQ not requested. */
const HQ_LABEL_KEYS = {
  off: 'pathElement',
  active: 'pathCapture',
  elsewhere: 'statusPathStandby',
  unavailable: 'statusPathPaused'
};
/** The chip is clickable, so its paused label also says how to resume. */
const HQ_CHIP_KEYS = { ...HQ_LABEL_KEYS, unavailable: 'statusPathUnavailable' };

export function applyPathUI(elements, config, hq = 'off') {
  // Icon/label show the preference (also while off); the highlight shows HQ actually requested.
  const prefersHq = config.audioPath !== 'element';
  elements.pathToggle.classList.toggle('enabled', hq !== 'off');
  elements.pathToggle.setAttribute('aria-pressed', String(prefersHq));
  const hqIcon = elements.pathToggle.querySelector('.icon-hq');
  const fsIcon = elements.pathToggle.querySelector('.icon-fs');
  if (hqIcon) hqIcon.hidden = !prefersHq;
  if (fsIcon) fsIcon.hidden = prefersHq;
  if (elements.pathChipLabel) {
    const key = !prefersHq ? 'pathElement' : hq === 'off' ? 'pathCapture' : HQ_CHIP_KEYS[hq];
    elements.pathChipLabel.textContent = chrome.i18n.getMessage(key);
  }
}

export function applyDomainChip(elements, { host, domainSaved, global }) {
  if (!elements.domainChip) return;
  if (!host) {
    elements.domainChip.hidden = true;
    return;
  }
  elements.domainChip.hidden = false;
  elements.domainLabel.textContent = host;
  elements.domainSavedBadge.hidden = !domainSaved || global;
  elements.forgetDomain.hidden = !domainSaved || global;
}

export function applyStatusLine(elements, { enabled, levelingEnabled, hq }, animate = false) {
  const el = elements.statusLine;
  if (!el) return;
  let next;
  if (!enabled) {
    next = chrome.i18n.getMessage('extensionDescription');
  } else {
    const mode = chrome.i18n.getMessage(levelingEnabled ? 'statusModeEven' : 'statusModePeaks');
    next = `${mode} · ${chrome.i18n.getMessage(HQ_LABEL_KEYS[hq] ?? 'pathElement')}`;
  }
  if (next === el.textContent) return;

  const g = gsapRef();
  if (animate && g && motionOk()) {
    g.killTweensOf(el);
    g.to(el, {
      y: -5,
      autoAlpha: 0,
      duration: 0.14,
      ease: 'power2.in',
      onComplete: () => {
        el.textContent = next;
        g.fromTo(el, { y: 6, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.22, ease: 'power2.out' });
      }
    });
  } else {
    el.textContent = next;
  }
}

export function applyGlobalToggleUI(elements, global) {
  elements.globalToggle?.classList.toggle('active', global);
  elements.globalToggle?.setAttribute('aria-checked', String(!!global));
}

export function applyLevelingUI(elements, levelingEnabled) {
  const btn = elements.evenVolumeToggle;
  btn?.classList.toggle('active', !!levelingEnabled);
  btn?.setAttribute('aria-checked', String(!!levelingEnabled));
}

export function updateThemeButtons(elements) {
  const current = readTheme();
  elements.themeSelector?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeChoice === current);
  });
}

export function updatePresetButtons(elements, activePreset) {
  elements.presetSelector?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === activePreset);
  });
}

export function updateScenarioButtons(elements, active) {
  elements.scenarioSelector?.querySelectorAll('button').forEach(btn => {
    const on = btn.dataset.scenario === active;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

export function updatePathSelector(elements, audioPath) {
  const path = audioPath || 'capture';
  elements.pathSelector?.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.path === path);
  });
}

export function syncAllUI(ctx) {
  const { elements, config, host, domainSaved, hq } = ctx;
  paintCeiling(elements, config.limitDB);
  applyEnableUI(elements, config.enabled);
  applyPathUI(elements, config, hq);
  updatePathSelector(elements, config.audioPath);
  updateScenarioButtons(elements, config.scenario);
  updatePresetButtons(elements, config.limiterStrength);
  applyGlobalToggleUI(elements, config.global);
  applyLevelingUI(elements, config.levelingEnabled);
  applyDomainChip(elements, { host, domainSaved, global: config.global });
  applyCeilingHint(elements, config.levelingEnabled);
  applyStatusLine(elements, {
    enabled: config.enabled,
    levelingEnabled: config.levelingEnabled,
    hq
  });
}

/** Overlay thumbs that fade in on hover / while scrolling (native bars don't animate). */
export function bindFadeScrollbars(root = document) {
  root.querySelectorAll('.side, .sheet-scroll').forEach(el => {
    if (el.dataset.fadeScrollBound) return;
    el.dataset.fadeScrollBound = '1';
    el.classList.add('fade-scroll');

    const host = document.createElement('div');
    host.className = 'fade-scroll-host';
    el.parentNode.insertBefore(host, el);
    host.appendChild(el);

    const rail = document.createElement('div');
    rail.className = 'fade-scroll-rail';
    rail.hidden = true;
    rail.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'fade-scroll-thumb';
    rail.appendChild(thumb);
    host.appendChild(rail);

    let scrollTimer = 0;
    const sync = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const overflow = scrollHeight > clientHeight + 1;
      rail.hidden = !overflow;
      if (!overflow) {
        host.classList.remove('is-scrolling');
        return;
      }
      const trackH = Math.max(0, rail.clientHeight || clientHeight);
      const thumbH = Math.max(22, (clientHeight / scrollHeight) * trackH);
      const maxTop = Math.max(0, trackH - thumbH);
      const top =
        scrollHeight > clientHeight
          ? (scrollTop / (scrollHeight - clientHeight)) * maxTop
          : 0;
      thumb.style.height = `${thumbH}px`;
      thumb.style.transform = `translateY(${top}px)`;
    };

    const onScroll = () => {
      sync();
      host.classList.add('is-scrolling');
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => host.classList.remove('is-scrolling'), 700);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    host.addEventListener('mouseenter', sync);
    window.addEventListener('resize', sync);
    requestAnimationFrame(sync);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(sync);
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
  });
}

export function bindTooltips() {
  sweepFloatingTooltips();
  let tipSeq = 0;
  document.querySelectorAll('.tip').forEach(icon => {
    const tooltip = icon.querySelector('.tooltip');
    if (!tooltip) return;

    const tipId = String(++tipSeq);
    icon.dataset.tipId = tipId;
    tooltip.dataset.tipHome = tipId;

    const park = () => {
      const g = gsapRef();
      if (g) {
        g.killTweensOf(tooltip);
        g.set(tooltip, { clearProps: 'all' });
      }
      tooltip.classList.remove('is-floating');
      tooltip.style.cssText = '';
      if (tooltip.parentElement !== icon) icon.appendChild(tooltip);
    };

    const place = () => {
      const g = gsapRef();
      const pad = 8;
      const gap = 8;
      const iconRect = icon.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      if (g) g.set(tooltip, { x: 0, y: 0 });
      else tooltip.style.transform = 'none';

      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.style.visibility = 'hidden';
      tooltip.style.opacity = '1';
      const tw = tooltip.offsetWidth || 180;
      const th = tooltip.offsetHeight || 48;

      let left = iconRect.left + iconRect.width / 2 - tw / 2;
      left = Math.max(pad, Math.min(left, vw - pad - tw));

      const spaceBelow = vh - iconRect.bottom - gap;
      const spaceAbove = iconRect.top - gap;
      const preferAbove = spaceBelow < th && spaceAbove > spaceBelow;
      const top = preferAbove ? iconRect.top - gap - th : iconRect.bottom + gap;

      tooltip.dataset.tipSide = preferAbove ? 'above' : 'below';
      tooltip.style.left = `${Math.round(left)}px`;
      tooltip.style.top = `${Math.round(Math.max(pad, top))}px`;
      tooltip.style.opacity = '0';
    };

    const show = () => {
      const g = gsapRef();
      sweepFloatingTooltips();
      tooltip.classList.add('is-floating');
      document.body.appendChild(tooltip);
      place();
      const fromY = tooltip.dataset.tipSide === 'above' ? -4 : 4;
      if (g && motionOk()) {
        g.killTweensOf(tooltip);
        g.fromTo(
          tooltip,
          { autoAlpha: 0, y: fromY },
          { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out', overwrite: 'auto' }
        );
      } else {
        tooltip.style.opacity = '1';
        tooltip.style.visibility = 'visible';
      }
    };

    const hide = () => {
      const g = gsapRef();
      if (!tooltip.classList.contains('is-floating')) return;
      const toY = tooltip.dataset.tipSide === 'above' ? -3 : 3;
      if (g && motionOk()) {
        g.killTweensOf(tooltip);
        g.to(tooltip, {
          autoAlpha: 0,
          y: toY,
          duration: 0.12,
          ease: 'power2.in',
          overwrite: 'auto',
          onComplete: park
        });
      } else {
        park();
      }
    };

    icon.addEventListener('mouseenter', show);
    icon.addEventListener('mouseleave', hide);
    icon.addEventListener('focusin', show);
    icon.addEventListener('focusout', hide);
  });
}

export function showCoachmarkStep(ctx) {
  const { elements, coachmarkStepIndex, setSettingsOpenFn } = ctx;
  const tooltip = elements.coachmark?.querySelector('.coachmark-tooltip');
  if (tooltip) {
    tooltip.classList.remove('coachmark-tooltip-anim');
    void tooltip.offsetWidth;
    tooltip.classList.add('coachmark-tooltip-anim');
  }
  if (coachmarkStepIndex === -1) {
    elements.coachmark?.classList.add('coachmark-intro');
    document.body.classList.add('coachmark-open');
    if (elements.coachmarkStep) elements.coachmarkStep.textContent = '';
    if (elements.coachmarkText) elements.coachmarkText.textContent = chrome.i18n.getMessage('coachmarkIntro');
    if (elements.coachmarkNext) elements.coachmarkNext.textContent = chrome.i18n.getMessage('coachmarkStart');
    elements.coachmark?.querySelector('.coachmark-hole')?.remove();
    elements.coachmark?.removeAttribute('hidden');
    return coachmarkStepIndex;
  }
  elements.coachmark?.classList.remove('coachmark-intro');
  const step = COACHMARK_STEPS[coachmarkStepIndex];
  if (!step) {
    elements.coachmark?.setAttribute('hidden', '');
    document.body.classList.remove('coachmark-open');
    chrome.storage.local.set({ [WHATS_NEW_STORAGE_KEY]: WHATS_NEW_VERSION });
    setSettingsOpenFn(false);
    return coachmarkStepIndex;
  }
  document.body.classList.add('coachmark-open');
  setSettingsOpenFn(!!step.openSettings);
  const isLast = coachmarkStepIndex === COACHMARK_STEPS.length - 1;
  if (elements.coachmarkStep) {
    elements.coachmarkStep.textContent = `${coachmarkStepIndex + 1}/${COACHMARK_STEPS.length}`;
  }
  if (elements.coachmarkText) {
    elements.coachmarkText.textContent = chrome.i18n.getMessage(step.textKey);
  }
  if (elements.coachmarkNext) {
    elements.coachmarkNext.textContent = chrome.i18n.getMessage(isLast ? 'coachmarkDone' : 'coachmarkNext');
  }
  elements.coachmark?.removeAttribute('hidden');
  return coachmarkStepIndex;
}

export function positionCoachmark(elements, coachmarkStepIndex) {
  if (elements.coachmark?.hasAttribute('hidden')) return;
  const step = COACHMARK_STEPS[coachmarkStepIndex];
  const target = step && document.getElementById(step.targetId);
  const tooltip = elements.coachmark?.querySelector('.coachmark-tooltip');
  if (!target || !tooltip) return;
  const sheetScroll = elements.settingsView?.querySelector('.sheet-scroll');
  if (sheetScroll && elements.settingsView?.classList.contains('visible')) {
    const tTop = target.offsetTop - 24;
    sheetScroll.scrollTop = Math.max(0, tTop);
  }
  const rect = target.getBoundingClientRect();
  const pad = 8;
  let hole = elements.coachmark.querySelector('.coachmark-hole');
  if (!hole) {
    hole = document.createElement('div');
    hole.className = 'coachmark-hole';
    elements.coachmark.prepend(hole);
  }
  hole.style.top = `${rect.top - pad}px`;
  hole.style.left = `${rect.left - pad}px`;
  hole.style.width = `${rect.width + pad * 2}px`;
  hole.style.height = `${rect.height + pad * 2}px`;
  const bodyRect = document.body.getBoundingClientRect();
  const tooltipHeight = tooltip.offsetHeight || 90;
  const spaceBelow = bodyRect.bottom - rect.bottom;
  const top = spaceBelow > tooltipHeight + 16 ? rect.bottom + 10 : rect.top - tooltipHeight - 10;
  const left = Math.min(Math.max(rect.left, 12), bodyRect.width - tooltip.offsetWidth - 12);
  tooltip.style.top = `${Math.max(top, 12)}px`;
  tooltip.style.left = `${left}px`;
}

export function renderMeter(elements, { displayDB, isActive, currentGainDB, setGainVisible }) {
  const valid = typeof displayDB === 'number' && isFinite(displayDB);
  const { averageDB, gainReadout, meterTube } = elements;

  // Post-limiter level: it can't exceed the ceiling, so what was cut shows as "Reduction".
  if (averageDB) averageDB.textContent = fmtDB(displayDB);
  if (gainReadout) {
    const show = isActive && typeof currentGainDB === 'number' && isFinite(currentGainDB);
    if (show) {
      const reduction = Math.max(0, -currentGainDB);
      gainReadout.textContent = `${chrome.i18n.getMessage('reductionLabel')} ${reduction.toFixed(1)} dB`;
    }
    setGainVisible(show);
  }
  meterTube?.style.setProperty('--levelp', valid ? String(dbToFrac(displayDB)) : '0');
}

export function setGainVisible(elements, gainVisibleRef, show) {
  const el = elements.gainReadout;
  if (!el || show === gainVisibleRef.value) return;
  gainVisibleRef.value = show;
  el.classList.toggle('is-visible', show);
  el.setAttribute('aria-hidden', String(!show));
  const g = gsapRef();
  if (g && motionOk()) {
    g.killTweensOf(el);
    g.to(el, { opacity: show ? 1 : 0, duration: show ? 0.22 : 0.16, ease: 'power2.out' });
  } else {
    el.style.opacity = show ? '1' : '0';
  }
}

export { clampDB, dbToFrac, fmtDB, METER_MIN_DB, METER_MAX_DB };
export { THEME_KEY, applyTheme } from './theme.js';

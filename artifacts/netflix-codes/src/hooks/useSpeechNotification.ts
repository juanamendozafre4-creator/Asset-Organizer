import { useEffect, useRef, useState } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

const UNLOCK_STORAGE_KEY = "speech_unlocked_v3";

const DEFAULT_WELCOME_MESSAGE =
  "Elige el código que sea los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const DEFAULT_NEW_CODE_MESSAGE =
  "Llegó un código nuevo, verifica que sean los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const CODE_TTL_MS = 15 * 60 * 1000;

const speechSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

function isExpired(receivedAt: string) {
  return Date.now() - new Date(receivedAt).getTime() > CODE_TTL_MS;
}

export interface SpeechConfig {
  welcomeMessage?: string | null;
  newCodeMessage?: string | null;
  repeatInterval?: number | null;
  voiceWelcomeEnabled?: boolean | null;
  voiceNewCodeEnabled?: boolean | null;
}

export function useSpeechNotification(codes: NetflixCode[], config?: SpeechConfig) {
  // All mutable state in refs to avoid stale closures inside timers/effects
  const unlockedRef       = useRef(false);
  const welcomeSpokenRef  = useRef(false);
  const isSpeakingRef     = useRef(false);
  const pendingRef        = useRef<string | null>(null);
  const prevTopIdRef      = useRef<string | null>(null);
  const cleanupGestureRef = useRef<(() => void) | null>(null);

  // Config refs – always current inside any closure
  const welcomeTextRef         = useRef(DEFAULT_WELCOME_MESSAGE);
  const newCodeTextRef         = useRef(DEFAULT_NEW_CODE_MESSAGE);
  const voiceWelcomeEnabledRef = useRef(true);
  const voiceNewCodeEnabledRef = useRef(true);
  const repeatMsRef            = useRef<number | null>(null);

  // Sync refs every render
  welcomeTextRef.current         = config?.welcomeMessage?.trim() || DEFAULT_WELCOME_MESSAGE;
  newCodeTextRef.current         = config?.newCodeMessage?.trim() || DEFAULT_NEW_CODE_MESSAGE;
  voiceWelcomeEnabledRef.current = config?.voiceWelcomeEnabled !== false;
  voiceNewCodeEnabledRef.current = config?.voiceNewCodeEnabled !== false;
  repeatMsRef.current =
    config?.repeatInterval && config.repeatInterval > 0
      ? config.repeatInterval * 1000
      : null;

  // For effects that need primitive dep values
  const repeatMs           = repeatMsRef.current;
  const voiceWelcomeEnabled = voiceWelcomeEnabledRef.current;

  const [needsUnlock, setNeedsUnlock] = useState(false);

  // ── Speak ──────────────────────────────────────────────────────────────────
  function doSpeak(text: string) {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    pendingRef.current    = null;

    const u  = new SpeechSynthesisUtterance(text);
    u.lang   = "es-ES";
    u.rate   = 0.9;
    u.pitch  = 1;
    u.volume = 1;

    // Prefer a local Spanish voice on iOS to avoid TTS service dependency
    try {
      const voices  = window.speechSynthesis.getVoices();
      const local   = voices.find(v => v.lang.startsWith("es") && v.localService);
      const anyEs   = voices.find(v => v.lang.startsWith("es"));
      if (local) u.voice = local;
      else if (anyEs) u.voice = anyEs;
    } catch {}

    u.onstart = () => { isSpeakingRef.current = true; };
    u.onend   = () => {
      isSpeakingRef.current = false;
      const queued = pendingRef.current;
      if (queued) {
        pendingRef.current = null;
        setTimeout(() => doSpeak(queued), 400);
      }
    };
    u.onerror = () => {
      isSpeakingRef.current = false;
      pendingRef.current    = null;
    };

    window.speechSynthesis.speak(u);
  }

  // Queue – plays after current finishes, never interrupts
  function speakOrQueue(text: string) {
    if (!speechSupported || !unlockedRef.current) return;
    if (isSpeakingRef.current) { pendingRef.current = text; }
    else { doSpeak(text); }
  }

  // Only speak if nothing is playing
  function speakIfFree(text: string) {
    if (!speechSupported || !unlockedRef.current) return;
    if (!isSpeakingRef.current) doSpeak(text);
  }

  // ── Unlock + speak welcome (MUST be called synchronously from a gesture) ──
  function unlockAndSpeak() {
    if (!speechSupported) return;
    unlockedRef.current = true;
    setNeedsUnlock(false);
    try { localStorage.setItem(UNLOCK_STORAGE_KEY, "1"); } catch {}

    if (!welcomeSpokenRef.current && voiceWelcomeEnabledRef.current) {
      welcomeSpokenRef.current = true;
      doSpeak(welcomeTextRef.current);
    }

    // Remove global gesture listeners – unlock done
    cleanupGestureRef.current?.();
  }

  // ── Read localStorage on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!speechSupported) return;
    try {
      if (localStorage.getItem(UNLOCK_STORAGE_KEY) === "1") {
        unlockedRef.current = true;
      }
    } catch {}
  }, []);

  // ── Global gesture listeners – any touch/click anywhere unlocks audio ──────
  // touchstart / click / pointerdown are synchronous user gestures →
  // calling speechSynthesis.speak() inside them works on iOS Safari.
  useEffect(() => {
    if (!speechSupported) return;

    function onGesture() {
      if (unlockedRef.current) {
        // Already unlocked (previous session) – just speak welcome once
        if (!welcomeSpokenRef.current && voiceWelcomeEnabledRef.current) {
          welcomeSpokenRef.current = true;
          doSpeak(welcomeTextRef.current);
        }
        cleanupGestureRef.current?.();
        setNeedsUnlock(false);
      } else {
        // First time – unlock + speak
        unlockAndSpeak();
      }
    }

    // Show visual hint on first mouse move (desktop) or after 1.5 s (mobile)
    function onMouseMove() {
      removeMouseMove();
      if (!unlockedRef.current) setNeedsUnlock(true);
    }
    function removeMouseMove() {
      document.removeEventListener("mousemove", onMouseMove);
    }

    function cleanup() {
      document.removeEventListener("touchstart",  onGesture);
      document.removeEventListener("click",       onGesture);
      document.removeEventListener("pointerdown", onGesture);
      removeMouseMove();
    }
    cleanupGestureRef.current = cleanup;

    document.addEventListener("touchstart",  onGesture, { passive: true });
    document.addEventListener("click",       onGesture);
    document.addEventListener("pointerdown", onGesture, { passive: true });
    document.addEventListener("mousemove",   onMouseMove, { passive: true });

    // Show hint after 1.5 s so mobile users who haven't touched yet see it
    const hintTimer = setTimeout(() => {
      if (!unlockedRef.current) setNeedsUnlock(true);
    }, 1500);

    return () => {
      cleanup();
      clearTimeout(hintTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only – config refs always hold fresh values

  // ── New-code detector ──────────────────────────────────────────────────────
  useEffect(() => {
    if (codes.length === 0) return;
    const top = codes[0];

    if (prevTopIdRef.current === null) {
      prevTopIdRef.current = top.id;
      return;
    }

    if (top.id !== prevTopIdRef.current) {
      prevTopIdRef.current = top.id;
      if (
        unlockedRef.current &&
        !isExpired(top.receivedAt) &&
        voiceNewCodeEnabledRef.current
      ) {
        speakOrQueue(newCodeTextRef.current);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  // ── Repeat welcome message ─────────────────────────────────────────────────
  useEffect(() => {
    if (!repeatMs || !voiceWelcomeEnabled) return;

    const id = setInterval(() => {
      if (unlockedRef.current && voiceWelcomeEnabledRef.current) {
        speakIfFree(welcomeTextRef.current);
      }
    }, repeatMs);

    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatMs, voiceWelcomeEnabled]);

  return { needsUnlock, unlockAudio: unlockAndSpeak };
}

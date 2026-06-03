import { useEffect, useRef, useState, useCallback } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

const UNLOCK_STORAGE_KEY = "speech_unlocked_v2";

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
  /** Repeat interval in seconds. null / 0 = no repeat. */
  repeatInterval?: number | null;
  /** If false, welcome message voice is disabled */
  voiceWelcomeEnabled?: boolean | null;
  /** If false, new-code alert voice is disabled */
  voiceNewCodeEnabled?: boolean | null;
}

export function useSpeechNotification(codes: NetflixCode[], config?: SpeechConfig) {
  // Was audio unlocked by a user gesture in this session or a previous one
  const unlockedRef = useRef(false);
  // Has the user interacted with the page (any touch/click/move)
  const hasInteractedRef = useRef(false);
  // Is speech currently playing
  const isSpeakingRef = useRef(false);
  // Message to play after current finishes (queue — never interrupts)
  const pendingRef = useRef<string | null>(null);
  // Track top code ID to detect newly arrived codes
  const prevTopIdRef = useRef<string | null>(null);

  // Show banner asking user to tap (only when audio is not yet unlocked)
  const [needsUnlock, setNeedsUnlock] = useState(false);

  // Always use latest config text via refs (avoids stale closures in effects)
  const welcomeTextRef = useRef(DEFAULT_WELCOME_MESSAGE);
  const newCodeTextRef = useRef(DEFAULT_NEW_CODE_MESSAGE);
  welcomeTextRef.current = config?.welcomeMessage?.trim() || DEFAULT_WELCOME_MESSAGE;
  newCodeTextRef.current = config?.newCodeMessage?.trim() || DEFAULT_NEW_CODE_MESSAGE;

  // Voice feature flags — default to true (enabled)
  const voiceWelcomeEnabled = config?.voiceWelcomeEnabled !== false;
  const voiceNewCodeEnabled = config?.voiceNewCodeEnabled !== false;

  const repeatMs =
    config?.repeatInterval && config.repeatInterval > 0
      ? config.repeatInterval * 1000
      : null;

  // ── Internal speak function ─────────────────────────────────────────────────
  // Plays text immediately (assumes audio is unlocked, cancels whatever was queued).
  function doSpeak(text: string) {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 0.95;
    u.pitch = 1;
    u.onstart = () => { isSpeakingRef.current = true; };
    u.onend = () => {
      isSpeakingRef.current = false;
      // Play queued message (e.g. new-code message that arrived while welcome played)
      const queued = pendingRef.current;
      if (queued) {
        pendingRef.current = null;
        setTimeout(() => doSpeak(queued), 300);
      }
    };
    u.onerror = () => {
      isSpeakingRef.current = false;
      pendingRef.current = null;
    };
    window.speechSynthesis.speak(u);
  }

  // Speak now if idle, or queue to play after current speech ends (never interrupts)
  function speakOrQueue(text: string) {
    if (!speechSupported || !unlockedRef.current) return;
    if (isSpeakingRef.current) {
      pendingRef.current = text;
    } else {
      doSpeak(text);
    }
  }

  // Speak only if nothing is currently playing (silently skipped if busy)
  function speakIfFree(text: string) {
    if (!speechSupported || !unlockedRef.current) return;
    if (!isSpeakingRef.current) {
      doSpeak(text);
    }
  }

  // ── Check localStorage on mount ─────────────────────────────────────────────
  // If the user already unlocked audio in a previous visit, remember it.
  useEffect(() => {
    if (!speechSupported) return;
    try {
      if (localStorage.getItem(UNLOCK_STORAGE_KEY) === "1") {
        unlockedRef.current = true;
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — ignore
    }
  }, []);

  // ── Unlock audio (MUST be called directly from a button onClick) ───────────
  // iOS Safari only allows speechSynthesis inside a synchronous user-gesture handler.
  // This function is called from the banner's onClick — that guarantees it works on iOS.
  const unlockAudio = useCallback(() => {
    if (!speechSupported) return;

    unlockedRef.current = true;
    hasInteractedRef.current = true;
    setNeedsUnlock(false);

    try { localStorage.setItem(UNLOCK_STORAGE_KEY, "1"); } catch {}

    if (voiceWelcomeEnabled) {
      // Called synchronously inside onClick → iOS Safari allows speechSynthesis here
      doSpeak(welcomeTextRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceWelcomeEnabled]);

  // ── First interaction detector ──────────────────────────────────────────────
  // Runs once on the first touch/click/mousemove after page load.
  useEffect(() => {
    if (!speechSupported) return;

    function handleFirstInteraction() {
      if (hasInteractedRef.current) return;
      hasInteractedRef.current = true;

      document.removeEventListener("touchstart", handleFirstInteraction);
      document.removeEventListener("click", handleFirstInteraction);
      document.removeEventListener("mousemove", handleFirstInteraction);
      document.removeEventListener("pointerdown", handleFirstInteraction);

      if (!unlockedRef.current) {
        // Never been unlocked — show the banner so the user can tap it directly.
        // The banner has an onClick={unlockAudio} which will call doSpeak()
        // synchronously within that click event → works on iOS.
        setNeedsUnlock(true);
      } else if (voiceWelcomeEnabled) {
        // Already unlocked from a previous session — speak welcome now.
        // We are inside a touchstart/click handler so iOS allows this.
        doSpeak(welcomeTextRef.current);
      }
    }

    document.addEventListener("touchstart", handleFirstInteraction, { passive: true });
    document.addEventListener("click", handleFirstInteraction);
    document.addEventListener("mousemove", handleFirstInteraction, { passive: true });
    document.addEventListener("pointerdown", handleFirstInteraction, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleFirstInteraction);
      document.removeEventListener("click", handleFirstInteraction);
      document.removeEventListener("mousemove", handleFirstInteraction);
      document.removeEventListener("pointerdown", handleFirstInteraction);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // ── New code detector ───────────────────────────────────────────────────────
  // When a NEW code arrives, queue the alert to play after whatever is currently
  // playing (welcome message, repeat, etc.). NEVER interrupts.
  useEffect(() => {
    if (codes.length === 0) return;
    const topCode = codes[0];

    // Initialize on first render — don't speak on initial page load
    if (prevTopIdRef.current === null) {
      prevTopIdRef.current = topCode.id;
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      if (
        hasInteractedRef.current &&
        unlockedRef.current &&
        !isExpired(topCode.receivedAt) &&
        voiceNewCodeEnabled
      ) {
        // Queue — plays after current speech ends, does NOT interrupt welcome
        speakOrQueue(newCodeTextRef.current);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codes]);

  // ── Repeat welcome ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!repeatMs || !voiceWelcomeEnabled) return;

    const interval = setInterval(() => {
      if (hasInteractedRef.current && unlockedRef.current) {
        speakIfFree(welcomeTextRef.current);
      }
    }, repeatMs);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatMs, voiceWelcomeEnabled]);

  return { needsUnlock, unlockAudio };
}

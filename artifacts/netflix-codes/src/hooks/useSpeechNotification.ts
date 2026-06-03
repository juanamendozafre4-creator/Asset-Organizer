import { useEffect, useRef, useState } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

const DEFAULT_WELCOME_MESSAGE =
  "Elige el código que sea los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const DEFAULT_NEW_CODE_MESSAGE =
  "Llegó un código nuevo, verifica que sean los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const CODE_TTL_MS = 15 * 60 * 1000;

const speechSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

function isExpired(receivedAt: string): boolean {
  return Date.now() - new Date(receivedAt).getTime() > CODE_TTL_MS;
}

interface SpeechConfig {
  welcomeMessage?: string | null;
  newCodeMessage?: string | null;
  repeatInterval?: number | null; // minutes, null/0 = no repeat
}

export function useSpeechNotification(codes: NetflixCode[], config?: SpeechConfig) {
  const prevTopIdRef = useRef<string | null>(null);
  const isFirstLoadRef = useRef(true);
  const unlockedRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const welcomeText = config?.welcomeMessage?.trim() || DEFAULT_WELCOME_MESSAGE;
  const newCodeText = config?.newCodeMessage?.trim() || DEFAULT_NEW_CODE_MESSAGE;
  const repeatMs = config?.repeatInterval && config.repeatInterval > 0
    ? config.repeatInterval * 60 * 1000
    : null;

  function doSpeak(text: string) {
    if (!speechSupported) return;

    if (unlockedRef.current) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-ES";
      utterance.rate = 0.95;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.95;
    utterance.pitch = 1;

    let started = false;

    utterance.onstart = () => {
      started = true;
      unlockedRef.current = true;
      setNeedsUnlock(false);
      pendingTextRef.current = null;
    };

    utterance.onerror = () => {
      if (!started) {
        pendingTextRef.current = text;
        setNeedsUnlock(true);
      }
    };

    window.speechSynthesis.speak(utterance);

    setTimeout(() => {
      if (!started && !unlockedRef.current) {
        pendingTextRef.current = text;
        setNeedsUnlock(true);
      }
    }, 400);
  }

  function unlockAudio() {
    if (!speechSupported) return;
    unlockedRef.current = true;
    setNeedsUnlock(false);
    const text = pendingTextRef.current ?? welcomeText;
    pendingTextRef.current = null;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  // Auto-unlock on ANY touch, click, mousemove or pointerdown on the page
  useEffect(() => {
    if (!needsUnlock || !speechSupported) return;

    const handler = () => unlockAudio();

    document.addEventListener("touchstart", handler, { once: true, passive: true });
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("mousemove", handler, { once: true, passive: true });
    document.addEventListener("pointerdown", handler, { once: true, passive: true });

    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("click", handler);
      document.removeEventListener("mousemove", handler);
      document.removeEventListener("pointerdown", handler);
    };
  }, [needsUnlock]);

  // Speak on first load and on new codes
  useEffect(() => {
    if (codes.length === 0) return;

    const topCode = codes[0];

    if (isFirstLoadRef.current) {
      prevTopIdRef.current = topCode.id;
      isFirstLoadRef.current = false;
      doSpeak(welcomeText);
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      if (!isExpired(topCode.receivedAt)) {
        doSpeak(newCodeText);
      }
    }
  }, [codes, welcomeText, newCodeText]);

  // Repeat welcome message at the configured interval
  useEffect(() => {
    if (!repeatMs) return;

    const interval = setInterval(() => {
      doSpeak(welcomeText);
    }, repeatMs);

    return () => clearInterval(interval);
  }, [repeatMs, welcomeText]);

  return { needsUnlock, unlockAudio };
}

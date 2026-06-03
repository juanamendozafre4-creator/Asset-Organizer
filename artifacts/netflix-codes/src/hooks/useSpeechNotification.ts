import { useEffect, useRef, useState } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

const WELCOME_MESSAGE =
  "Elige el código que sea los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const MESSAGE =
  "Llegó un código nuevo, verifica que sean los datos de tu dispositivo y tu perfil y ponlo en tu dispositivo para seguir disfrutando de Netflix";

const CODE_TTL_MS = 15 * 60 * 1000;

const speechSupported =
  typeof window !== "undefined" && "speechSynthesis" in window;

function isExpired(receivedAt: string): boolean {
  return Date.now() - new Date(receivedAt).getTime() > CODE_TTL_MS;
}

export function useSpeechNotification(codes: NetflixCode[]) {
  const prevTopIdRef = useRef<string | null>(null);
  const isFirstLoadRef = useRef(true);
  const unlockedRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  function doSpeak(text: string) {
    if (!speechSupported) return;

    // Si ya sabemos que el audio está desbloqueado, hablar directamente
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

    // Fallback: si tras 400ms el navegador no inició la voz, mostrar botón
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
    const text = pendingTextRef.current ?? WELCOME_MESSAGE;
    pendingTextRef.current = null;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-ES";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    if (codes.length === 0) return;

    const topCode = codes[0];

    if (isFirstLoadRef.current) {
      prevTopIdRef.current = topCode.id;
      isFirstLoadRef.current = false;
      doSpeak(WELCOME_MESSAGE);
      return;
    }

    if (topCode.id !== prevTopIdRef.current) {
      prevTopIdRef.current = topCode.id;
      if (!isExpired(topCode.receivedAt)) {
        doSpeak(MESSAGE);
      }
    }
  }, [codes]);

  return { needsUnlock, unlockAudio };
}

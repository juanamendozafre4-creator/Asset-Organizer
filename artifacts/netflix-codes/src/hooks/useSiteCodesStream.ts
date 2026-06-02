import { useState, useEffect } from "react";
import type { NetflixCode } from "@workspace/api-client-react";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "error";

export function useSiteCodesStream(slug: string | undefined) {
  const [codes, setCodes] = useState<NetflixCode[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [isLoading, setIsLoading] = useState(true);
  const [imapError, setImapError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    setIsLoading(true);
    setStatus("connecting");
    setImapError(null);

    const es = new EventSource(`/api/sites/${slug}/stream`);

    es.addEventListener("codes", (e: MessageEvent) => {
      const data: NetflixCode[] = JSON.parse(e.data);
      setCodes(data);
      setIsLoading(false);
      setStatus("live");
      setImapError(null);
    });

    es.addEventListener("imap_error", (e: MessageEvent) => {
      const data: { message: string } = JSON.parse(e.data);
      setImapError(data.message);
      setIsLoading(false);
      setStatus("error");
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) {
        setStatus("reconnecting");
      } else if (es.readyState === EventSource.CLOSED) {
        setStatus("error");
      }
    };

    return () => {
      es.close();
    };
  }, [slug]);

  return { codes, status, isLoading, imapError };
}

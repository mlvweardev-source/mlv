'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Send } from 'lucide-react';
import { API_URL, ApiError, apiFetch, apiJson } from '@/lib/api';

type SenderType = 'customer' | 'admin' | 'ai_bot';

interface ChatMessage {
  id: string;
  senderId: string | null;
  senderType: SenderType;
  senderNama: string;
  pesan: string;
  createdAt: string;
}

interface ChatThread {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  messages: ChatMessage[];
  createdAt: string;
}

/**
 * Panel chat pelanggan ↔ admin (Customer Service) — Fase 10 Bagian 4.
 * Realtime via SSE (EventSource), pola sama dengan Internal Chat admin.
 *
 * Dari sisi pelanggan: semua pesan senderType='customer' = bubble kanan (saya),
 * senderType='admin' = bubble kiri (CS). Tidak perlu userId client-side karena
 * pelanggan adalah satu-satunya customer yang bisa posting di thread miliknya.
 */
export function CustomerChatPanel({ orderId }: { orderId: string }) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadThread = useCallback(async () => {
    try {
      const data = await apiFetch<ChatThread>(`/orders/${orderId}/customer-chat`);
      setThread(data);
      setError(null);
    } catch (e) {
      // 403 = bukan pemilik order — sembunyikan panel secara diam-diam
      if ((e as ApiError).status !== 403) {
        setError(e instanceof Error ? e.message : 'Gagal memuat chat');
      }
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  // SSE untuk realtime pesan baru
  useEffect(() => {
    if (!thread?.id) return;

    const es = new EventSource(`${API_URL}/orders/${orderId}/customer-chat/stream`, {
      withCredentials: true,
    });
    esRef.current = es;

    es.onmessage = (event) => {
      if (!event.data || event.data === ':') return; // skip ping
      try {
        const msg: ChatMessage = JSON.parse(event.data);
        setThread((prev) => (prev ? { ...prev, messages: [...prev.messages, msg] } : prev));
      } catch {
        /* ignore malformed */
      }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [thread?.id, orderId]);

  useEffect(() => {
    scrollToBottom();
  }, [thread?.messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await apiJson(`/orders/${orderId}/customer-chat`, 'POST', { pesan: input.trim() });
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal kirim pesan');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        Memuat chat…
      </div>
    );
  }

  return (
    <div className="flex h-96 flex-col rounded-lg border">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Headphones className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Chat Customer Service</span>
        <span className="ml-auto text-xs text-muted-foreground">Pesan realtime</span>
      </div>

      {error && <p className="px-4 py-1.5 text-xs text-destructive">{error}</p>}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!thread || thread.messages.length === 0 ? (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <Headphones className="mx-auto mb-2 h-6 w-6 opacity-40" />
            <p>Ada pertanyaan tentang pesanan ini?</p>
            <p className="text-xs">Kirim pesan di bawah — tim MLV akan membalas.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {thread.messages.map((msg) => {
              const isMe = msg.senderType === 'customer';
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                      isMe ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    {!isMe && (
                      <p className="mb-0.5 text-xs font-semibold opacity-70">{msg.senderNama}</p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.pesan}</p>
                  </div>
                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t px-3 py-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tulis pesan untuk tim MLV…"
          maxLength={2000}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          aria-label="Kirim pesan"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

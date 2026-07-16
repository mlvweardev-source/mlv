'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, User } from 'lucide-react';
import { API_URL, apiFetch, apiJson } from '@/lib/api';
import type { StaffRole } from '@/lib/auth';

interface ChatMessage {
  id: string;
  senderId: string;
  senderNama: string;
  pesan: string;
  createdAt: string;
}

interface ChatThread {
  id: string;
  orderId: string;
  orderNumber: string;
  messages: ChatMessage[];
  createdAt: string;
}

/**
 * Chat panel untuk halaman detail order.
 * Realtime via SSE (EventSource) — pesan baru muncul otomatis.
 * Owner & Manajer: selalu lihat; Tim Penjahit: hanya order miliknya.
 */
export function ChatPanel({
  orderId,
  role,
  userId,
}: {
  orderId: string;
  role: StaffRole;
  userId: string;
}) {
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
      const data = await apiFetch<ChatThread>(`/orders/${orderId}/internal-chat`);
      setThread(data);
      setError(null);
    } catch (e) {
      if ((e as { status?: number }).status !== 403) {
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

    const es = new EventSource(`${API_URL}/orders/${orderId}/internal-chat/stream`, {
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
      // Silently stop — browser auto-reconnects
      es.close();
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [thread?.id, orderId]);

  // Scroll ke bawah saat pesan baru
  useEffect(() => {
    scrollToBottom();
  }, [thread?.messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await apiJson(`/orders/${orderId}/internal-chat`, 'POST', { pesan: input.trim() });
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal kirim pesan');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Memuat chat…
      </div>
    );
  }

  return (
    <div className="flex h-80 flex-col rounded-lg border">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Chat Internal</span>
        {thread && (
          <span className="ml-auto text-xs text-muted-foreground">{thread.orderNumber}</span>
        )}
      </div>

      {error && <p className="px-3 py-1.5 text-xs text-destructive">{error}</p>}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!thread || thread.messages.length === 0 ? (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Belum ada pesan. Mulai percakapan di bawah.
          </p>
        ) : (
          <div className="space-y-2">
            {thread.messages.map((msg) => {
              const isMe = msg.senderId === userId;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                      isMe ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    {!isMe && (
                      <p className="mb-0.5 text-xs font-medium opacity-70">{msg.senderNama}</p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{msg.pesan}</p>
                  </div>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">
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
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t px-3 py-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ketik pesan…"
          maxLength={2000}
          className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

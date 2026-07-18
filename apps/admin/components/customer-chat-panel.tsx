'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
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
 * Panel chat pelanggan ↔ admin (Customer Chat) — Fase 10 Bagian 4.
 * Berbeda dari ChatPanel (Internal Chat staf-ke-staf), panel ini menampilkan
 * percakapan dengan PELANGGAN. Dipasang di halaman Order detail staf
 * supaya Owner/Manajer bisa balas chat tanpa aplikasi terpisah.
 *
 * Bubble logic (sisi staf):
 * - senderType='admin' && senderId===userId → bubble kanan (saya)
 * - senderType='admin' && senderId!==userId → bubble kiri (admin lain, tampilkan nama)
 * - senderType='customer' → bubble kiri (pelanggan, tampilkan nama)
 * - senderType='ai_bot' → bubble kiri (AI Assistant Fase 12)
 */
export function CustomerChatPanel({ orderId, userId }: { orderId: string; userId: string }) {
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
      if ((e as ApiError).status !== 403) {
        setError(e instanceof Error ? e.message : 'Gagal memuat chat pelanggan');
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
      if (!event.data || event.data === ':') return;
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
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        Memuat chat pelanggan…
      </div>
    );
  }

  return (
    <div className="flex h-96 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Chat Pelanggan</span>
        {thread && (
          <span className="ml-auto text-xs text-muted-foreground">{thread.orderNumber}</span>
        )}
      </div>

      {error && <p className="px-3 py-1.5 text-xs text-destructive">{error}</p>}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!thread || thread.messages.length === 0 ? (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Belum ada pesan dari pelanggan.
          </p>
        ) : (
          <div className="space-y-2">
            {thread.messages.map((msg) => {
              const isMe = msg.senderType === 'admin' && msg.senderId === userId;
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                      isMe ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}
                  >
                    {!isMe && (
                      <p className="mb-0.5 text-xs font-medium opacity-70">
                        {msg.senderType === 'customer'
                          ? `Pelanggan · ${msg.senderNama}`
                          : msg.senderType === 'ai_bot'
                            ? `AI · ${msg.senderNama}`
                            : msg.senderNama}
                      </p>
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
          placeholder="Balas ke pelanggan…"
          maxLength={2000}
          className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          aria-label="Kirim balasan"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

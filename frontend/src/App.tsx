import { useState, useRef, useEffect } from "react";
import io from "socket.io-client";
import './App.css';

const socket = io();

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  status: string;
  bio: string;
}

interface Group {
  id: string;
  name: string;
  description: string;
  visibility: string;
  owner_id: string;
  message_count: number;
  current_member_count: number;
}

interface Message {
  id: string;
  group_id: string;
  sender_id: string;
  sender_username?: string;
  display_name?: string;
  message_type: string;
  content: string;
  created_at: Date | string;
  is_deleted: boolean;
  reply_to_id: string | null;
}

// ─── API Service ────────────────────────────────────────────────────────────

const API_BASE = "/api";

const api = {
  fetchJSON: (url: string, options: any = {}) =>
    fetch(url, options).then(async res => {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API Error ${res.status}: ${text.slice(0, 100)}`);
      }
      return res.json();
    }),

  login: (username: string, password?: string) =>
    api.fetchJSON(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }),

  register: (username: string, email: string, password?: string) =>
    api.fetchJSON(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    }),

  updateProfile: (userId: string, display_name: string, bio: string) =>
    api.fetchJSON(`${API_BASE}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, display_name, bio })
    }),

  getGroups: (userId: string) =>
    api.fetchJSON(`${API_BASE}/groups/${userId}`),

  getMessages: (groupId: string) =>
    api.fetchJSON(`${API_BASE}/messages/${groupId}`),

  sendMessage: (groupId: string, senderId: string, content: string, file?: File | null, messageType: string = 'text') => {
    const formData = new FormData();
    formData.append('group_id', groupId);
    formData.append('sender_id', senderId);
    if (content) formData.append('content', content);
    if (file) formData.append('file', file);
    formData.append('message_type', messageType);
    return api.fetchJSON(`${API_BASE}/messages`, {
      method: 'POST',
      body: formData
    });
  },

  seed: () => api.fetchJSON(`${API_BASE}/seed`, { method: 'POST' }),
  cleanup: () => api.fetchJSON(`${API_BASE}/cleanup`, { method: 'POST' })
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const avatarColor = (id: string) => {
  const palette = ["#C8A97E", "#8BA888", "#7E9CB5", "#B88FA0", "#A0916F", "#7EAAB5"];
  const i = id.charCodeAt(id.length - 1) % palette.length;
  return palette[i];
};

const initials = (name: string = "?") => name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

const formatTime = (dateInput: Date | string) => {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return "ahora";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("es", { day: "2-digit", month: "short" });
};

const Avatar = ({ name, id, size = 36 }: { name?: string; id: string; size?: number }) => {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: avatarColor(id),
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 700, color: "#1A1710",
      flexShrink: 0, fontFamily: "'DM Sans', sans-serif",
      letterSpacing: "-0.5px"
    }}>
      {initials(name)}
    </div>
  );
};

// ─── Component ───────────────────────────────────────────────────────────────

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [fileValue, setFileValue] = useState<File | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showProfileConfig, setShowProfileConfig] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // GIF state
  const [showGifModal, setShowGifModal] = useState(false);
  const [gifQuery, setGifQuery] = useState("");
  const [gifs, setGifs] = useState<any[]>([]);

  const [isRegistering, setIsRegistering] = useState(false);
  const [loginValue, setLoginValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [loading, setLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) {
        // Optionally auto-open sidebar on desktop if it was collapsed
        // (but maybe user wants it collapsed, so we don't force it)
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Reset and seed DB on first load (one-time for cleanup)
  useEffect(() => {
    api.cleanup().then(() => api.seed()).catch(console.error);
  }, []);

  // Fetch groups when logged in
  useEffect(() => {
    if (currentUser) {
      api.getGroups(currentUser.id).then(data => {
        setGroups(data);
        if (data.length > 0 && !activeGroup) {
          setActiveGroup(data[0].id);
        }
      });
    }
  }, [currentUser]);

  // Fetch GIFs
  useEffect(() => {
    if (showGifModal) {
      const url = gifQuery ? `/api/gifs/search?q=${gifQuery}` : `/api/gifs/trending`;
      api.fetchJSON(url).then(data => {
        if (data.data) setGifs(data.data);
      }).catch(console.error);
    }
  }, [showGifModal, gifQuery]);

  // Fetch messages when active group changes
  useEffect(() => {
    if (activeGroup) {
      api.getMessages(activeGroup).then(setMessages);
      socket.emit("join_group", activeGroup);
    }
  }, [activeGroup]);

  useEffect(() => {
    socket.on("new_message", (msg) => {
      setMessages(prev => {
        if (!prev.find(m => m.id === msg.id)) {
          return [...prev, msg];
        }
        return prev;
      });
    });
    return () => {
      socket.off("new_message");
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginValue.trim() || !passwordValue.trim()) return;
    setLoading(true);
    try {
      if (isRegistering) {
        if (!emailValue.trim()) return;
        const user = await api.register(loginValue.trim(), emailValue.trim(), passwordValue.trim());
        setCurrentUser(user);
      } else {
        const user = await api.login(loginValue.trim(), passwordValue.trim());
        setCurrentUser(user);
      }
    } catch (err) {
      alert("Credenciales incorrectas o error en el sistema.");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (customContent?: string, type: string = 'text') => {
    const trimmed = customContent !== undefined ? customContent : inputValue.trim();
    if ((!trimmed && !fileValue) || !activeGroup || !currentUser) return;

    setInputValue("");
    setFileValue(null);
    setReplyTo(null);
    setShowGifModal(false);

    try {
      await api.sendMessage(activeGroup, currentUser.id, trimmed, fileValue, type);
    } catch (err) {
      console.error(err);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (!currentUser) {
    return (
    <div className="er-root flex items-center justify-center bg-[#0F0E0B] h-screen">
      <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&display=swap');
          .login-card {
            background: #1A1812;
            border: 1px solid rgba(200,169,126,0.15);
            padding: 40px;
            border-radius: 24px;
            width: 90%;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            margin: 20px;
          }
          @media (max-width: 480px) {
            .login-card { padding: 30px 20px; }
            .login-title { font-size: 28px; }
          }
          .login-title { font-family: 'DM Serif Display', serif; font-size: 32px; color: #C8A97E; margin-bottom: 8px; }
          .login-subtitle { font-family: 'DM Sans', sans-serif; color: rgba(232,224,208,0.5); font-size: 14px; margin-bottom: 32px; }
          .login-input {
            width: 100%;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(200,169,126,0.2);
            border-radius: 12px;
            padding: 14px 16px;
            color: #E8E0D0;
            font-family: 'DM Sans', sans-serif;
            font-size: 16px;
            margin-bottom: 20px;
            outline: none;
            transition: border-color 0.2s;
          }
          .login-input:focus { border-color: #C8A97E; }
          .login-button {
            width: 100%;
            background: #C8A97E;
            color: #0F0E0B;
            border: none;
            padding: 14px;
            border-radius: 12px;
            font-weight: 700;
            font-size: 16px;
            cursor: pointer;
            transition: transform 0.1s, opacity 0.2s;
          }
          .login-button:hover { opacity: 0.9; transform: translateY(-1px); }
          .login-button:active { transform: translateY(0); }
          .login-button:disabled { opacity: 0.5; cursor: default; }
        `}</style>
      <div className="login-card">
        <div className="login-title">El Refugio</div>
        <div className="login-subtitle">
          {isRegistering ? "Crea una cuenta para interactuar" : "Entra con tus credenciales seguras"}
        </div>
        <form onSubmit={handleLogin}>
          <input
            className="login-input"
            type="text"
            placeholder="Nombre de usuario..."
            value={loginValue}
            onChange={e => setLoginValue(e.target.value)}
            autoFocus
            required
          />
          {isRegistering && (
            <input
              className="login-input"
              type="email"
              placeholder="Correo electrónico..."
              value={emailValue}
              onChange={e => setEmailValue(e.target.value)}
              required
            />
          )}
          <input
            className="login-input"
            type="password"
            placeholder="Contraseña segura..."
            value={passwordValue}
            onChange={e => setPasswordValue(e.target.value)}
            required
          />
          <button className="login-button" type="submit" disabled={loading}>
            {loading ? (isRegistering ? "Registrando..." : "Entrando...") : (isRegistering ? "Registrarme" : "Entrar al Refugio")}
          </button>
          <div
            style={{ marginTop: 15, fontSize: 13, color: '#C8A97E', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setIsRegistering(!isRegistering)}
          >
            {isRegistering ? "¿Ya tienes cuenta? Ingresa aquí" : "¿No tienes cuenta? Regístrate aquí"}
          </div>
        </form>
        <div className="mt-8 text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
          PostgreSQL · E2E Encrypted · v2.0
        </div>
      </div>
    </div>
  );
  }

  const activeGroupData = groups.find(g => g.id === activeGroup);

  return (
    <>
    <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=DM+Serif+Display:ital@0;1&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; width: 100%; margin: 0; padding: 0; background: #0F0E0B; }
        .er-root { font-family: 'DM Sans', sans-serif; background: #0F0E0B; color: #E8E0D0; height: 100vh; width: 100%; display: flex; overflow: hidden; position: relative; }
        .er-root::before { content: ''; position: fixed; inset: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E"); pointer-events: none; z-index: 0; }
        .er-sidebar { 
          width: 280px; 
          min-width: 280px; 
          background: #0A0908; 
          border-right: 1px solid rgba(200,169,126,0.12); 
          display: flex; 
          flex-direction: column; 
          z-index: 50; 
          transition: transform 0.3s cubic-bezier(0.4,0,0.2,1); 
          overflow: hidden;
        }
        .er-sidebar.collapsed { 
          transform: translateX(-100%); 
        }
        @media (min-width: 769px) {
          .er-sidebar.collapsed {
            width: 0;
            min-width: 0;
          }
        }
        .er-sidebar-header { padding: 24px 20px 16px; border-bottom: 1px solid rgba(200,169,126,0.08); }
        .er-brand { font-family: 'DM Serif Display', serif; font-size: 22px; color: #C8A97E; letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px; white-space: nowrap; }
        .er-brand span { font-style: italic; color: #8BA888; font-size: 14px; }
        .er-user-pill { margin-top: 12px; display: flex; align-items: center; gap: 10px; background: rgba(200,169,126,0.06); border-radius: 10px; padding: 8px 10px; cursor: pointer; }
        .er-user-pill-info { flex: 1; min-width: 0; }
        .er-user-pill-name { font-size: 13px; font-weight: 600; color: #E8E0D0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .er-user-pill-role { font-size: 11px; color: #C8A97E; text-transform: uppercase; letter-spacing: 0.8px; }
        .er-online-dot { width: 7px; height: 7px; border-radius: 50%; background: #8BA888; box-shadow: 0 0 6px #8BA888; }
        .er-sections-label { padding: 16px 20px 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(200,169,126,0.4); }
        .er-group-item { margin: 2px 8px; padding: 10px 12px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 10px; transition: background 0.15s; position: relative; }
        .er-group-item:hover { background: rgba(200,169,126,0.07); }
        .er-group-item.active { background: rgba(200,169,126,0.13); }
        .er-group-item.active::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 3px; border-radius: 0 3px 3px 0; background: #C8A97E; }
        .er-group-icon { width: 36px; height: 36px; border-radius: 10px; background: rgba(200,169,126,0.1); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
        .er-group-info { flex: 1; min-width: 0; }
        .er-group-name { font-size: 13px; font-weight: 500; color: #E8E0D0; }
        .er-group-preview { font-size: 11px; color: rgba(232,224,208,0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .er-group-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .er-group-time { font-size: 10px; color: rgba(200,169,126,0.4); }
        .er-badge { background: #C8A97E; color: #0F0E0B; border-radius: 10px; font-size: 10px; font-weight: 700; padding: 1px 6px; min-width: 18px; text-align: center; }
        .er-sidebar-footer { margin-top: auto; padding: 12px 8px; border-top: 1px solid rgba(200,169,126,0.08); }
        .er-icon-btn { width: 36px; height: 36px; border-radius: 8px; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: rgba(232,224,208,0.4); font-size: 16px; transition: background 0.15s, color 0.15s; }
        .er-icon-btn:hover { background: rgba(200,169,126,0.1); color: #C8A97E; }
        .er-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; z-index: 1; min-width: 0; }
        .er-topbar { padding: 0 24px; height: 64px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(200,169,126,0.1); background: rgba(15,14,11,0.8); backdrop-filter: blur(12px); position: sticky; top: 0; z-index: 5; }
        @media (max-width: 600px) { .er-topbar { padding: 0 12px; } .er-topbar-desc { display: none; } .er-encrypt-badge { display: none !important; } }
        .er-topbar-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .er-topbar-title { font-family: 'DM Serif Display', serif; font-size: 18px; color: #E8E0D0; letter-spacing: -0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .er-topbar-desc { font-size: 12px; color: rgba(232,224,208,0.35); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .er-topbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .er-encrypt-badge { display: flex; align-items: center; gap: 5px; background: rgba(139,168,136,0.12); border: 1px solid rgba(139,168,136,0.2); border-radius: 20px; padding: 4px 10px; font-size: 11px; color: #8BA888; font-weight: 500; }
        .er-messages { flex: 1; overflow-y: auto; padding: 20px 0; scroll-behavior: smooth; }
        .er-messages::-webkit-scrollbar { width: 4px; }
        .er-messages::-webkit-scrollbar-track { background: transparent; }
        .er-messages::-webkit-scrollbar-thumb { background: rgba(200,169,126,0.2); border-radius: 2px; }
        .er-date-divider { display: flex; align-items: center; gap: 12px; padding: 12px 24px; margin: 8px 0; }
        .er-date-divider::before, .er-date-divider::after { content: ''; flex: 1; height: 1px; background: rgba(200,169,126,0.1); }
        .er-date-divider span { font-size: 11px; color: rgba(200,169,126,0.35); font-weight: 500; white-space: nowrap; }
        .er-msg-row { padding: 4px 24px; display: flex; align-items: flex-start; gap: 10px; transition: background 0.1s; position: relative; }
        @media (max-width: 600px) { .er-msg-row { padding: 4px 12px; } }
        .er-msg-row:hover { background: rgba(200,169,126,0.03); }
        .er-msg-row.own { flex-direction: row-reverse; }
        .er-msg-avatar { margin-top: 2px; flex-shrink: 0; }
        .er-msg-body { max-width: 68%; display: flex; flex-direction: column; }
        @media (max-width: 768px) { .er-msg-body { max-width: 85%; } }
        .er-msg-row.own .er-msg-body { align-items: flex-end; }
        .er-msg-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
        .er-msg-row.own .er-msg-header { flex-direction: row-reverse; }
        .er-msg-author { font-size: 12px; font-weight: 600; color: #C8A97E; }
        .er-msg-time { font-size: 11px; color: rgba(232,224,208,0.25); }
        .er-reply-preview { background: rgba(200,169,126,0.07); border-left: 2px solid #C8A97E; border-radius: 0 6px 6px 0; padding: 4px 10px; margin-bottom: 4px; font-size: 11px; color: rgba(232,224,208,0.5); }
        .er-bubble {
          background: #1E1C16;
          border: 1px solid rgba(200,169,126,0.2);
          border-radius: 16px 16px 16px 4px;
          padding: 12px 16px;
          min-height: 40px;
          font-size: 14px; line-height: 1.55;
          color: #FFFFFF !important;
          word-break: break-word;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        @media (max-width: 480px) { .er-bubble { font-size: 13px; padding: 10px 14px; } }
        .er-msg-row.own .er-bubble {
          background: #C8A97E;
          color: #0F0E0B !important;
          border-color: transparent;
          border-radius: 16px 16px 4px 16px;
        }
        .er-msg-actions { position: absolute; top: 4px; right: 24px; display: none; background: #1A1812; border: 1px solid rgba(200,169,126,0.15); border-radius: 8px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 5; }
        .er-msg-row:hover .er-msg-actions { display: flex; }
        .er-msg-row.own .er-msg-actions { right: auto; left: 24px; }
        .er-action-btn { padding: 6px 10px; background: transparent; border: none; cursor: pointer; color: rgba(232,224,208,0.5); font-size: 13px; transition: background 0.1s, color 0.1s; display: flex; align-items: center; gap: 4px; }
        .er-action-btn:hover { background: rgba(200,169,126,0.1); color: #C8A97E; }
        .er-reply-bar { margin: 0 16px 8px; background: rgba(200,169,126,0.07); border: 1px solid rgba(200,169,126,0.15); border-radius: 10px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; font-size: 12px; color: rgba(232,224,208,0.6); }
        .er-reply-bar-label { color: #C8A97E; font-weight: 600; }
        .er-reply-bar-text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .er-input-area { padding: 12px 16px 16px; border-top: 1px solid rgba(200,169,126,0.08); background: rgba(15,14,11,0.9); }
        @media (max-width: 600px) { .er-input-area { padding: 10px 12px 14px; } }
        .er-input-wrap { display: flex; align-items: flex-end; gap: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(200,169,126,0.14); border-radius: 14px; padding: 8px 8px 8px 16px; transition: border-color 0.2s; }
        .er-input-wrap:focus-within { border-color: rgba(200,169,126,0.35); }
        .er-textarea { flex: 1; background: transparent; border: none; outline: none; color: #E8E0D0; font-family: 'DM Sans', sans-serif; font-size: 14px; line-height: 1.5; resize: none; max-height: 120px; min-height: 22px; }
        .er-textarea::placeholder { color: rgba(232,224,208,0.2); }
        .er-send-btn { width: 36px; height: 36px; border-radius: 10px; background: #C8A97E; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, transform 0.1s; color: #0F0E0B; }
        .er-send-btn:hover { background: #D4B98C; transform: scale(1.05); }
        .er-send-btn:disabled { background: rgba(200,169,126,0.2); cursor: default; transform: none; }
        .er-members-panel { 
          width: 220px; 
          min-width: 220px; 
          background: #0A0908; 
          border-left: 1px solid rgba(200,169,126,0.1); 
          display: flex; 
          flex-direction: column; 
          z-index: 50; 
          transition: transform 0.3s cubic-bezier(0.4,0,0.2,1); 
          overflow: hidden; 
        }
        .er-members-panel.hidden { 
          transform: translateX(100%); 
        }
        @media (min-width: 769px) {
          .er-members-panel.hidden {
            width: 0;
            min-width: 0;
          }
        }
        .er-members-header { padding: 20px 16px 12px; border-bottom: 1px solid rgba(200,169,126,0.08); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; color: rgba(200,169,126,0.45); }
        .er-member-item { padding: 8px 14px; display: flex; align-items: center; gap: 10px; cursor: default; border-radius: 8px; margin: 2px 6px; transition: background 0.1s; }
        .er-member-item:hover { background: rgba(200,169,126,0.06); }
        .er-member-name { font-size: 13px; font-weight: 500; color: #E8E0D0; }
        .er-member-role { font-size: 10px; color: rgba(200,169,126,0.4); }
        .er-online-indicator { width: 8px; height: 8px; border-radius: 50%; background: #8BA888; flex-shrink: 0; box-shadow: 0 0 5px rgba(139,168,136,0.6); }
        .er-members-list { overflow-y: auto; flex: 1; padding: 8px 0; }
        .er-members-list::-webkit-scrollbar { display: none; }
        .er-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; opacity: 0.25; }
        .er-empty-icon { font-size: 40px; }
        .er-empty-text { font-family: 'DM Serif Display', serif; font-size: 16px; color: #C8A97E; }
        .er-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 25; pointer-events: auto; }
        @media (max-width: 768px) {
          .er-sidebar { position: fixed; top: 0; bottom: 0; left: 0; }
          .er-members-panel { position: fixed; top: 0; bottom: 0; right: 0; }
        }
        @media (max-width: 480px) {
          .er-sidebar { width: 100%; max-width: 280px; }
          .er-members-panel { width: 100%; max-width: 240px; }
        }
      `}</style>

    <div className="er-root relative overflow-hidden">
      {/* Backdrop for mobile */}
      {((sidebarOpen || showMembers || showProfileConfig || showGifModal) && isMobile) && (
        <div className="er-backdrop" onClick={() => { setSidebarOpen(false); setShowMembers(false); setShowProfileConfig(false); setShowGifModal(false); }} />
      )}

      {/* ── Sidebar ───────────────────────────────────────── */}
      <aside className={`er-sidebar${sidebarOpen ? "" : " collapsed"}`}>
        <div className="er-sidebar-header">
          <div className="er-brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8BA888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 22c0 0-8-4-8-10a8 8 0 0 1 16 0c0 6-8 10-8 10z" /><path d="M12 12v10" /></svg> El Refugio <span>v2.0</span>
          </div>
          <div className="er-user-pill" onClick={() => setShowProfileConfig(true)}>
            <Avatar id={currentUser.id} name={currentUser.display_name} size={30} />
            <div className="er-user-pill-info">
              <div className="er-user-pill-name">{currentUser.display_name}</div>
              <div className="er-user-pill-role">{currentUser.role === "admin" ? "◆ Admin" : "Mi perfil"}</div>
            </div>
            <div className="er-online-dot" />
          </div>
        </div>

        <div className="er-sections-label">Canales — {groups.length}</div>

        <div className="flex-1 overflow-y-auto">
          {groups.map(g => {
            const u = 0; // Simplified
            const icons: Record<string, string> = { General: "#", 'Diseño & UX': "✦", Infraestructura: "⬡", Producto: "▦" };
            return (
              <div
                key={g.id}
                className={`er-group-item${activeGroup === g.id ? " active" : ""}`}
                onClick={() => {
                  setActiveGroup(g.id);
                  setReplyTo(null);
                  if (isMobile) setSidebarOpen(false);
                }}
              >
                <div className="er-group-icon">{icons[g.name] || "#"}</div>
                <div className="er-group-info">
                  <div className="er-group-name">{g.name}</div>
                  <div className="er-group-preview">{g.description}</div>
                </div>
                <div className="er-group-meta">
                  {u > 0 && <div className="er-badge">{u}</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="er-sidebar-footer">
          <div style={{ display: "flex", gap: 4 }}>
            <button className="er-icon-btn" title="Nuevo grupo">＋</button>
            <button className="er-icon-btn" title="Cerrar Sesión" onClick={() => setCurrentUser(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────── */}
      <main className="er-main">
        <div className="er-topbar">
          <div className="er-topbar-left">
            <button className="er-icon-btn" onClick={() => { setSidebarOpen(p => !p); setShowMembers(false); }} title="Menú">☰</button>
            <div className="min-width-0">
              <div className="er-topbar-title">{activeGroupData?.name || "Cargando..."}</div>
              <div className="er-topbar-desc">{activeGroupData?.description}</div>
            </div>
          </div>
          <div className="er-topbar-right">
            <div className="er-encrypt-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> E2E cifrado
            </div>
            <button className="er-icon-btn" onClick={() => { setShowMembers(p => !p); setSidebarOpen(false); }} title="Miembros">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </button>
          </div>
        </div>

        <div className="er-messages">
          <div className="er-date-divider"><span>Hoy</span></div>
          {messages.length === 0 && (
            <div className="er-empty">
              <div className="er-empty-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C8A97E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </div>
              <div className="er-empty-text">Empieza la conversación</div>
            </div>
          )}
          {messages.map((msg, idx) => {
            const isOwn = msg.sender_id === currentUser.id;
            const prevMsg = messages[idx - 1];
            const showHeader = !prevMsg || prevMsg.sender_id !== msg.sender_id;
            const replyMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;

            return (
              <div key={msg.id} className={`er-msg-row${isOwn ? " own" : ""}`} style={{ marginTop: showHeader ? 12 : 0 }}>
                {showHeader && !isOwn && (
                  <div className="er-msg-avatar">
                    <Avatar id={msg.sender_id} name={msg.display_name || msg.sender_username} size={32} />
                  </div>
                )}
                {!showHeader && !isOwn && <div style={{ width: 32, flexShrink: 0 }} />}
                <div className="er-msg-body">
                  {showHeader && (
                    <div className="er-msg-header">
                      <span className="er-msg-author">{isOwn ? "Tú" : (msg.display_name || msg.sender_username)}</span>
                      <span className="er-msg-time">{formatTime(msg.created_at)}</span>
                    </div>
                  )}
                  {replyMsg && (
                    <div className="er-reply-preview">
                      <span className="er-reply-bar-label">{replyMsg.display_name || replyMsg.sender_username}: </span>
                      {replyMsg.content.slice(0, 60)}...
                    </div>
                  )}
                  {msg.message_type === 'file' ? (
                    <div className="er-bubble" style={{ display: 'flex', flexDirection: 'column' }}>
                      <a href={`/uploads/${msg.content}`} target="_blank" style={{ color: '#8BA888', textDecoration: 'underline' }}>
                        📎 {msg.content.substring(msg.content.indexOf('-') + 1) || 'Descargar archivo'}
                      </a>
                    </div>
                  ) : (msg.message_type === 'image' && msg.content.includes('giphy.com')) ? (
                    <div className="er-bubble" style={{ padding: 0, overflow: 'hidden', background: 'transparent', border: 'none', boxShadow: 'none' }}>
                      <img src={msg.content} alt="GIF" style={{ maxWidth: 240, borderRadius: 12, display: 'block' }} />
                    </div>
                  ) : (
                    <div className="er-bubble">{msg.content}</div>
                  )}
                </div>
                <div className="er-msg-actions">
                  <button className="er-action-btn" onClick={() => setReplyTo(msg)} title="Responder">↩ Responder</button>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {replyTo && (
          <div className="er-reply-bar">
            <span>↩</span>
            <div className="er-reply-bar-text">
              <span className="er-reply-bar-label">{replyTo.display_name || replyTo.sender_username}: </span>
              {replyTo.content.slice(0, 80)}
            </div>
            <button className="er-icon-btn" style={{ width: 24, height: 24, fontSize: 12 }} onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}

        <div className="er-input-area">
          <div className="er-input-wrap">
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={e => setFileValue(e.target.files ? e.target.files[0] : null)}
            />
            <button
              className="er-icon-btn"
              style={{ width: 36, height: 36, color: fileValue ? '#8BA888' : '' }}
              onClick={() => fileInputRef.current?.click()}
              title="Adjuntar Archivo"
            >
              📎
            </button>
            <button
              className="er-icon-btn font-bold"
              style={{ width: 36, height: 36, color: showGifModal ? '#8BA888' : '' }}
              onClick={() => setShowGifModal(!showGifModal)}
              title="Enviar GIF"
            >
              GIF
            </button>
            <textarea
              ref={inputRef}
              className="er-textarea"
              rows={1}
              placeholder={fileValue ? `Archivo adjunto: ${fileValue.name}` : `Mensaje en #${activeGroupData?.name || ""}...`}
              value={fileValue ? '' : inputValue}
              disabled={!!fileValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKey}
              onInput={(e: any) => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            <button className="er-send-btn" onClick={() => sendMessage()} disabled={!inputValue.trim() && !fileValue}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </main>

      {/* ── GIF Modal (global overlay) ─────────────────────── */}
      {showGifModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: '0 0 80px 0',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowGifModal(false); }}
        >
          <div style={{
            background: '#1A1812',
            border: '1px solid rgba(200,169,126,0.25)',
            borderRadius: 20,
            width: '100%',
            maxWidth: 560,
            margin: '0 16px',
            boxShadow: '0 -10px 60px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '70vh',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px 12px',
              borderBottom: '1px solid rgba(200,169,126,0.1)',
            }}>
              <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: '#C8A97E' }}>
                GIFs
              </span>
              <button
                onClick={() => setShowGifModal(false)}
                style={{
                  width: 28, height: 28, borderRadius: 8, border: 'none',
                  background: 'rgba(200,169,126,0.1)', color: '#C8A97E',
                  cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>

            {/* Search */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(200,169,126,0.2)',
                borderRadius: 12, padding: '10px 14px',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(200,169,126,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  autoFocus
                  type="text"
                  placeholder="Buscar GIFs en Giphy..."
                  value={gifQuery}
                  onChange={e => setGifQuery(e.target.value)}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: '#E8E0D0', fontFamily: "'DM Sans', sans-serif", fontSize: 14,
                  }}
                />
                {gifQuery && (
                  <button onClick={() => setGifQuery('')} style={{ background: 'none', border: 'none', color: 'rgba(200,169,126,0.5)', cursor: 'pointer', fontSize: 12 }}>✕</button>
                )}
              </div>
            </div>

            {/* Label */}
            <div style={{ padding: '0 16px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.2px', color: 'rgba(200,169,126,0.4)' }}>
              {gifQuery ? `Resultados para "${gifQuery}"` : 'Tendencias'}
            </div>

            {/* Grid */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '0 16px 16px',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gridAutoRows: '120px',
              gap: 8,
            }}>
              {gifs.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'rgba(232,224,208,0.25)', fontSize: 13 }}>
                  Cargando GIFs...
                </div>
              )}
              {gifs.map((g: any) => (
                <div
                  key={g.id}
                  onClick={() => sendMessage(g.images.downsized.url, 'image')}
                  style={{
                    position: 'relative',
                    borderRadius: 10,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.05)',
                    transition: 'transform 0.15s, opacity 0.15s',
                    border: '1px solid rgba(200,169,126,0.08)',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.04)'; (e.currentTarget as HTMLDivElement).style.opacity = '0.85'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                >
                  <img
                    src={g.images.fixed_height_small.url}
                    alt={g.title || 'gif'}
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      objectFit: 'cover', display: 'block',
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Giphy branding */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid rgba(200,169,126,0.08)',
              fontSize: 10, color: 'rgba(200,169,126,0.3)', textAlign: 'center', letterSpacing: '1px', textTransform: 'uppercase',
            }}>
              Powered by Giphy
            </div>
          </div>
        </div>
      )}


      <aside className={`er-members-panel${showMembers ? "" : " hidden"}`}>
        <div className="er-members-header">Miembros</div>
        <div className="er-members-list">
          <div className="er-member-item">
            <Avatar id={currentUser.id} name={currentUser.display_name} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="er-member-name">{currentUser.display_name}</div>
              <div className="er-member-role">Miembro</div>
            </div>
            <div className="er-online-indicator" />
          </div>
        </div>
      </aside>

      {showProfileConfig && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4" style={{ zIndex: 100 }}>
          <div className="bg-[#1A1812] border border-[#C8A97E]/30 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-serif text-[#C8A97E] mb-4">Personaliza tu Perfil</h3>
            <input
              className="w-full bg-white/5 border border-[#C8A97E]/20 text-[#E8E0D0] p-3 rounded-xl mb-4"
              placeholder="Tu Nombre a Mostrar"
              defaultValue={currentUser.display_name}
              id="profile-name"
            />
            <textarea
              className="w-full bg-white/5 border border-[#C8A97E]/20 text-[#E8E0D0] p-3 rounded-xl mb-4 h-24"
              placeholder="Una bio corta..."
              defaultValue={currentUser.bio}
              id="profile-bio"
            />
            <div className="flex gap-4 mt-2 justify-end">
              <button className="text-zinc-400 hover:text-white" onClick={() => setShowProfileConfig(false)}>Cerrar</button>
              <button className="bg-[#C8A97E] text-black px-4 py-2 rounded-xl font-bold hover:scale-105 transition"
                onClick={async () => {
                  const n = (document.getElementById('profile-name') as HTMLInputElement).value;
                  const b = (document.getElementById('profile-bio') as HTMLTextAreaElement).value;
                  const req = await api.updateProfile(currentUser.id, n, b);
                  setCurrentUser({ ...currentUser, display_name: req.display_name, bio: req.bio });
                  setShowProfileConfig(false);
                }}
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </>
  );
}

export default App;

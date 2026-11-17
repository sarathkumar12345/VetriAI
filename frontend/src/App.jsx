
import { useState, useEffect, useRef } from "react";
import "./App.css";

const STORAGE_KEY = "vetriai_chat_history";
const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function getChatDate(chat) {
  const timestamp = Number(chat.id);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp)
    : new Date();
}

function getDateGroup(chat) {
  const date = getChatDate(chat);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";

  const daysAgo = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()) -
      new Date(date.getFullYear(), date.getMonth(), date.getDate())) /
      86400000
  );

  if (daysAgo <= 7 && daysAgo >= 0) return "Previous 7 Days";
  if (daysAgo <= 30 && daysAgo >= 0) return "Previous 30 Days";
  return "Older";
}

function App() {
  const [conversations, setConversations] = useState(loadChats);
  const [activeChatId, setActiveChatId] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [searchText, setSearchText] = useState("");
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");

  const [activePage, setActivePage] = useState("chat");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  const controllerRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);
useEffect(() => {
  const loadDatabaseChats = async () => {
    try {
      const response = await fetch(`${API_URL}/chats`);

      if (!response.ok) {
        throw new Error("Failed to load chat history");
      }

      const chats = await response.json();

      const loadedChats = await Promise.all(
        chats.map(async (chat) => {
          const chatResponse = await fetch(
            `${API_URL}/chats/${chat.session_id}`
          );

          if (!chatResponse.ok) {
            return null;
          }

          const data = await chatResponse.json();

          return {
            id: chat.session_id,
            title: chat.title,
            pinned: false,
            messages: data.messages.map((msg) => ({
              role: msg.role,
              text: msg.content
            }))
          };
        })
      );

      const validChats = loadedChats.filter(Boolean);

      setConversations((previous) => {
        const databaseIds = new Set(
          validChats.map((chat) => chat.id)
        );

        return [
          ...validChats,
          ...previous.filter(
            (chat) => !databaseIds.has(chat.id)
          )
        ];
      });

    } catch (error) {
      console.error("Database chat history error:", error);
    }
  };

  loadDatabaseChats();
}, []);
  const activeChat = conversations.find(
    (chat) => chat.id === activeChatId
  );

  const messages = activeChat?.messages || [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filteredChats = conversations.filter((chat) =>
    chat.title.toLowerCase().includes(searchText.toLowerCase())
  );

  const groups = [
    "Today",
    "Yesterday",
    "Previous 7 Days",
    "Previous 30 Days",
    "Older",
  ];

 const newChat = () => {
  if (loading) return;

  setActiveChatId(null);
  setMessage("");
  setActivePage("chat");
  setEditingChatId(null);
  setEditingTitle("");

  setTimeout(() => inputRef.current?.focus(), 50);
};

  const openChat = (id) => {
    if (loading) return;
    setActiveChatId(id);
    setActivePage("chat");
    setMessage("");
  };

  const stopGeneration = () => {
    controllerRef.current?.abort();
  };

const renameChat = async (id, title) => {
  const newTitle = title.trim();

  if (!newTitle) return;

  try {
    const response = await fetch(
      `${API_URL}/chats/${id}/rename`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: newTitle
        })
      }
    );

    if (!response.ok) {
      throw new Error("Rename failed");
    }

    setConversations((previous) =>
      previous.map((chat) =>
        chat.id === id
          ? { ...chat, title: newTitle }
          : chat
      )
    );

    setEditingChatId(null);
    setEditingTitle("");

  } catch (error) {
    console.error("Rename error:", error);
    alert("Could not rename chat. Please try again.");
  }
};


  const togglePin = (id) => {
    setConversations((prev) =>
      prev.map((chat) =>
        chat.id === id ? { ...chat, pinned: !chat.pinned } : chat
      )
    );
  };

const deleteChat = async (id) => {
  if (loading) return;

  if (!window.confirm("Delete this conversation permanently?")) {
    return;
  }

  try {
    const response = await fetch(
      `${API_URL}/chats/${id}`,
      {
        method: "DELETE"
      }
    );

    if (!response.ok) {
      throw new Error("Delete failed");
    }

    setConversations((previous) =>
      previous.filter((chat) => chat.id !== id)
    );

    if (activeChatId === id) {
      setActiveChatId(null);
    }

    if (editingChatId === id) {
      setEditingChatId(null);
      setEditingTitle("");
    }

  } catch (error) {
    console.error("Delete error:", error);
    alert("Could not delete chat. Please try again.");
  }
};

  const sendMessage = async () => {
    if (!message.trim() || loading) return;

    const userMessage = message.trim();

    const conversationHistory = messages
      .filter((msg) => msg.text && msg.text.trim())
      .map((msg) => ({
        role: msg.role,
        content: msg.text,
      }))
      .slice(-8);

    const chatId = activeChatId || Date.now().toString();
    const controller = new AbortController();

    controllerRef.current = controller;

    setMessage("");
    setLoading(true);
    setActiveChatId(chatId);
    setActivePage("chat");

    setConversations((prev) => {
      const existing = prev.find((chat) => chat.id === chatId);

      if (existing) {
        return prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [
                  ...chat.messages,
                  { role: "user", text: userMessage },
                  { role: "assistant", text: "" },
                ],
              }
            : chat
        );
      }

      return [
        {
          id: chatId,
          title: userMessage.slice(0, 35),
          pinned: false,
          messages: [
            { role: "user", text: userMessage },
            { role: "assistant", text: "" },
          ],
        },
        ...prev,
      ];
    });

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: chatId,
  message: userMessage,
  model: "VetriAI_Custom_Arch",
  history: conversationHistory,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Streaming response is not supported.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        assistantText += decoder.decode(value, { stream: true });

        setConversations((prev) =>
          prev.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg, index) =>
                    index === chat.messages.length - 1
                      ? { ...msg, text: assistantText }
                      : msg
                  ),
                }
              : chat
          )
        );
      }

      assistantText += decoder.decode();

      setConversations((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: chat.messages.map((msg, index) =>
                  index === chat.messages.length - 1
                    ? { ...msg, text: assistantText }
                    : msg
                ),
              }
            : chat
        )
      );
    } catch (error) {
      if (error.name === "AbortError") {
        console.log("VetriAI generation stopped.");
      } else {
        console.error("VetriAI streaming error:", error);

        setConversations((prev) =>
          prev.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg, index) =>
                    index === chat.messages.length - 1
                      ? {
                          ...msg,
                          text:
                            msg.text ||
                            "Error: Could not connect to VetriAI backend.",
                        }
                      : msg
                  ),
                }
              : chat
          )
        );
      }
    } finally {
      controllerRef.current = null;
      setLoading(false);
    }
  };

  const suggestions = [
    {
      icon: "▧",
      title: "Create an image",
      description: "Explore creative image ideas and concepts.",
      prompt: "Help me develop a creative image concept.",
    },
    {
      icon: "⌘",
      title: "Code a Python script",
      description: "Build scripts, APIs and programming solutions.",
      prompt: "Help me write a Python script.",
    },
    {
      icon: "▥",
      title: "Analyze data",
      description: "Understand data, patterns and insights.",
      prompt: "Help me analyze a dataset.",
    },
    {
      icon: "✎",
      title: "Help me write",
      description: "Draft messages, documents and content.",
      prompt: "Help me write a professional document.",
    },
  ];

  return (
    <div className={`app ${darkMode ? "dark-theme" : "light-theme"} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>

      {/* LEFT SIDEBAR */}

      <aside className="sidebar">

        <div className="sidebar-top">
          <button className="new-chat-button" onClick={newChat}>
            <span>✎</span>
            <span>New chat</span>
            <kbd>Ctrl K</kbd>
          </button>

          <button
            className="sidebar-toggle"
            title="Collapse sidebar"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            ◫
          </button>
        </div>

        <button className="explore-button" onClick={() => setActivePage("explore")}>
          <span>◎</span>
          <span>Explore GPTs</span>
        </button>

        <div className="sidebar-search">
          <span>⌕</span>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search chats"
          />
        </div>

        <div className="history-list">
          {groups.map((group) => {
            const groupChats = filteredChats.filter(
              (chat) =>
                !chat.pinned && getDateGroup(chat) === group
            );

            if (groupChats.length === 0) return null;

            return (
              <div className="history-group" key={group}>
                <p className="history-heading">{group}</p>

                {groupChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={`history-row ${activeChatId === chat.id ? "active" : ""}`}
                  >
                    {editingChatId === chat.id ? (
                      <input
                        className="rename-input"
                        value={editingTitle}
                        autoFocus
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameChat(chat.id, editingTitle);
                          if (e.key === "Escape") setEditingChatId(null);
                        }}
                        onBlur={() => renameChat(chat.id, editingTitle)}
                      />
                    ) : (
                      <>
                        <button
                          className="history-item"
                          onClick={() => openChat(chat.id)}
                          title={chat.title}
                        >
                          {chat.title}
                        </button>

                        <div className="history-actions">
                          <button
                            title="Pin chat"
                            onClick={() => togglePin(chat.id)}
                          >
                            ◇
                          </button>
                          <button
                            title="Rename chat"
                            onClick={() => {
                              setEditingChatId(chat.id);
                              setEditingTitle(chat.title);
                            }}
                          >
                            ✎
                          </button>
                          <button
                            title="Delete chat"
                            onClick={() => deleteChat(chat.id)}
                          >
                            ×
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {filteredChats.length === 0 && (
            <p className="no-chats">No conversations yet</p>
          )}
        </div>

        <div className="profile">
          <div className="profile-avatar">VK</div>
          <div className="profile-details">
            <strong>VetriAI User</strong>
            <span>Local Workspace</span>
          </div>
          <button className="profile-menu">···</button>
        </div>
      </aside>

      {/* MAIN CONTENT */}

      <main className="main">

        <header className="topbar">
          <div className="model-selector">
            <button
              className="model-button"
              onClick={() => setShowModelMenu(!showModelMenu)}
            >
              <span className="model-icon">✦</span>
              <strong>VetriAI</strong>
              <span className="model-name">Custom Arch</span>
              <span>⌄</span>
            </button>

            {showModelMenu && (
              <div className="model-dropdown">
                <p>MODEL</p>
                <div className="model-current">
                  <span>✦</span>
                  <div>
                    <strong>VetriAI_Custom_Arch</strong>
                    <small>Local model · Active</small>
                  </div>
                  <span>✓</span>
                </div>
              </div>
            )}
          </div>

          <div className="topbar-right">
            <span className="local-status">
              <i></i> Local AI
            </span>
            <button
              className="topbar-icon"
              title="Settings"
              onClick={() => setActivePage("settings")}
            >
              ⚙
            </button>
          </div>
        </header>

        {/* CHAT PAGE */}

        {activePage === "chat" && (
          <>
            <section className="chat-area">

              {messages.length === 0 ? (
                <div className="welcome-screen">
                  <div className="welcome-icon">✦</div>

                  <h1>What can I help with?</h1>

                  <p>
                    Choose a prompt below or begin writing to start a conversation.
                  </p>

                  <div className="suggestion-grid">
                    {suggestions.map((item) => (
                      <button
                        className="suggestion-card"
                        key={item.title}
                        onClick={() => {
                          setMessage(item.prompt);
                          inputRef.current?.focus();
                        }}
                      >
                        <span className="suggestion-icon">{item.icon}</span>
                        <span className="suggestion-content">
                          <strong>{item.title}</strong>
                          <small>{item.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="quick-actions">
                    <button onClick={() => setMessage("Let's brainstorm some ideas.")}>
                      ◈ Brainstorm ideas
                    </button>
                    <button onClick={() => setMessage("Help me plan a project.")}>
                      ◉ Plan a project
                    </button>
                    <button onClick={() => setMessage("Summarize this text: ")}>
                      ▤ Summarize text
                    </button>
                    <button onClick={() => setActivePage("tools")}>
                      ··· More
                    </button>
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {messages.map((msg, index) => (
                    <div
                      className={`message-row ${msg.role}`}
                      key={`${activeChatId}-${index}`}
                    >
                      {msg.role === "assistant" && (
                        <div className="assistant-avatar">✦</div>
                      )}

                      <div className="message-content">
                        {msg.role === "assistant" && (
                          <div className="message-author">VetriAI</div>
                        )}

                        <div className="message-text">
                          {msg.text}
                          {loading &&
                            msg.role === "assistant" &&
                            index === messages.length - 1 &&
                            !msg.text && (
                              <span className="stream-cursor">▍</span>
                            )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </section>

            
<div className="composer-area">
  {loading && (
    <div className="stream-status">
      <i></i> VetriAI is generating...
    </div>
  )}

  <div className="composer">
    <textarea
      ref={inputRef}
      value={message}
      onChange={(e) => setMessage(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      }}
      placeholder="Message VetriAI..."
      rows={2}
      disabled={loading}
    />

    <div className="composer-footer">
      <div className="composer-left">
        <button
          type="button"
          title="Attach"
          onClick={() => document.getElementById("vetriai-file").click()}
        >
          +
        </button>

        <button
          type="button"
          onClick={() => setActivePage("tools")}
        >
          ◉ Search
        </button>

        <button
          type="button"
          onClick={() => setActivePage("settings")}
        >
          ◈ Reason
        </button>

        <input
          id="vetriai-file"
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setMessage((prev) =>
                `${prev}${prev ? "\n" : ""}[Attached: ${file.name}]`
              );
            }
            e.target.value = "";
          }}
        />
      </div>

      <div className="composer-right">
        {loading ? (
          <button
            className="send-button stop-button"
            onClick={stopGeneration}
            title="Stop"
          >
            ■
          </button>
        ) : message.trim() ? (
          <button
            className="send-button"
            onClick={sendMessage}
            title="Send"
          >
            ↑
          </button>
        ) : (
          <button
            className="microphone-button"
            type="button"
            title="Voice input (not connected yet)"
            disabled
          >
            <svg
  width="20"
  height="20"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="1.8"
  strokeLinecap="round"
  strokeLinejoin="round"
>
  <rect x="9" y="2" width="6" height="13" rx="3" />
  <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
  <path d="M12 19v3M8 22h8" />
</svg>
          </button>
        )}
      </div>
    </div>
  </div>

  <p className="disclaimer">
    VetriAI can make mistakes. Check important information.
  </p>
</div>

          </>
        )}

        {/* EXPLORE PAGE */}

        {activePage === "explore" && (
          <section className="workspace-page">
            <h1>Explore VetriAI</h1>
            <p>Discover tools and capabilities in your local AI workspace.</p>

            <div className="explore-grid">
              {suggestions.map((item) => (
                <button
                  className="suggestion-card"
                  key={item.title}
                  onClick={() => {
                    setActivePage("chat");
                    setMessage(item.prompt);
                  }}
                >
                  <span className="suggestion-icon">{item.icon}</span>
                  <span className="suggestion-content">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* TOOLS PAGE */}

        {activePage === "tools" && (
          <section className="workspace-page">
            <h1>VetriAI Tools</h1>
            <p>Choose a workspace tool.</p>

            <div className="explore-grid">
              {[
                ["HTML Converter", "Convert HTML into Markdown or text."],
                ["AI Writer", "Create and improve written content."],
                ["Code Assistant", "Explore and understand code."],
                ["Text Analyzer", "Analyze and summarize text."],
              ].map(([name, description]) => (
                <button
                  className="suggestion-card"
                  key={name}
                  onClick={() => {
                    setActivePage("chat");
                    setMessage(`Help me with ${name}.`);
                  }}
                >
                  <span className="suggestion-icon">✦</span>
                  <span className="suggestion-content">
                    <strong>{name}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* SETTINGS PAGE */}

        {activePage === "settings" && (
          <section className="workspace-page">
            <h1>Settings</h1>
            <p>Customize your VetriAI workspace.</p>

            <div className="settings-card">
              <div className="settings-row">
                <div>
                  <strong>Appearance</strong>
                  <small>Change your workspace theme.</small>
                </div>
                <button
                  className="setting-button"
                  onClick={() => setDarkMode(!darkMode)}
                >
                  {darkMode ? "Dark" : "Light"}
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Active Model</strong>
                  <small>Current language model.</small>
                </div>
                <span>VetriAI_Custom_Arch</span>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Backend</strong>
                  <small>Local FastAPI connection.</small>
                </div>
                <span>{API_URL.replace(/^https?:\/\//, "")}</span>
              </div>

              <div className="settings-row">
                <div>
                  <strong>Conversation History</strong>
                  <small>Saved in your browser.</small>
                </div>
                <span>Enabled</span>
              </div>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}

export default App;

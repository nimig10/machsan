import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getAvailable, formatLocalDateInput } from '../utils.js';

const fetchWithRetry = async (url, options, maxRetries = 5) => {
  const delays = [2000, 5000, 10000, 20000, 32000];
  for (let i = 0; i < maxRetries; i += 1) {
    const response = await fetch(url, options);
    if (response.status === 429) {
      const delay = delays[i] ?? delays[delays.length - 1];
      console.warn(`AI chat rate limit hit. Retrying in ${delay / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    return response;
  }
  return fetch(url, options);
};

export default function AIChatBot({ equipment = [], reservations = [], policies = {}, settings = {} }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'היי! אני העוזר החכם של המחסן. תאר לי מה אתה הולך לצלם/להקליט ואעזור לך להרכיב ערכה, או שאל אותי על נהלי המחסן.' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const maxRequests = parseInt(settings?.aiMaxRequests) || 5;
  const todayKey = `ai_requests_${new Date().toISOString().split('T')[0]}`;

  const getRequestsCount = () => parseInt(localStorage.getItem(todayKey)) || 0;
  const incrementRequestsCount = () => localStorage.setItem(todayKey, getRequestsCount() + 1);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.REACT_APP_GEMINI_API_KEY || "";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    const currentRequests = getRequestsCount();
    if (currentRequests >= maxRequests) {
      setMessages(prev => [...prev,
        { role: 'user', content: inputValue },
        { role: 'assistant', content: `מצטער, הגעת למכסת הבקשות היומית המותרת (${maxRequests}). אנא נסה שוב מחר או פנה לצוות המחסן.` }
      ]);
      setInputValue('');
      return;
    }

    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInputValue('');
    setIsTyping(true);

    try {
      if (!apiKey) {
        throw new Error('חסר מפתח Gemini במשתני הסביבה.');
      }

      const now = new Date();
      const oneMinuteLater = new Date(now.getTime() + 60000);
      const currentDate = formatLocalDateInput(now);
      const currentEndDate = formatLocalDateInput(oneMinuteLater);
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const currentEndTime = `${String(oneMinuteLater.getHours()).padStart(2, '0')}:${String(oneMinuteLater.getMinutes()).padStart(2, '0')}`;

      const compactEquipment = equipment
        .map((equipmentItem) => ({
          name: equipmentItem.name,
          category: equipmentItem.category,
          available: getAvailable(
            equipmentItem.id,
            currentDate,
            currentEndDate,
            reservations,
            equipment,
            null,
            currentTime,
            currentEndTime
          ),
          description: equipmentItem.description || "",
          technicalDetails: equipmentItem.technical_details || "",
        }))
        .filter((equipmentItem) => equipmentItem.name);

      const systemPrompt = `אתה עוזר וירטואלי של מחסן השאלת ציוד אקדמי. עליך לענות אך ורק בעברית, בצורה תמציתית, מקצועית ואדיבה.
יש לך 3 תפקידים:
1. בונה ערכות: אם סטודנט מתאר הפקה, המלץ לו על ציוד רלוונטי *אך ורק* מתוך רשימת הציוד הזמין (avail > 0).
2. מציע חלופות: אם סטודנט מבקש משהו שאינו במלאי, הצע לו חלופה הגיונית מהרשימה.
3. תמיכת נהלים: ענה על שאלות לגבי חוקים ונהלים בהתבסס על אובייקט הנהלים.
המלאי שלפניך הוא ספירת זמינות בזמן אמת, אחרי הפחתת פריטים שנמצאים כרגע בהשאלה או באיחור. אם פריט לא מופיע ברשימה, הוא לא קיים כרגע במחסן.

נהלי המחסן: ${JSON.stringify(policies)}
מלאי הציוד הזמין כרגע: ${JSON.stringify(compactEquipment)}`;

      const history = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      history.push({ role: 'user', parts: [{ text: userMessage }] });

      let result = null;
      let lastError = null;

      for (const modelName of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const response = await fetchWithRetry(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: history,
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = new Error(errText || `שגיאה ${response.status}`);
          if (response.status === 404 || response.status === 429 || response.status === 503) {
            continue;
          }
          throw lastError;
        }

        result = await response.json();
        if (result?.candidates?.length) break;
      }

      if (!result?.candidates?.length) {
        throw lastError || new Error("לא התקבלה תשובה תקינה מעוזר ה־AI.");
      }

      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      setMessages(prev => [...prev, { role: 'assistant', content: aiText }]);
      incrementRequestsCount();

    } catch (error) {
      console.error("ChatBot error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: `שגיאה: ${error.message}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 600;
  const panelWidth = isMobile ? Math.min(300, window.innerWidth - 24) : 340;
  const topOffset = isMobile ? 'calc(env(safe-area-inset-top, 0px) + 12px)' : 20;
  const rightOffset = isMobile ? 'calc(env(safe-area-inset-right, 0px) + 12px)' : 20;
  const bubbleSize = isMobile ? 46 : 50;
  const bubbleIconSize = isMobile ? 22 : 24;

  const widget = (
    <div style={{
      position: 'fixed',
      top: topOffset,
      right: rightOffset,
      zIndex: 2147483647,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
    }}>

      {/* Panel */}
      {isOpen && (
        <div dir="rtl" style={{
          background: '#1a1a2e',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
          border: '1px solid rgba(99,102,241,0.35)',
          width: panelWidth,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🤖</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>עוזר המחסן החכם</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>נותרו {maxRequests - getRequestsCount()} שאלות להיום</div>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} style={{
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              borderRadius: '50%',
              width: 28,
              height: 28,
              cursor: 'pointer',
              color: '#fff',
              fontSize: 18,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>×</button>
          </div>

          {/* Messages */}
          <div style={{
            height: isMobile ? 240 : 290,
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: '#0f0f1a',
          }}>
            {messages.map((msg, idx) => (
              <div key={idx} style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: msg.role === 'assistant' ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
                fontSize: 13,
                lineHeight: 1.5,
                alignSelf: msg.role === 'assistant' ? 'flex-start' : 'flex-end',
                background: msg.role === 'assistant' ? '#1e1e35' : '#4f46e5',
                color: msg.role === 'assistant' ? '#e2e2f0' : '#fff',
                border: msg.role === 'assistant' ? '1px solid rgba(99,102,241,0.2)' : 'none',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            ))}
            {isTyping && (
              <div style={{
                alignSelf: 'flex-start',
                background: '#1e1e35',
                border: '1px solid rgba(99,102,241,0.2)',
                borderRadius: '4px 12px 12px 12px',
                padding: '8px 14px',
                fontSize: 18,
                color: '#a5b4fc',
                letterSpacing: 4,
              }}>···</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 12px',
            background: '#1a1a2e',
            borderTop: '1px solid rgba(99,102,241,0.2)',
            display: 'flex',
            gap: 8,
          }}>
            <input
              type="text"
              placeholder="שאל אותי משהו..."
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              style={{
                flex: 1,
                background: '#0f0f1a',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 8,
                padding: '7px 12px',
                fontSize: 13,
                color: '#e2e2f0',
                outline: 'none',
                direction: 'rtl',
                minWidth: 0,
              }}
            />
            <button
              onClick={handleSend}
              disabled={isTyping || !inputValue.trim()}
              style={{
                background: isTyping || !inputValue.trim() ? '#2d2d4e' : '#4f46e5',
                border: 'none',
                borderRadius: 8,
                padding: '7px 12px',
                cursor: isTyping || !inputValue.trim() ? 'not-allowed' : 'pointer',
                color: '#fff',
                fontSize: 16,
                flexShrink: 0,
              }}
            >➤</button>
          </div>
        </div>
      )}

      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          title="עוזר המחסן החכם"
          style={{
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            border: 'none',
            borderRadius: '50%',
            width: bubbleSize,
            height: bubbleSize,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(99,102,241,0.55)',
            fontSize: bubbleIconSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(99,102,241,0.75)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.55)'; }}
        >
          🤖
          {getRequestsCount() < maxRequests && (
            <span style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 10,
              height: 10,
              background: '#22c55e',
              borderRadius: '50%',
              border: '2px solid #1a1a2e',
            }} />
          )}
        </button>
      )}
    </div>
  );

  return createPortal(widget, document.body);
}

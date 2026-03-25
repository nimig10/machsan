import React, { useState, useEffect, useRef } from 'react';

export default function AIChatBot({ equipment = [], policies = {}, settings = {} }) {
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

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";

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
      const compactEquipment = equipment.map(e => ({
        name: e.name, category: e.category, avail: e.avail
      }));

      const systemPrompt = `
        אתה עוזר וירטואלי של מחסן השאלת ציוד אקדמי. עליך לענות אך ורק בעברית, בצורה תמציתית, מקצועית ואדיבה.
        יש לך 3 תפקידים:
        1. בונה ערכות: אם סטודנט מתאר הפקה, המלץ לו על ציוד רלוונטי *אך ורק* מתוך רשימת הציוד הזמין (avail > 0).
        2. מציע חלופות: אם סטודנט מבקש משהו שאינו במלאי, הצע לו חלופה הגיונית מהרשימה.
        3. תמיכת נהלים: ענה על שאלות לגבי חוקים ונהלים בהתבסס על אובייקט הנהלים.

        נהלי המחסן: ${JSON.stringify(policies)}
        מלאי הציוד הנוכחי: ${JSON.stringify(compactEquipment)}
      `;

      const history = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      history.push({ role: 'user', parts: [{ text: userMessage }] });

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: history,
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      });

      if (!response.ok) throw new Error("API call failed");
      const result = await response.json();
      const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      setMessages(prev => [...prev, { role: 'assistant', content: aiText }]);
      incrementRequestsCount();

    } catch (error) {
      console.error("ChatBot error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'מצטער, חלה שגיאה בחיבור לשרת. אנא נסה שוב מאוחר יותר.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} dir="rtl">

      {/* Panel */}
      {isOpen && (
        <div style={{
          background: '#1a1a2e',
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
          border: '1px solid rgba(99,102,241,0.3)',
          width: 340,
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
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>×</button>
          </div>

          {/* Messages */}
          <div style={{
            height: 300,
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
                transition: 'background 0.2s',
              }}
            >➤</button>
          </div>
        </div>
      )}

      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
            border: 'none',
            borderRadius: '50%',
            width: 56,
            height: 56,
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(99,102,241,0.5)',
            fontSize: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          title="עוזר המחסן החכם"
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
}

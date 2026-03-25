import React, { useState, useEffect, useRef } from 'react';

export default function AIChatBot({ equipment = [], policies = {}, settings = {} }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'היי! אני העוזר החכם של המחסן. תאר לי מה אתה הולך לצלם/להקליט ואעזור לך להרכיב ערכה, או שאל אותי על נהלי המחסן.' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  // הגבלת בקשות מתוך ההגדרות (או 5 כברירת מחדל)
  const maxRequests = parseInt(settings?.aiMaxRequests) || 5;
  const todayKey = `ai_requests_${new Date().toISOString().split('T')[0]}`;

  const getRequestsCount = () => parseInt(localStorage.getItem(todayKey)) || 0;
  const incrementRequestsCount = () => localStorage.setItem(todayKey, getRequestsCount() + 1);

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";

  // גלילה אוטומטית להודעה האחרונה
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
      // הכנת מידע קומפקטי ל-AI כדי לחסוך טוקנים
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

      // בונים את היסטוריית השיחה בפורמט ש-Gemini מצפה לו
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
      incrementRequestsCount(); // מעדכן את המונה רק על תשובות מוצלחות

    } catch (error) {
      console.error("ChatBot error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'מצטער, חלה שגיאה בחיבור לשרת. אנא נסה שוב מאוחר יותר.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start" dir="rtl">
      {isOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-80 sm:w-96 flex flex-col overflow-hidden mb-4 transition-all duration-300">
          {/* Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 flex justify-between items-center text-white">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🤖</span>
              <div>
                <h3 className="font-bold text-sm">עוזר המחסן החכם</h3>
                <p className="text-xs opacity-80">נותרו {maxRequests - getRequestsCount()} שאלות להיום</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-1 rounded-full transition">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 h-80 overflow-y-auto bg-gray-50 flex flex-col gap-3">
            {messages.map((msg, idx) => (
              <div key={idx} className={`max-w-[85%] p-3 rounded-xl text-sm ${msg.role === 'assistant' ? 'bg-white border border-gray-200 text-gray-800 self-start rounded-tr-none' : 'bg-indigo-600 text-white self-end rounded-tl-none'}`}>
                {msg.content}
              </div>
            ))}
            {isTyping && (
              <div className="bg-white border border-gray-200 text-gray-800 self-start rounded-xl rounded-tr-none p-3 max-w-[85%] text-sm flex gap-1">
                <span className="animate-bounce">.</span><span className="animate-bounce delay-100">.</span><span className="animate-bounce delay-200">.</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 bg-white border-t border-gray-200 flex gap-2">
            <input
              type="text"
              className="flex-1 bg-gray-100 border-transparent rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
              placeholder="שאל אותי משהו..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button
              onClick={handleSend}
              disabled={isTyping || !inputValue.trim()}
              className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
            </button>
          </div>
        </div>
      )}

      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center justify-center relative"
        >
          <span className="text-3xl">🤖</span>
          {getRequestsCount() < maxRequests && (
            <span className="absolute top-0 right-0 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
